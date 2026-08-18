import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import { resolveLoginEmail } from "@/lib/auth-email";
import { normalizeRole } from "@/lib/roles";
import {
  findTeamMemberForLogin,
  provisionTeamMember,
  type TeamMemberRow,
} from "@/lib/team-member-lookup";
import type { Role } from "@/lib/types";

import "@/lib/auth.config";

const ROLE_CACHE_TTL_MS = 60 * 1000;
const roleCache = new Map<string, { data: TeamMemberRow; expiresAt: number }>();

/**
 * When each email was last reported as having no TeamMember row.
 *
 * Only a throttle — see `warnTeamMemberMissing`. Kept beside `roleCache`
 * because `clearTeamMemberRoleCache` has to drop both: an email that has just
 * been added back to the roster should be allowed to complain again if it
 * still cannot be found.
 */
const missingWarnedAt = new Map<string, number>();

async function getCachedTeamMember(email: string): Promise<TeamMemberRow | null> {
  const key = email.toLowerCase();
  const now = Date.now();
  const cached = roleCache.get(key);
  if (cached && now < cached.expiresAt) return cached.data;

  if (roleCache.size > 100) {
    roleCache.forEach((v, k) => {
      if (now >= v.expiresAt) roleCache.delete(k);
    });
  }

  const member = await findTeamMemberForLogin(email);
  if (member) {
    roleCache.set(key, { data: member, expiresAt: now + ROLE_CACHE_TTL_MS });
  } else {
    roleCache.delete(key);
  }
  return member;
}

/**
 * Forget cached roles so the next `auth()` re-reads them.
 *
 * Called by `/api/settings/users` after every roster change — without it a role
 * change, a deactivation or a reactivation appears not to have worked for up to
 * `ROLE_CACHE_TTL_MS`. In-process only: this is a plain Map, so it invalidates
 * nothing on another instance.
 */
export function clearTeamMemberRoleCache(email?: string) {
  if (email) {
    const key = email.toLowerCase();
    roleCache.delete(key);
    missingWarnedAt.delete(key);
  } else {
    roleCache.clear();
    missingWarnedAt.clear();
  }
}

/**
 * Report a signed-in email that has no TeamMember row, at most once per email
 * per cache TTL.
 *
 * The jwt callback runs on every `auth()` call, so an unthrottled line here
 * would print once per API request per affected person — loudest exactly when
 * the database is unreachable and *everyone* is affected, which is when the log
 * most needs to stay readable.
 */
function warnTeamMemberMissing(email: string) {
  const key = email.toLowerCase();
  const now = Date.now();

  const last = missingWarnedAt.get(key);
  if (last !== undefined && now - last < ROLE_CACHE_TTL_MS) return;

  if (missingWarnedAt.size > 100) {
    missingWarnedAt.forEach((at, k) => {
      if (now - at >= ROLE_CACHE_TTL_MS) missingWarnedAt.delete(k);
    });
  }
  missingWarnedAt.set(key, now);

  console.error(
    `[Auth] no TeamMember row for "${email}" — session downgraded to Staff with no id.` +
      " Either the row is gone, or the form database could not be read.",
  );
}

