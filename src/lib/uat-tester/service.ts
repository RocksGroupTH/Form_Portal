import { cache } from "react";
import { getCorePool, sql } from "@/lib/db/mssql";
import { EMPLOYEE_STATUS_ACTIVE } from "@/lib/hr/constants";
import { getHrPool } from "@/lib/hr/pool";

export interface UatTesterRow {
  id: number;
  staffId: number;
  email: string;
  managerStaffId: number | null;
  managerEmail: string | null;
  isActive: boolean;
  updatedBy: number | null;
  updatedAt: Date | null;
}

interface UatTesterRecord {
  Id: number;
  StaffId: number;
  Email: string;
  ManagerStaffId: number | null;
  ManagerEmail: string | null;
  IsActive: boolean;
  UpdatedBy: number | null;
  UpdatedAt: Date | null;
}

function toRow(r: UatTesterRecord): UatTesterRow {
  return {
    id: r.Id,
    staffId: r.StaffId,
    email: r.Email,
    managerStaffId: r.ManagerStaffId,
    managerEmail: r.ManagerEmail,
    isActive: !!r.IsActive,
    updatedBy: r.UpdatedBy,
    updatedAt: r.UpdatedAt,
  };
}

/**
 * Loads the active tester row for an already-normalized (trimmed, lower-cased)
 * email. Kept separate from `getActiveUatTester` so `cache()`'s key is the
 * normalized value: without this split, "A@x.com", "a@x.com" and " a@x.com "
 * would each be a distinct cache entry and a distinct DB read within the same
 * request.
 *
 * `IX_UatTester_Email` is not unique, so `ORDER BY Id` makes the pick
 * deterministic — otherwise two active rows sharing an email could resolve to
 * a different row (and a different UAT manager) on different requests.
 */
const load = cache(async (key: string): Promise<UatTesterRow | null> => {
  const pool = await getCorePool();
  const r = await pool
    .request()
    .input("email", sql.NVarChar, key)
    .query<UatTesterRecord>(`
      SELECT TOP (1) Id, StaffId, Email, ManagerStaffId, ManagerEmail, IsActive, UpdatedBy, UpdatedAt
      FROM [dbo].[UatTester]
      WHERE IsActive = 1
        AND LOWER(LTRIM(RTRIM(Email))) = LOWER(LTRIM(RTRIM(@email)))
      ORDER BY Id
    `);
  const row = r.recordset[0];
  return row ? toRow(row) : null;
});

/**
 * The active tester row for an email, or null.
 *
 * Case- and whitespace-insensitive on both sides — `listMyWorkRows` already
 * burned on a raw `=` comparison, so this matches on
 * `LOWER(LTRIM(RTRIM(...)))` instead. A blank/missing email always resolves
 * to null without reaching the database, so callers with no viewer (a
 * script, an unauthenticated request) get the safe answer for free.
 *
 * The DB-hitting half is wrapped in react `cache()` so the resolver, the
 * layout and any API route that also needs it share one read per request
 * instead of one each; normalizing here (before the cache key is formed)
 * keeps differently-cased/spaced spellings of the same email as one entry.
 */
export function getActiveUatTester(email: string | null): Promise<UatTesterRow | null> {
  const key = (email ?? "").trim().toLowerCase();
  return key ? load(key) : Promise.resolve(null);
}

/**
 * The active tester row for an HR StaffId, or null.
 *
 * `UQ_UatTester_StaffId` makes this the table's real identity key, so unlike the
 * email lookup there is nothing to disambiguate. Wrapped in the same react
 * `cache()` for the same reason: `uatManagerFor` reads the requester's row and
 * then the manager's row, and a submit resolves the requester more than once.
 */
const loadByStaffId = cache(async (staffId: number): Promise<UatTesterRow | null> => {
  const pool = await getCorePool();
  const r = await pool
    .request()
    .input("staffId", sql.Int, staffId)
    .query<UatTesterRecord>(`
      SELECT TOP (1) Id, StaffId, Email, ManagerStaffId, ManagerEmail, IsActive, UpdatedBy, UpdatedAt
      FROM [dbo].[UatTester]
      WHERE IsActive = 1 AND StaffId = @staffId
    `);
  const row = r.recordset[0];
  return row ? toRow(row) : null;
});

/** The active tester row for an HR StaffId, or null. */
export function getActiveUatTesterByStaffId(
  staffId: number | null | undefined,
): Promise<UatTesterRow | null> {
  return typeof staffId === "number" && Number.isInteger(staffId) && staffId > 0
    ? loadByStaffId(staffId)
    : Promise.resolve(null);
}

