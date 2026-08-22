import { getAccPool, sql } from "@/lib/acc/pool";
import { writeBothPools } from "@/lib/acc/dual-write";
import { loadReimburseTabsByAccessIds } from "@/lib/acc/reimburse/access-tabs";

export interface ReimburseAccessRow {
  id: number;
  staffId: number;
  email: string;
  displayName: string;
  isActive: boolean;
  /**
   * The grantable AP-4 settings tabs this person holds, from
   * `AccReimburseAccessTab`. `[]` means none — the rows ARE the granted set,
   * never "all". An admin's own tabs do not come from here; they see every one.
   */
  settingsTabs: string[];
}

/**
 * AP-4's access list (migration 106).
 *
 * Deliberately **not** `AccReimburseApprover`. That table is the pool that takes
 * the ACCOUNT and ACCOUNT_FINAL steps, so a row on it approves real
 * reimbursement payments; hanging settings-tab grants there would make "may
 * edit the payment rules" and "may approve a payment" the same tick. This list
 * grants nothing but settings tabs, and membership alone grants none of those —
 * the ticks do.
 *
 * A shared master table, so every write goes through `writeBothPools` and the
 * pair is asserted by `npm run check:alignment`.
 */
export async function listReimburseAccess(
  activeOnly = false,
): Promise<ReimburseAccessRow[]> {
  const pool = await getAccPool();
  const r = await pool.request().query(`
    SELECT Id, StaffId, Email, DisplayName, IsActive
    FROM [dbo].[AccReimburseAccess]
    ${activeOnly ? "WHERE IsActive = 1" : ""}
    ORDER BY DisplayName, StaffId
  `);
  const rows = (r.recordset as Array<{
    Id: number; StaffId: number; Email: string; DisplayName: string; IsActive: boolean;
  }>).map((x) => ({
    id: x.Id,
    staffId: x.StaffId,
    email: x.Email,
    displayName: x.DisplayName,
    isActive: !!x.IsActive,
  }));
  // One batch read for the whole page. `loadReimburseTabsByAccessIds` degrades a
  // *missing table* to no grants and rethrows everything else on purpose — the
  // admin grid this feeds must show its error state rather than render an
  // unreadable grant list as every box unticked, because the next tick would
  // then POST a one-element set and revoke the rest.
  const tabMap = await loadReimburseTabsByAccessIds(rows.map((row) => row.id));
  return rows.map((row) => ({ ...row, settingsTabs: tabMap.get(row.id) ?? [] }));
}

/**
 * The roster row's id for a StaffId, or null.
 *
 * `AccReimburseAccessTab` hangs off `AccReimburseAccess.Id`, but StaffId is the
 * table's natural key and the only identifier this app's routes derive
 * themselves (from HR, by email). Resolving here keeps a client-supplied id off
 * the path that decides whose grants are being replaced.
 */
export async function getReimburseAccessIdByStaffId(
  staffId: number,
): Promise<number | null> {
  const pool = await getAccPool();
  const r = await pool
    .request()
    .input("staffId", sql.Int, staffId)
    .query(`SELECT Id FROM [dbo].[AccReimburseAccess] WHERE StaffId = @staffId`);
  const id = r.recordset[0]?.Id as number | undefined;
  return id ?? null;
}

/** Add or update by StaffId — the natural key, so both databases agree. */
export async function upsertReimburseAccess(a: {
  staffId: number;
  email: string;
  displayName: string;
  isActive?: boolean;
  createdBy?: number | null;
}): Promise<void> {
  await writeBothPools(async (tx) => {
    await tx
      .request()
      .input("staffId", sql.Int, a.staffId)
      .input("email", sql.NVarChar(200), a.email)
      .input("name", sql.NVarChar(200), a.displayName)
      .input("active", sql.Bit, a.isActive === undefined ? true : a.isActive)
      .input("by", sql.Int, a.createdBy ?? null)
      .query(`
        MERGE [dbo].[AccReimburseAccess] WITH (HOLDLOCK) AS t
        USING (SELECT @staffId AS StaffId) AS s ON t.StaffId = s.StaffId
        WHEN MATCHED THEN UPDATE SET
          Email = @email, DisplayName = @name, IsActive = @active,
          UpdatedBy = @by, UpdatedAt = SYSDATETIME()
        WHEN NOT MATCHED THEN
          INSERT (StaffId, Email, DisplayName, IsActive, CreatedBy)
          VALUES (@staffId, @email, @name, @active, @by);
      `);
  });
}

/**
 * Soft delete / restore. Rows are never removed — history stays readable, and
 * the grant rows survive, so restoring someone restores exactly the tabs they
 * had (`resolveReimburseTabsByEmail` tests `IsActive`, not the grant rows).
 *
 * `updatedBy` is stamped alongside `UpdatedAt`: turning access off is the one
 * write on this table with a real audit question behind it, and recording
 * *when* without *who* answers half of it. Optional only so a future
 * non-interactive caller can honestly say it had no acting user rather than
 * borrow one; every route call passes it.
 */
export async function setReimburseAccessActive(
  staffId: number,
  isActive: boolean,
  updatedBy?: number | null,
): Promise<void> {
  await writeBothPools(async (tx) => {
    const r = await tx
      .request()
      .input("staffId", sql.Int, staffId)
      .input("active", sql.Bit, isActive)
      .input("by", sql.Int, updatedBy ?? null)
      .query(`
        UPDATE [dbo].[AccReimburseAccess]
        SET IsActive = @active, UpdatedBy = @by, UpdatedAt = SYSDATETIME()
        WHERE StaffId = @staffId
      `);
    // Check the row count rather than reporting success on a no-op. A PATCH for
    // a StaffId that is not on the roster would otherwise answer ok, and the
    // caller would believe access had been revoked when nothing was written.
    // Throwing inside writeBothPools rolls both databases back, which is also
    // what should happen if the two ever disagree about who is on the list.
    if (r.rowsAffected[0] !== 1) {
      throw new Error(`ไม่พบผู้มีสิทธิ์เข้าถึงรหัสพนักงาน ${staffId}`);
    }
  });
}
