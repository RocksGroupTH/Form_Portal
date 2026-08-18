/**
 * The one way in to `TeamMember` — user identity, roles and the manager link.
 *
 * ## Why every access goes through here
 *
 * Form Portal used to read this table out of `Fast_Core`, which the live Rocks
 * Fast app also serves from. Migration 066 gave this app its own copy in
 * `Rocks_Portal_Form`, ids preserved. The old table still exists and still has
 * the same shape, so a query left pointing at `Fast_Core` does not error — it
 * quietly returns the other app's roster, with that app's roles. Routing every
 * read and write through this module turns that from something to be careful
 * about into something `grep -rn "TeamMember" src/` finds.
 *
 * ## Why `getProductionFormPool()` and never `getFormPool()`
 *
 * `getFormPool()` resolves per request URL: a form flagged UAT at
 * Settings → Form Environment answers from `Rocks_Portal_Form_UAT`. Identity
 * must not work that way. `requireAuth()` runs on ~285 endpoints, so the same
 * person would read their own id and role from `Rocks_Portal_Form` on one page
 * and from the UAT database on an AP-1 page — a different id, possibly a
 * different role, depending on where they happened to click. Migration 066 is
 * also deliberately never applied to the UAT database: identity lives in
 * exactly one place, so a UAT-routed pool would not find this table at all.
 *
 * The second reason is structural. `getFormPool()` dynamically imports
 * `@/lib/form-environment`, which resolves the viewer from the `x-user-email`
 * header specifically so that it never calls `auth()` — see the comment at
 * `src/lib/form-environment/index.ts:67-72`. Resolving identity through
 * `getFormPool()` would close that loop: `getFormPool → auth → jwt →
 * getFormPool`.
 *
 * ## Why the table is addressed three-part
 *
 * `teamMemberTableRef()` returns `[<form db>].[dbo].[TeamMember]` so it can be
 * joined from a query running on any pool — `/api/forms/approvals` joins it on
 * `getFormPool()`, which may resolve to UAT. A bare `TeamMember` there would
 * miss the table entirely (or, if a copy ever appeared, read the wrong roster).
 *
 * Functions here return plain data and throw on database failure; HTTP shaping
 * and login-time resilience belong to their callers.
 */

import { env } from "@/env";
import { getProductionFormPool, sql } from "@/lib/db/mssql";
import {
  DEFAULT_MEMBER_COLOR,
  isValidRole,
  mapTeamMemberRow,
  normalizeEmail,
  resolveNickname,
  type RawTeamMemberRow,
  type TeamMemberRow,
} from "./mapping";

export {
  DEFAULT_MEMBER_COLOR,
  isValidRole,
  normalizeEmail,
  resolveNickname,
} from "./mapping";
export type { TeamMemberRow } from "./mapping";

/** Every column `TeamMemberRow` is built from, in one place. */
const COLUMNS =
  "Id, FullName, Nickname, Email, AppRole, Position, Color, Photo, ManagerId, IsActive";

/**
 * Fully qualified table name, for statements that must join TeamMember from a
 * pool connected to some other database. See the module docblock.
 */
export function teamMemberTableRef(): string {
  return `[${env.MSSQL_FORM_DATABASE}].[dbo].[TeamMember]`;
}

/* ── Reads ── */

/** The person with this email, case- and padding-insensitive. */
export async function findByEmail(email: string): Promise<TeamMemberRow | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const pool = await getProductionFormPool();
  const result = await pool
    .request()
    .input("email", sql.NVarChar, normalized)
    .query<RawTeamMemberRow>(
      `SELECT ${COLUMNS} FROM ${teamMemberTableRef()}
       WHERE LOWER(LTRIM(RTRIM(Email))) = @email`,
    );
  const row = result.recordset[0];
  return row ? mapTeamMemberRow(row) : null;
}

/** The person with this id — the id the session carries and `CreatedBy` stores. */
export async function findById(id: number): Promise<TeamMemberRow | null> {
  if (!Number.isFinite(id) || id <= 0) return null;

  const pool = await getProductionFormPool();
  const result = await pool
    .request()
    .input("id", sql.Int, id)
    .query<RawTeamMemberRow>(
      `SELECT ${COLUMNS} FROM ${teamMemberTableRef()} WHERE Id = @id`,
    );
  const row = result.recordset[0];
  return row ? mapTeamMemberRow(row) : null;
}

/** Everyone still in service, by name — the Users & Roles list and the resync sweep. */
export async function listActive(): Promise<TeamMemberRow[]> {
  const pool = await getProductionFormPool();
  const result = await pool
    .request()
    .query<RawTeamMemberRow>(
      `SELECT ${COLUMNS} FROM ${teamMemberTableRef()} WHERE IsActive = 1 ORDER BY FullName`,
    );
  return result.recordset.map(mapTeamMemberRow);
}