function applyTeamMemberToToken(
  token: Record<string, unknown>,
  member: TeamMemberRow,
) {
  token.role = normalizeRole(member.AppRole);
  token.nickname = member.Nickname;
  token.color = member.Color;
  token.userId = String(member.Id);
  const dbPhoto = member.Photo?.trim() || null;
  token.photo = dbPhoto ?? (token.photo as string | null) ?? null;
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,

    async signIn({ user, account, profile }) {
      try {
        const email = resolveLoginEmail(user, profile as Record<string, unknown> | undefined);

        if (account?.provider === "microsoft-entra-id" && !email) {
          console.warn("[Auth] blocked login (microsoft-entra-id, unresolvable email)");
          return false;
        }

        if (account?.provider === "microsoft-entra-id" && email) {
          user.email = email;
          const member = await findTeamMemberForLogin(email);

          if (member && member.IsActive) {
            user.role = normalizeRole(member.AppRole);
            user.nickname = member.Nickname;
            user.color = member.Color;
            user.id = String(member.Id);
            user.name = member.FullName;

            let photo: string | null = member.Photo;
            if (!photo) {
              try {
                const { getADUserPhoto, getADUserByEmail } = await import("@/lib/graph");
                const adUser = await getADUserByEmail(email);
                if (adUser) {
                  photo = await getADUserPhoto(adUser.id);
                }
              } catch {
                /* optional */
              }
            }
            user.photo = photo;
          } else {
            // Not an active TeamMember — allow only if an active HR Employee exists.
            const { findActiveEmployeeByEmail } = await import("@/lib/hr/employee-lookup");
            const { employee } = await findActiveEmployeeByEmail(email);
            if (!employee) {
              console.warn("[Auth] blocked login (not TeamMember, no active Employee):", email);
              return false; // → pages.error (/unauthorized)
            }

            // Give them a real TeamMember row: an empty user.id makes AccRequest.CreatedBy NULL,
            // which locks the user out of their own drafts (see provisionTeamMember).
            //
            // provisionTeamMember() swallows a database failure and returns null, so the
            // login still completes — with user.id "" and role Staff, which is the same
            // degraded session the outer catch produces. That is deliberate: a write that
            // failed must not lock someone out. The reason is only ever visible in the
            // "[TeamMember] provision failed" log line, so check there when a user reports
            // that their own drafts have vanished.
            const provisioned = member
              ? null // inactive row exists — leave it alone, a System Admin owns that decision
              : await provisionTeamMember({
                  email,
                  fullName: employee.fullName,
                  nickname: employee.nickname,
                  position: employee.position,
                });

            user.role = normalizeRole(provisioned?.AppRole ?? "Staff");
            user.nickname = provisioned?.Nickname ?? "";
            user.color = provisioned?.Color ?? "#6c757d";
            user.id = provisioned ? String(provisioned.Id) : "";
            user.name = provisioned?.FullName || employee.fullName || user.name;

            try {
              const { getADUserPhoto, getADUserByEmail } = await import("@/lib/graph");
              const adUser = await getADUserByEmail(email);
              if (adUser) {
                user.name = adUser.displayName || user.name;
                user.photo = await getADUserPhoto(adUser.id);
              } else {
                user.photo = null;
              }
            } catch {
              user.photo = null;
            }
          }
        }

        return true;
      } catch (err: unknown) {
        console.error("[Auth] signIn error:", err instanceof Error ? err.message : err);

        // Microsoft auth succeeded — do not block login when DB/Graph enrichment fails
        if (account?.provider === "microsoft-entra-id") {
          const email = resolveLoginEmail(user, profile as Record<string, unknown> | undefined);
          if (email) user.email = email;
          user.role = (user.role as Role) ?? "Staff";
          user.nickname = user.nickname ?? "";
          user.color = user.color ?? "#6c757d";
          user.id = user.id ?? "";
          user.photo = user.photo ?? null;
          return true;
        }
        return false;
      }
    },

    async jwt({ token, user, account, profile }) {
      try {
        const t = token as Record<string, unknown>;

        const email = resolveLoginEmail(
          user ?? { email: token.email as string },
          profile as Record<string, unknown> | undefined,
          t,
        );
        if (email) {
          token.email = email;
        }

        if (user && account) {
          t.picture = undefined;
          t.access_token = undefined;
          t.id_token = undefined;

          t.role = normalizeRole(user.role as string);
          t.nickname = user.nickname ?? "";
          t.color = user.color ?? "#6c757d";
          t.userId = user.id ?? "";
          t.photo = user.photo ?? null;
        }

        if (token.email) {
          try {
            const member = await getCachedTeamMember(token.email as string);
            if (member && member.IsActive) {
              applyTeamMemberToToken(t, member);
            } else {
              // Retired row, or no row at all: either way the roster no longer
              // backs the grant this token is carrying, so the token stops
              // carrying it.
              //
              // Failing closed rather than keeping the last known role. This
              // token is the whole of what the ~167 `requireAuth()` /
              // `requireRole()` gates in `src/app/api` see, and `userId` is
              // what every ownership check compares against, so a grant the
              // roster no longer confirms would keep working for the life of
              // the session — JWT strategy with no maxAge set, i.e. 30 days —
              // and leave nothing behind in any log.
              //
              // The usual objection, that a database blip should not punish
              // everyone, does not survive being priced:
              //   · it is not a logout — `requireAuth()` gates on
              //     `session.user.email` and the Edge proxy only checks that a
              //     token decodes, and neither is touched here;
              //   · it is not sticky — the next successful read runs
              //     `applyTeamMemberToToken` and restores role, id, nickname,
              //     colour and photo;
              //   · it costs no working functionality, because every endpoint
              //     the retained role would have authorised reads the same
              //     database that just failed to answer.
              //
              // `null` really does mean both things: `findTeamMemberByEmail`
              // swallows a database error and returns null, so this branch
              // cannot tell "row deleted" from "database unreachable" (and the
              // catch below therefore almost never fires). Hence the warning —
              // a burst of it across many emails is an outage, or a form
              // database with no TeamMember table because migration 066 was
              // never applied; one email repeating is one person's row.
              if (!member) warnTeamMemberMissing(token.email as string);
              t.role = "Staff";
              t.userId = "";
            }
          } catch (dbErr: unknown) {
            console.error("[Auth] jwt DB lookup:", dbErr instanceof Error ? dbErr.message : dbErr);
          }
        }

        return token;
      } catch (err: unknown) {
        console.error("[Auth] jwt error:", err instanceof Error ? err.message : err);
        return token;
      }
    },

    async session({ session, token }) {
      if (!session?.user) return session;
      if (token.email) session.user.email = token.email as string;
      session.user.role = normalizeRole(token.role as string);
      session.user.nickname = token.nickname as string;
      session.user.color = token.color as string;
      session.user.photo = (token.photo as string | null) ?? null;
      session.user.id = token.userId as string;
      return session;
    },
  },
});
