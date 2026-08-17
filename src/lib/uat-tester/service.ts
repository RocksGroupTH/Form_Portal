import { cache } from "react";
import { getCorePool, sql } from "@/lib/db/mssql";

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
      UPDATE [dbo].[UatTester] WITH (UPDLOCK, HOLDLOCK)
      SET Email = @email, ManagerStaffId = @managerStaffId, ManagerEmail = @managerEmail,
          UpdatedBy = @by, UpdatedAt = SYSDATETIME()
      WHERE StaffId = @staffId;
      IF @@ROWCOUNT = 0
        INSERT INTO [dbo].[UatTester] (StaffId, Email, ManagerStaffId, ManagerEmail, IsActive, UpdatedBy)
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
