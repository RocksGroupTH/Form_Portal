import { getCorePool, teamMemberTable, sql } from "@/lib/db/mssql";

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

export async function findTeamMemberByEmail(email: string): Promise<TeamMemberRow | null> {
  const trimmedEmail = email?.trim() ?? "";
  if (!trimmedEmail) return null;

  try {
    const pool = await getCorePool();
    const result = await pool
      .request()
      .input("email", sql.NVarChar, trimmedEmail)
      .query<TeamMemberRow>(
        `SELECT Id, FullName, Nickname, Email, AppRole, Position, Color, Photo, IsActive
         FROM ${teamMemberTable()}
         WHERE LOWER(LTRIM(RTRIM(Email))) = LOWER(LTRIM(RTRIM(@email)))`,
      );
    return result.recordset[0] ?? null;
  } catch (err: unknown) {
    console.error("[TeamMember] DB lookup failed for", trimmedEmail, "—", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Create the TeamMember row for an active HR employee who has never had one, then return it.
 *
 * Without a row the session carries no numeric `user.id`, and every ownership check that keys
 * on it (`AccRequest.CreatedBy` in AP-1 / AP-17 — draft listing, edit, submit, cancel, delete)
 * silently fails: the request is written with `CreatedBy = NULL`, which then matches nobody.
 * Provisioning at login keeps those users working without a System Admin having to add them by
 * hand first. `AppRole` is the lowest role, so this grants nothing beyond the Request forms;
 * any further gating (brand access, admin settings) is layered on top of it per-feature.
 *
 * Idempotent: the insert is guarded, and the row is re-read either way, so concurrent logins
 * can't create duplicates.
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
    const pool = await getCorePool();
    const result = await pool
      .request()
      .input("email", sql.NVarChar, email)
      .input("fullName", sql.NVarChar, input.fullName?.trim() || email)
      .input("nickname", sql.NVarChar, input.nickname?.trim() || "")
      .input("position", sql.NVarChar, input.position?.trim() || "")
      .query<TeamMemberRow>(`
        IF NOT EXISTS (
          SELECT 1 FROM ${teamMemberTable()}
          WHERE LOWER(LTRIM(RTRIM(Email))) = LOWER(LTRIM(RTRIM(@email)))
        )
        INSERT INTO ${teamMemberTable()} (FullName, Nickname, Email, AppRole, Position, Color, IsActive)
        VALUES (@fullName, @nickname, @email, N'Staff', @position, N'#6c757d', 1);

        SELECT Id, FullName, Nickname, Email, AppRole, Position, Color, Photo, IsActive
        FROM ${teamMemberTable()}
        WHERE LOWER(LTRIM(RTRIM(Email))) = LOWER(LTRIM(RTRIM(@email)))`);
    return result.recordset[0] ?? null;
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
