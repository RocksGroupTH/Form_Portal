import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import { resolveLoginEmail } from "@/lib/auth-email";
import { normalizeRole } from "@/lib/roles";
import {
  findTeamMemberForLogin,
  lookupTeamMemberForLogin,
  provisionTeamMember,
  type TeamMemberRow,
} from "@/lib/team-member-lookup";

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
    `[Auth] no TeamMember row for "${email}" — role downgraded to Staff, id kept.` +
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

          // Three outcomes, and only one of them is "no". An unreadable roster
          // must not be read as "not a TeamMember" — that is the path that used
          // to continue on to HR, throw there too, and land in the outer catch
          // that granted a session. See `lookupTeamMemberForLogin`.
          const lookup = await lookupTeamMemberForLogin(email);
          if (lookup.status === "unavailable") {
            console.error(
              "[Auth] blocked login (TeamMember roster unreadable):",
              email,
              "—",
              lookup.message,
            );
            return false;
          }
          const member = lookup.status === "found" ? lookup.member : null;

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
            // Not an active TeamMember — allow only if an active HR Employee
            // exists. A *failure* to ask is not a yes: this used to throw
            // straight past into the outer catch, which returned true.
            const { findActiveEmployeeByEmail } = await import("@/lib/hr/employee-lookup");
            let employee: Awaited<ReturnType<typeof findActiveEmployeeByEmail>>["employee"];
            try {
              employee = (await findActiveEmployeeByEmail(email)).employee;
            } catch (hrErr: unknown) {
              console.error(
                "[Auth] blocked login (HR employee lookup unavailable):",
                email,
                "—",
                hrErr instanceof Error ? hrErr.message : hrErr,
              );
              return false;
            }
            if (!employee) {
              console.warn("[Auth] blocked login (not TeamMember, no active Employee):", email);
              return false; // → pages.error (/unauthorized)
            }

            // Give them a real TeamMember row. An empty `user.id` is not a usable
            // session: `Number("")` is 0, so it owns nothing, matches nothing and
            // stamps nothing — every draft such a session creates is a row its
            // own author can never see again.
            //
            // This used to complete the login anyway, on the reasoning that a
            // failed write must not lock anyone out. That is the wrong trade: the
            // session it produced could not do the thing it was let in to do, and
            // the only record of why was one log line. Fail closed instead; the
            // person retries once the form database answers.
            //
            // An existing *inactive* row is a different answer — the roster says
            // this person is retired. Provisioning around it would override a
            // decision a System Admin made on purpose.
            if (member) {
              console.warn("[Auth] blocked login (TeamMember row is inactive):", email);
              return false;
            }

            const provisioned = await provisionTeamMember({
              email,
              fullName: employee.fullName,
              nickname: employee.nickname,
              position: employee.position,
            });
            if (!provisioned) {
              console.error(
                "[Auth] blocked login (could not provision a TeamMember row):",
                email,
                "— see the preceding [TeamMember] provision failed line",
              );
              return false;
            }

            user.role = normalizeRole(provisioned.AppRole ?? "Staff");
            user.nickname = provisioned.Nickname ?? "";
            user.color = provisioned.Color ?? "#6c757d";
            user.id = String(provisioned.Id);
            user.name = provisioned.FullName || employee.fullName || user.name;

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

        // Fail closed. This branch used to grant a `Staff` session with
        // `user.id = ""`, on the reasoning that Microsoft had already
        // authenticated the person so a database or Graph problem should not
        // block them. But Entra only proves *who* they are. Whether they may use
        // this application is a question only the roster and HR answer, and this
        // is the branch that runs when neither could be asked.
        //
        // Everything genuinely optional is caught closer in — both Graph
        // photo/display-name lookups have their own `catch`, so an unreachable
        // Graph never reaches here. What is left is authorization that did not
        // resolve.
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
              // backs the role this token is carrying, so the token stops
              // carrying it.
              //
              // Failing closed on the *role*. This token is the whole of what
              // the `requireAuth()` / `requireRole()` gates in `src/app/api`
              // see, so a grant the roster no longer confirms would otherwise
              // keep working for the life of the session — JWT strategy with
              // no maxAge set, i.e. 30 days — and leave nothing behind in any
              // log.
              //
              // The downgrade is not a logout (`requireAuth()` gates on
              // `session.user.email`, and the Edge proxy only checks that a
              // token decodes) and it is not sticky (the next successful read
              // runs `applyTeamMemberToToken` and restores role, id, nickname,
              // colour and photo). It does cost real functionality while it
              // lasts, and the cost lands hardest in an outage: the settings
              // endpoints an admin role would have authorised — connections,
              // bc-connections, brand-config, ors, google-maps and
              // form-environment — are all Fast_Core-backed, so they are still
              // up when the form database is not, and Form Environment is the
              // page you would use to route a form away from a sick database.
              // That cost is accepted deliberately; carrying an unconfirmed
              // grant for up to 30 days is the worse trade.
              //
              // `userId` is *not* cleared on the same terms, because the two
              // cases behind this branch are not the same and `null` conflates
              // them — `findTeamMemberByEmail` swallows a database error and
              // returns null, so `!member` means "row deleted" or "form
              // database unreachable", with no way to tell which:
              //   · inactive row — the roster positively confirms this person
              //     is gone, so the id goes too;
              //   · no row — keep it. `userId` authorises nothing; it only
              //     selects or stamps the caller's own rows, so keeping it
              //     fails closed on nothing. Blanking it instead does damage
              //     that outlives the outage: both Accounting forms coerce
              //     `userId || null`, so a blank id writes the orphaned
              //     `AccRequest.CreatedBy = NULL` rows migration 058 exists to
              //     repair and is now marked DO NOT RE-RUN — rows whose owner
              //     can never see them again.
              //
              // Hence the warning on `!member` only, and hence the catch below
              // almost never firing: the read has already handled its own
              // error by the time we get here. A burst of the warning across
              // many emails is an outage, or a form database with no
              // TeamMember table because migration 066 was never applied; one
              // email repeating is one person's row.
              t.role = "Staff";
              if (member) {
                t.userId = "";
              } else {
                warnTeamMemberMissing(token.email as string);
              }
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
