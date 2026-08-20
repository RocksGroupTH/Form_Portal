import { getAccPool, sql } from "@/lib/acc/pool";
import { writeBothPools } from "@/lib/acc/dual-write";
import { loadBookingTabsByApproverIds } from "@/lib/acc/travel-booking/booking-approver-tabs";

export interface BookingApproverRow {
  id: number;
  staffId: number;
  email: string;
  displayName: string;
  isActive: boolean;
  /**
   * The grantable AP-17 settings tabs this person holds, from
   * `AccBookingApproverTab`. `[]` means none — the rows ARE the granted set,
   * never "all". An admin's own tabs do not come from here; they see every one.
   */
  settingsTabs: string[];
}

/**
 * AP-17's access list. Deliberately separate from AP-1's `AccApprover`: a
 * booking admin is not an expense approver, and the reverse.
 *
 * A shared master table, so every write goes through `writeBothPools` and the
 * pair is asserted by `npm run check:alignment`.
 */
export async function listBookingApprovers(
  activeOnly = false,
): Promise<BookingApproverRow[]> {
  const pool = await getAccPool();
  const r = await pool.request().query(`
    SELECT Id, StaffId, Email, DisplayName, IsActive
    FROM [dbo].[AccBookingApprover]
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
  // One batch read for the whole page, the same shape AP-1's `listApprovers`
  // uses. `loadBookingTabsByApproverIds` degrades a *missing table* to no
  // grants and rethrows everything else on purpose — the admin grid this feeds
  // must show its error state rather than render an unreadable grant list as
  // every box unticked, because the next tick would then POST a one-element set
  // and revoke the rest.
  const tabMap = await loadBookingTabsByApproverIds(rows.map((row) => row.id));
  return rows.map((row) => ({ ...row, settingsTabs: tabMap.get(row.id) ?? [] }));
}

/**
 * The roster row's id for a StaffId, or null.
 *
 * `AccBookingApproverTab` hangs off `AccBookingApprover.Id`, but StaffId is the
 * table's natural key and the only identifier this app's routes derive
 * themselves (from HR, by email). Resolving here keeps a client-supplied id off
 * the path that decides whose grants are being replaced.
 */
export async function getBookingApproverIdByStaffId(
  staffId: number,
): Promise<number | null> {
  const pool = await getAccPool();
  const r = await pool
    .request()
    .input("staffId", sql.Int, staffId)
    .query(`SELECT Id FROM [dbo].[AccBookingApprover] WHERE StaffId = @staffId`);
  const id = r.recordset[0]?.Id as number | undefined;
  return id ?? null;
}

/** Add or update by StaffId — the natural key, so both databases agree. */
export async function upsertBookingApprover(a: {
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
        MERGE [dbo].[AccBookingApprover] WITH (HOLDLOCK) AS t
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
 * Soft delete / restore. Rows are never removed — history stays readable.
 *
 * `updatedBy` is stamped alongside `UpdatedAt`: turning access off is the one
 * write on this table with a real audit question behind it, and recording
 * *when* without *who* answers half of it. Optional only so a future
 * non-interactive caller (a script, a reconciliation sweep) can honestly say it
 * had no acting user rather than borrow one; every route call passes it.
 */
export async function setBookingApproverActive(
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
        UPDATE [dbo].[AccBookingApprover]
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
