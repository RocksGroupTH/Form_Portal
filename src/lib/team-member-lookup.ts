/**
 * Login-time identity lookup — a thin adapter over `@/lib/team-member/service`.
 *
 * It holds no SQL of its own: the service owns every TeamMember statement and
 * pins them to the production form database (see its docblock for why). What
 * stays here is login behaviour the service deliberately does not have — the
 * Graph mail/UPN retry, and swallowing a database failure so a login attempt
 * fails closed with "no row" rather than throwing out of the NextAuth callback.
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

export async function findTeamMemberByEmail(email: string): Promise<TeamMemberRow | null> {
  const trimmedEmail = email?.trim() ?? "";
  if (!trimmedEmail) return null;

  try {
    const member = await findByEmail(trimmedEmail);
    return member ? toLegacyRow(member) : null;
  } catch (err: unknown) {
    console.error("[TeamMember] DB lookup failed for", trimmedEmail, "—", err instanceof Error ? err.message : err);
    return null;
  }
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

/** DB lookup, then retry with Graph mail/UPN if the login id differs from TeamMember.Email */
export async function findTeamMemberForLogin(loginEmail: string): Promise<TeamMemberRow | null> {
  const email = loginEmail.trim();
  if (!email) return null;

  let member = await findTeamMemberByEmail(email);
  if (member) return member;

  try {
    const { getADUserByEmail } = await import("@/lib/graph");
    const adUser = await getADUserByEmail(email);
    if (!adUser) return null;

    const adMail = adUser.mail?.trim();
    const adUpn = adUser.userPrincipalName?.trim();

    if (adMail && adMail.toLowerCase() !== email.toLowerCase()) {
      member = await findTeamMemberByEmail(adMail);
      if (member) return member;
    }
    if (adUpn && adUpn.toLowerCase() !== email.toLowerCase()) {
      member = await findTeamMemberByEmail(adUpn);
      if (member) return member;
    }
  } catch {
    /* Graph optional */
  }

  if (process.env.NODE_ENV !== "production") {
    console.warn(`[TeamMember] No row for login "${email}" (tried Graph mail/UPN too).`);
  }
  return null;
}
