/**
 * Login-time identity lookup — a thin adapter over `@/lib/team-member/service`.
 *
 * It holds no SQL of its own: the service owns every TeamMember statement and
 * pins them to the production form database (see its docblock for why). What
 * stays here is login behaviour the service deliberately does not have — the
 * Graph mail/UPN retry, and turning a thrown database error into a value the
 * NextAuth callbacks can branch on rather than an exception out of a callback.
 *
 * ## Three outcomes, not two
 *
 * `findTeamMemberByEmail` returns `null` for both "this person has no row" and
 * "the form database could not be read", and that conflation was load-bearing in
 * the wrong direction: `signIn` read the null as "not a TeamMember", moved on to
 * ask HR whether the account was an active employee, and — when *that* lookup
 * threw as well — fell into an outer catch that granted a `Staff` session and
 * returned `true`. An enabled Entra account in neither roster signed in
 * successfully whenever the authorization data source was down. It failed open
 * on exactly the failure it most needed to fail closed on.
 *
 * `lookupTeamMember*` returns `found | not_found | unavailable` so the callbacks
 * can tell a negative answer from no answer. `findTeamMemberByEmail` and
 * `findTeamMemberForLogin` stay as the collapsing wrappers, because the *jwt*
 * callback genuinely wants the old behaviour — see the long comment there for
 * why an unreadable roster downgrades the role but keeps the id.
 *
 * The PascalCase row shape is the one `@/lib/auth` still reads.
 */

import {
  findByEmail,
  findById,
  provision,
  type TeamMemberRow as MemberRow,
} from "@/lib/team-member/service";

export interface TeamMemberRow {
  Id: number;
  FullName: string;
  Nickname: string;
  Email: string;
  AppRole: string;
  Position: string;
  Color: string;
  Photo: string | null;
  IsActive: boolean;
}

function toLegacyRow(member: MemberRow): TeamMemberRow {
  return {
    Id: member.id,
    FullName: member.fullName,
    Nickname: member.nickname,
    Email: member.email,
    AppRole: member.appRole,
    Position: member.position ?? "",
    Color: member.color,
    Photo: member.photo,
    IsActive: member.isActive,
  };
}

/** A roster answer, or the absence of one. See the module docblock. */
export type TeamMemberLookup =
  | { status: "found"; member: TeamMemberRow }
  | { status: "not_found" }
  | { status: "unavailable"; message: string };

export async function lookupTeamMemberByEmail(email: string): Promise<TeamMemberLookup> {
  const trimmedEmail = email?.trim() ?? "";
  if (!trimmedEmail) return { status: "not_found" };

  try {
    const member = await findByEmail(trimmedEmail);
    return member ? { status: "found", member: toLegacyRow(member) } : { status: "not_found" };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[TeamMember] DB lookup failed for", trimmedEmail, "—", message);
    return { status: "unavailable", message };
  }
}

/** The collapsing wrapper the jwt callback wants. Prefer `lookupTeamMemberByEmail`. */
export async function findTeamMemberByEmail(email: string): Promise<TeamMemberRow | null> {
  const result = await lookupTeamMemberByEmail(email);
  return result.status === "found" ? result.member : null;
}

/**
 * Create the TeamMember row for an active HR employee who has never had one,
 * then return it. See `provision()` for why a missing row breaks ownership
 * checks; this wrapper only re-reads the row and keeps login from throwing.
 */
export async function provisionTeamMember(input: {
  email: string;
  fullName: string | null;
  nickname: string | null;
  position: string | null;
}): Promise<TeamMemberRow | null> {
  const email = input.email?.trim() ?? "";
  if (!email) return null;

  try {
    const id = await provision({
      email,
      fullName: input.fullName ?? "",
      nickname: input.nickname ?? "",
      position: input.position,
    });
    const member = await findById(id);
    return member ? toLegacyRow(member) : null;
  } catch (err: unknown) {
    console.error("[TeamMember] provision failed for", email, "—", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * DB lookup, then retry with Graph mail/UPN if the login id differs from
 * `TeamMember.Email`.
 *
 * `unavailable` is sticky: once any of the three reads has failed for a
 * database reason, the whole answer is "no answer". Returning `not_found`
 * because a later alias happened to miss would put the caller back where it
 * started, treating an outage as a negative.
 *
 * Graph itself stays optional — it is only an alias source, and its failure
 * leaves whatever the database already said.
 */
export async function lookupTeamMemberForLogin(loginEmail: string): Promise<TeamMemberLookup> {
  const email = loginEmail.trim();
  if (!email) return { status: "not_found" };

  let unavailable: TeamMemberLookup | null = null;

  const attempt = async (candidate: string): Promise<TeamMemberLookup | null> => {
    const result = await lookupTeamMemberByEmail(candidate);
    if (result.status === "found") return result;
    if (result.status === "unavailable") unavailable = result;
    return null;
  };

  const direct = await attempt(email);
  if (direct) return direct;

  try {
    const { getADUserByEmail } = await import("@/lib/graph");
    const adUser = await getADUserByEmail(email);
    if (adUser) {
      const adMail = adUser.mail?.trim();
      const adUpn = adUser.userPrincipalName?.trim();

      if (adMail && adMail.toLowerCase() !== email.toLowerCase()) {
        const byMail = await attempt(adMail);
        if (byMail) return byMail;
      }
      if (adUpn && adUpn.toLowerCase() !== email.toLowerCase()) {
        const byUpn = await attempt(adUpn);
        if (byUpn) return byUpn;
      }
    }
  } catch {
    /* Graph optional */
  }

  if (unavailable) return unavailable;

  if (process.env.NODE_ENV !== "production") {
    console.warn(`[TeamMember] No row for login "${email}" (tried Graph mail/UPN too).`);
  }
  return { status: "not_found" };
}

/** The collapsing wrapper the jwt callback wants. Prefer `lookupTeamMemberForLogin`. */
export async function findTeamMemberForLogin(loginEmail: string): Promise<TeamMemberRow | null> {
  const result = await lookupTeamMemberForLogin(loginEmail);
  return result.status === "found" ? result.member : null;
}