/**
 * Display names for a set of ids, for "last changed by"-style columns.
 *
 * One parameter per id rather than a joined string, so no value ever reaches
 * the statement text. Inactive people are included on purpose — an audit trail
 * still has to name whoever acted, long after they have left.
 */
export async function resolveNames(
  ids: number[],
): Promise<Map<number, { fullName: string; nickname: string }>> {
  const out = new Map<number, { fullName: string; nickname: string }>();
  const unique = Array.from(
    new Set(ids.filter((id) => Number.isFinite(id) && id > 0)),
  );
  if (unique.length === 0) return out;

  const pool = await getProductionFormPool();
  const request = pool.request();
  const placeholders = unique.map((id, i) => {
    request.input(`id${i}`, sql.Int, id);
    return `@id${i}`;
  });
  const result = await request.query<{
    Id: number;
    FullName: string | null;
    Nickname: string | null;
  }>(
    `SELECT Id, FullName, Nickname FROM ${teamMemberTableRef()}
     WHERE Id IN (${placeholders.join(", ")})`,
  );
  for (const row of result.recordset) {
    out.set(Number(row.Id), {
      fullName: (row.FullName ?? "").trim(),
      nickname: (row.Nickname ?? "").trim(),
    });
  }
  return out;
}

/** The manager this person reports to, or null. Retired people report to nobody. */
export async function managerIdOf(userId: number): Promise<number | null> {
  if (!Number.isFinite(userId) || userId <= 0) return null;

  const pool = await getProductionFormPool();
  const result = await pool
    .request()
    .input("userId", sql.Int, userId)
    .query<{ ManagerId: number | null }>(
      `SELECT ManagerId FROM ${teamMemberTableRef()} WHERE Id = @userId AND IsActive = 1`,
    );
  return result.recordset[0]?.ManagerId ?? null;
}

/**
 * The lowest-numbered active holder of a role, for workflow steps assigned to a
 * role rather than a person. `appRole` is workflow configuration text, so an
 * unrecognised value matches nobody instead of throwing.
 */
export async function firstActiveWithRole(appRole: string): Promise<number | null> {
  const role = (appRole ?? "").trim();
  if (!role) return null;

  const pool = await getProductionFormPool();
  const result = await pool
    .request()
    .input("role", sql.NVarChar, role)
    .query<{ Id: number }>(
      `SELECT TOP 1 Id FROM ${teamMemberTableRef()}
       WHERE AppRole = @role AND IsActive = 1 ORDER BY Id`,
    );
  return result.recordset[0]?.Id ?? null;
}

/* ── Writes ── */

/**
 * Give an active HR employee who has never had a row one, and return its id.
 *
 * Without a row the session carries no numeric `user.id`, and every ownership
 * check that keys on it (`AccRequest.CreatedBy` in AP-1 / AP-17 — draft
 * listing, edit, submit, cancel, delete) silently fails: the request is written
 * with `CreatedBy = NULL`, which then matches nobody. Provisioning at login
 * keeps those users working without a System Admin adding them by hand first.
 * `AppRole` is the lowest role, so this grants nothing beyond the Request
 * forms; brand access and admin gates are layered on top per feature.
 *
 * Idempotent: the insert is guarded and the id is re-read either way, so two
 * concurrent logins cannot create two rows.
 */
export async function provision(input: {
  email: string;
  fullName: string;
  nickname: string;
  position: string | null;
}): Promise<number> {
  const email = normalizeEmail(input.email);
  if (!email) throw new Error("provision() needs an email");

  const pool = await getProductionFormPool();
  const result = await pool
    .request()
    .input("email", sql.NVarChar, email)
    .input("fullName", sql.NVarChar, input.fullName?.trim() || email)
    // No first-word fallback here, unlike addOrReactivate(): HR is the
    // authority for a provisioned person, and a blank nickname is better filled
    // in from the directory later than guessed at during login.
    .input("nickname", sql.NVarChar, input.nickname?.trim() || "")
    .input("position", sql.NVarChar, input.position?.trim() || "")
    .input("color", sql.NVarChar, DEFAULT_MEMBER_COLOR)
    .query<{ Id: number }>(`
      IF NOT EXISTS (
        SELECT 1 FROM ${teamMemberTableRef()}
        WHERE LOWER(LTRIM(RTRIM(Email))) = @email
      )
      INSERT INTO ${teamMemberTableRef()} (FullName, Nickname, Email, AppRole, Position, Color, IsActive)
      VALUES (@fullName, @nickname, @email, N'Staff', @position, @color, 1);

      SELECT Id FROM ${teamMemberTableRef()}
      WHERE LOWER(LTRIM(RTRIM(Email))) = @email;`);

  const id = result.recordset[0]?.Id;
  if (!id) throw new Error(`provision() wrote no row for ${email}`);
  return Number(id);
}

/** What `addOrReactivate` did — the caller has to tell the three apart. */
export type AddOutcome = "created" | "exists" | "reactivated";