/**
 * The active tester row for a person identified either way, or null.
 *
 * StaffId first, email second — and both are needed. `UatTester.Email` holds the
 * **login** (Entra) address the admin picked in Settings, while the address a
 * form snapshot carries is HR's `Employee.Email ?? EmailCompBr`; those are
 * allowed to differ for one person, since `findActiveEmployeeByEmail` matches
 * either column. Keying on StaffId first means a tester whose two addresses
 * disagree is still recognised — and being unrecognised here would silently drop
 * their UAT request back onto their real HR manager, the exact outcome parallel
 * UAT exists to prevent.
 */
export async function getActiveUatTesterFor(
  email: string | null,
  staffId: number | null,
): Promise<UatTesterRow | null> {
  const byStaffId = await getActiveUatTesterByStaffId(staffId);
  if (byStaffId) return byStaffId;
  return getActiveUatTester(email);
}

/** A UAT manager, resolved from HR so it is shape-identical to a production one. */
export interface UatManager {
  staffId: number;
  email: string | null;
}

/**
 * The active HR identity behind a StaffId, or null — the same row and the same
 * `COALESCE(Email, EmailCompBr)` projection `resolveManagerEmail` reads, so a
 * UAT manager's `AssignedTo`/`AssignedEmail` pair cannot disagree with what that
 * mapper would produce for the same StaffId.
 */
const loadHrIdentity = cache(async (staffId: number): Promise<UatManager | null> => {
  const pool = await getHrPool();
  const r = await pool
    .request()
    .input("sid", sql.Int, staffId)
    .input("status", sql.NVarChar, EMPLOYEE_STATUS_ACTIVE)
    .query<{ StaffId: number; Email: string | null }>(`
      SELECT TOP 1 StaffId, COALESCE(Email, EmailCompBr) AS Email
      FROM dbo.Employee WHERE StaffId = @sid AND Status = @status
    `);
  const row = r.recordset[0];
  return row ? { staffId: row.StaffId, email: row.Email ?? null } : null;
});

/**
 * The manager a UAT request routes to, or null when the requester is not a
 * tester or has no usable UAT manager set. Callers must refuse the submit rather
 * than fall back to HR — a real manager must never be handed test data.
 *
 * Three things have to hold, and all three are checked here rather than trusted
 * from the `UatTester` row:
 *
 * 1. The **requester** (never the actor — an on-behalf submit routes to the
 *    requester's manager) is an active tester with `ManagerStaffId` set.
 * 2. That manager is **still** an active tester. Settings enforces this when the
 *    manager is chosen, but nothing re-checks it when the manager is later
 *    deactivated, and Settings is not consulted at submit time — without this
 *    the approval chain would silently leave the tester group.
 * 3. That manager is a real, active HR employee. Both approval gates read the
 *    row this feeds: AP-1's `canActManagerStep` accepts `AssignedTo` **or**
 *    `AssignedEmail`, while AP-17's approve/reject/return routes compare the
 *    actor's HR StaffId against `AccRequest.ManagerStaffId` alone. A StaffId with
 *    no active HR row would pass neither.
 *
 * …and the manager must be somebody else. The settings API refuses a tester who
 * points at themselves, but `UatTester` has no CHECK constraint behind it
 * (migration 063: `StaffId` UNIQUE, `ManagerStaffId INT NULL`), so a row written
 * by direct SQL would let a tester approve their own UAT request — and the pilot
 * would never rehearse the two-party hop it exists to rehearse.
 *
 * Any of these failing returns null, which reads to the caller exactly like
 * "no UAT manager configured" — one refusal, one remedy (Settings → UAT Users).
 */
export async function uatManagerFor(
  requesterEmail: string | null,
  requesterStaffId: number | null,
): Promise<UatManager | null> {
  const requester = await getActiveUatTesterFor(requesterEmail, requesterStaffId);
  const managerStaffId = requester?.managerStaffId ?? null;
  if (!managerStaffId) return null;
  if (requester && managerStaffId === requester.staffId) return null;

  const managerIsTester = await getActiveUatTesterByStaffId(managerStaffId);
  if (!managerIsTester) return null;

  return loadHrIdentity(managerStaffId);
}

/**
 * The UAT manager StaffId for each of many requesters, in one round trip.
 *
 * The on-behalf colleague picker needs this for a whole department at once, and
 * calling `uatManagerFor` per colleague would be three reads per row. The self
 * join applies the same two membership rules that function checks one at a time:
 * the requester is an active tester with a manager set, and that manager is an
 * active tester too — plus the "not yourself" rule, which no constraint enforces.
 *
 * HR liveness is **not** checked here; the caller resolves the manager rows out
 * of HR anyway, and a StaffId with no active row simply produces no manager.
 * StaffIds absent from the result have no usable UAT manager.
 */
export async function uatManagerStaffIdsFor(
  staffIds: number[],
): Promise<Map<number, number>> {
  const wanted = Array.from(
    new Set(staffIds.filter((id) => Number.isInteger(id) && id > 0)),
  );
  const out = new Map<number, number>();
  if (wanted.length === 0) return out;

  const pool = await getCorePool();
  const req = pool.request();
  const placeholders: string[] = [];
  wanted.forEach((id, i) => {
    req.input(`s${i}`, sql.Int, id);
    placeholders.push(`@s${i}`);
  });

  const r = await req.query<{ StaffId: number; ManagerStaffId: number }>(`
    SELECT t.StaffId, t.ManagerStaffId
    FROM [dbo].[UatTester] t
    INNER JOIN [dbo].[UatTester] m
      ON m.StaffId = t.ManagerStaffId AND m.IsActive = 1
    WHERE t.IsActive = 1
      AND t.ManagerStaffId IS NOT NULL
      AND t.ManagerStaffId <> t.StaffId
      AND t.StaffId IN (${placeholders.join(", ")})
  `);

  for (const row of r.recordset) out.set(row.StaffId, row.ManagerStaffId);
  return out;
}

/** Every tester, active or not — the Settings → UAT Users table shows both. */
export async function listUatTesters(): Promise<UatTesterRow[]> {
  const pool = await getCorePool();
  const r = await pool.request().query<UatTesterRecord>(`
    SELECT Id, StaffId, Email, ManagerStaffId, ManagerEmail, IsActive, UpdatedBy, UpdatedAt
    FROM [dbo].[UatTester]
    ORDER BY Email
  `);
  return r.recordset.map(toRow);
}

export interface UpsertUatTesterInput {
  staffId: number;
  email: string;
  managerStaffId: number | null;
  managerEmail: string | null;
  updatedBy: number;
}

/**
 * Add a tester, or update an existing one's email/manager by StaffId
 * (`UQ_UatTester_StaffId`). Does not touch `IsActive` on update — reactivating
 * a removed tester is `setUatTesterActive`'s job, not an implicit side effect
 * of editing their manager.
 *
 * `MERGE ... WITH (HOLDLOCK)` in a single statement, not the previous
 * `UPDATE WITH (UPDLOCK, HOLDLOCK)` then `IF @@ROWCOUNT = 0 INSERT` pair: in
 * SQL Server autocommit, each statement in that pair is its own transaction,
 * so the UPDATE's lock was released before the INSERT ran and two concurrent
 * upserts for a StaffId with no existing row could both see zero rows updated
 * and both attempt the INSERT, racing onto `UQ_UatTester_StaffId`. MERGE
 * evaluates the match and applies the branch in one atomic statement, and
 * `WITH (HOLDLOCK)` holds a serializable-equivalent lock on the StaffId for
 * its duration, closing that window. Chosen over wrapping the original pair
 * in an explicit `sql.Transaction` because `setFormFlag`
 * (`src/lib/form-environment/service.ts`) already solved the identical
 * problem this way — one idiom for "upsert with a unique key" in this
 * codebase beats two, and MERGE needs no manual commit/rollback bookkeeping.
 */
export async function upsertUatTester(input: UpsertUatTesterInput): Promise<void> {
  const staffId = input.staffId;
  if (!Number.isInteger(staffId) || staffId <= 0) throw new Error("staffId is required");
  const email = (input.email ?? "").trim();
  if (!email) throw new Error("email is required");

  const pool = await getCorePool();
  await pool
    .request()
    .input("staffId", sql.Int, staffId)
    .input("email", sql.NVarChar, email)
    .input("managerStaffId", sql.Int, input.managerStaffId)
    .input("managerEmail", sql.NVarChar, input.managerEmail)
    .input("by", sql.Int, input.updatedBy)
    .query(`
      MERGE [dbo].[UatTester] WITH (HOLDLOCK) AS t
      USING (SELECT @staffId AS StaffId) AS s ON t.StaffId = s.StaffId
      WHEN MATCHED THEN UPDATE SET Email = @email, ManagerStaffId = @managerStaffId, ManagerEmail = @managerEmail,
          UpdatedBy = @by, UpdatedAt = SYSDATETIME()
      WHEN NOT MATCHED THEN INSERT (StaffId, Email, ManagerStaffId, ManagerEmail, IsActive, UpdatedBy)
        VALUES (@staffId, @email, @managerStaffId, @managerEmail, 1, @by);
    `);
}

/** Flip a tester's active flag by Id, without touching their email/manager. */
export async function setUatTesterActive(
  id: number,
  isActive: boolean,
  userId: number,
): Promise<void> {
  const pool = await getCorePool();
  await pool
    .request()
    .input("id", sql.Int, id)
    .input("isActive", sql.Bit, isActive)
    .input("by", sql.Int, userId)
    .query(`
      UPDATE [dbo].[UatTester]
      SET IsActive = @isActive, UpdatedBy = @by, UpdatedAt = SYSDATETIME()
      WHERE Id = @id;
    `);
}