/**
 * Add someone picked from the directory, or bring back the row they already
 * have.
 *
 * A plain guarded INSERT was wrong here because `setActive(id, false)` only
 * clears `IsActive` and `listActive()` filters on it: the insert matched the
 * deactivated row, wrote nothing, and reported success while the list never
 * changed — a state the Users & Roles page could not recover from. Hence the
 * three distinct outcomes: the caller has to be able to say "already active".
 *
 * Reactivating rather than inserting a second row also protects history. The id
 * is referenced across both apps (`AccRequest.CreatedBy` / `SubmittedBy`,
 * `OfficeFormSubmissions.SubmittedBy`, `OfficeFormApprovals.AssignedTo`), so a
 * duplicate would orphan everything the first row owns.
 *
 * Only `IsActive`, `FullName`, `AppRole` and a blank `Nickname` are written on
 * reactivation — those are the fields the caller genuinely supplies.
 * `Position`, `Color`, `Photo` and `ManagerId` are left alone so a curated
 * nickname or avatar colour survives a re-add.
 */
export async function addOrReactivate(input: {
  fullName: string;
  email: string;
  nickname?: string | null;
  appRole: string;
}): Promise<{ id: number; outcome: AddOutcome }> {
  const email = normalizeEmail(input.email);
  const fullName = (input.fullName ?? "").trim();
  if (!email || !fullName) throw new Error("addOrReactivate() needs a name and an email");
  if (!isValidRole(input.appRole)) throw new Error(`Invalid role: ${input.appRole}`);

  const pool = await getProductionFormPool();
  const result = await pool
    .request()
    .input("name", sql.NVarChar, fullName)
    .input("nickname", sql.NVarChar, resolveNickname(fullName, input.nickname))
    .input("email", sql.NVarChar, email)
    .input("role", sql.NVarChar, input.appRole.trim())
    .input("color", sql.NVarChar, DEFAULT_MEMBER_COLOR)
    .query<{ Id: number; Outcome: AddOutcome }>(`
      DECLARE @existingId INT, @wasActive BIT;

      SELECT TOP 1 @existingId = Id, @wasActive = IsActive
      FROM ${teamMemberTableRef()}
      WHERE LOWER(LTRIM(RTRIM(Email))) = @email;

      IF @existingId IS NULL
      BEGIN
        INSERT INTO ${teamMemberTableRef()} (FullName, Nickname, Email, AppRole, Position, Color, IsActive)
        VALUES (@name, @nickname, @email, @role, '', @color, 1);
        SELECT CAST(SCOPE_IDENTITY() AS INT) AS Id, 'created' AS Outcome;
      END
      ELSE IF @wasActive = 1
      BEGIN
        SELECT @existingId AS Id, 'exists' AS Outcome;
      END
      ELSE
      BEGIN
        UPDATE ${teamMemberTableRef()}
        SET IsActive = 1,
            FullName = @name,
            Nickname = COALESCE(NULLIF(LTRIM(RTRIM(Nickname)), N''), @nickname),
            AppRole  = @role,
            UpdatedAt = GETDATE()
        WHERE Id = @existingId;
        SELECT @existingId AS Id, 'reactivated' AS Outcome;
      END`);

  const row = result.recordset[0];
  if (!row) throw new Error(`addOrReactivate() returned no row for ${email}`);
  return { id: Number(row.Id), outcome: row.Outcome };
}

/** Change someone's role. Rejects anything the check constraint would reject. */
export async function updateRole(id: number, appRole: string): Promise<void> {
  if (!isValidRole(appRole)) throw new Error(`Invalid role: ${appRole}`);

  const pool = await getProductionFormPool();
  await pool
    .request()
    .input("id", sql.Int, id)
    .input("role", sql.NVarChar, appRole.trim())
    .query(
      `UPDATE ${teamMemberTableRef()} SET AppRole = @role, UpdatedAt = GETDATE() WHERE Id = @id`,
    );
}

/**
 * Activate or retire someone. Retiring is a soft delete — the row stays, so
 * every request, approval and log entry that names it still resolves.
 */
export async function setActive(id: number, isActive: boolean): Promise<void> {
  const pool = await getProductionFormPool();
  await pool
    .request()
    .input("id", sql.Int, id)
    .input("active", sql.Bit, isActive)
    .query(
      `UPDATE ${teamMemberTableRef()} SET IsActive = @active, UpdatedAt = GETDATE() WHERE Id = @id`,
    );
}

/** Refresh a display name from the directory (the Users & Roles resync sweep). */
export async function updateFullName(id: number, fullName: string): Promise<void> {
  const name = (fullName ?? "").trim();
  if (!name) return;

  const pool = await getProductionFormPool();
  await pool
    .request()
    .input("id", sql.Int, id)
    .input("name", sql.NVarChar, name)
    .query(
      `UPDATE ${teamMemberTableRef()} SET FullName = @name, UpdatedAt = GETDATE() WHERE Id = @id`,
    );
}
