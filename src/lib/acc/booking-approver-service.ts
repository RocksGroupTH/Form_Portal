import { getAccPool, sql } from "@/lib/acc/pool";
import { writeBothPools } from "@/lib/acc/dual-write";
import { loadBookingBrandsByApproverIds } from "@/lib/acc/travel-booking/booking-approver-brands";
import { loadBookingTabsByApproverIds } from "@/lib/acc/travel-booking/booking-approver-tabs";
import { loadBookingAreasByApproverIds } from "@/lib/acc/travel-booking/booking-approver-areas";
import {
  BOOKING_AREAS,
  BOOKING_AREA_COLUMN,
  type BookingAreaKey,
} from "@/lib/acc/travel-booking/booking-areas";

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
  /**
   * Which brands' AP-17 requests this person may see, from
   * `AccBookingApproverBrand` (migration 134).
   *
   * **`null` means EVERY brand**, and that is the opposite of `settingsTabs`
   * above, where `[]` means none. Those rows grant something new; these narrow
   * something the roster already carries, so no rows has to mean no narrowing.
   * There is deliberately no representable "sees no brands".
   */
  brandCodes: string[] | null;
  /**
   * Which of AP-17's three menus this person may open — `CanQueue` /
   * `CanAccount` / `CanReport` on this very row (migration 124), **the same
   * columns ACC Portal reads and writes**.
   *
   * A third meaning of an empty list, and the three must be kept apart:
   * `settingsTabs: []` is no grants, `brandCodes: null` is every brand, and
   * `areas: []` is **no menus** — a roster member who can open nothing. The
   * columns default to 1, so that state is reached only by an admin
   * deliberately unticking all three.
   */
  areas: BookingAreaKey[];
  /**
   * Whether this approver may open the Message tab — `AccBookingApprover.CanMessage`
   * (migration 166), a COLUMN rather than a `settingsTabs` entry or a fourth
   * menu area. See `@/lib/acc/message-grant` for why `messages` is
   * deliberately never one of the `settingsTabs` keys above.
   */
  canMessage: boolean;
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
  // `CanMessage` rides along on this same row — it is a column (migration
  // 166), not a child-table join like `settingsTabs` / `brandCodes` / `areas`
  // below, so it needs no separate fail-closed loader.
  const r = await pool.request().query(`
    SELECT Id, StaffId, Email, DisplayName, IsActive, CanMessage
    FROM [dbo].[AccBookingApprover]
    ${activeOnly ? "WHERE IsActive = 1" : ""}
    ORDER BY DisplayName, StaffId
  `);
  const rows = (r.recordset as Array<{
    Id: number; StaffId: number; Email: string; DisplayName: string; IsActive: boolean;
    CanMessage: boolean;
  }>).map((x) => ({
    id: x.Id,
    staffId: x.StaffId,
    email: x.Email,
    displayName: x.DisplayName,
    isActive: !!x.IsActive,
    canMessage: !!x.CanMessage,
  }));
  // One batch read for the whole page, the same shape AP-1's `listApprovers`
  // uses. `loadBookingTabsByApproverIds` degrades a *missing table* to no
  // grants and rethrows everything else on purpose — the admin grid this feeds
  // must show its error state rather than render an unreadable grant list as
  // every box unticked, because the next tick would then POST a one-element set
  // and revoke the rest.
  const ids = rows.map((row) => row.id);
  const tabMap = await loadBookingTabsByApproverIds(ids);
  // The brand scope, alongside. `null` means every brand — the rows ARE the
  // scope, and there is no "no brands" state to render. Its own loader degrades
  // a missing table to null (unrestricted) and rethrows everything else, the
  // opposite direction from the tab loader above and for the opposite reason:
  // those rows grant, these narrow.
  const brandMap = await loadBookingBrandsByApproverIds(ids);
  // And the menu grants, which are columns on the rows already selected
  // above rather than a child table — read through their own loader anyway,
  // so the missing-column degrade lives in one place and this function does
  // not have to name the columns twice.
  const areaMap = await loadBookingAreasByApproverIds(ids);
  return rows.map((row) => ({
    ...row,
    settingsTabs: tabMap.get(row.id) ?? [],
    brandCodes: brandMap.get(row.id) ?? null,
    areas: areaMap.get(row.id) ?? [],
  }));
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
/**
 * Add or update by StaffId — the natural key, so both databases agree.
 *
 * **`areas` is three-valued exactly as the route's `settingsTabs` is:**
 * omitted leaves the columns as they are, an array is the whole granted set,
 * and `[]` revokes all three. Adding somebody from the directory sends no
 * `areas`, so the INSERT takes migration 124's `DEFAULT 1` and a new approver
 * arrives holding every menu — which is what being on this roster meant
 * before 124 split it, and what ACC Portal's own add does.
 *
 * The SET fragment is BUILT from `BOOKING_AREAS` rather than typed out, so a
 * fourth area cannot be added to that list and silently miss the write that
 * stores it.
 */
export async function upsertBookingApprover(a: {
  staffId: number;
  email: string;
  displayName: string;
  isActive?: boolean;
  createdBy?: number | null;
  areas?: BookingAreaKey[];
  /**
   * Three-valued, same shape as `areas`: omitted leaves `CanMessage`
   * (migration 166) alone; a boolean sets it. Never posted by the "add
   * approver" flow, so a brand-new row keeps the column's own `DEFAULT 0`
   * rather than this function silently granting the tab to somebody nobody
   * ticked. Deliberately not a fourth `BookingAreaKey` — see
   * `@/lib/acc/message-grant` for why the Message grant is not a menu area.
   */
  canMessage?: boolean;
}): Promise<void> {
  const setAreas = a.areas !== undefined;
  const granted = a.areas ?? [];
  const setCanMessage = a.canMessage !== undefined;
  await writeBothPools(async (tx) => {
    const req = tx
      .request()
      .input("staffId", sql.Int, a.staffId)
      .input("email", sql.NVarChar(200), a.email)
      .input("name", sql.NVarChar(200), a.displayName)
      .input("active", sql.Bit, a.isActive === undefined ? true : a.isActive)
      .input("by", sql.Int, a.createdBy ?? null)
      .input("canMessage", sql.Bit, a.canMessage ?? false);
    for (const area of BOOKING_AREAS) {
      req.input(`area_${area.key}`, sql.Bit, granted.indexOf(area.key) >= 0);
    }
    const areaSet = BOOKING_AREAS.map(
      (area) => `, ${BOOKING_AREA_COLUMN[area.key]} = @area_${area.key}`,
    ).join("");
    await req.query(`
      MERGE [dbo].[AccBookingApprover] WITH (HOLDLOCK) AS t
      USING (SELECT @staffId AS StaffId) AS s ON t.StaffId = s.StaffId
      WHEN MATCHED THEN UPDATE SET
        Email = @email, DisplayName = @name, IsActive = @active,
        UpdatedBy = @by, UpdatedAt = SYSDATETIME()${setAreas ? areaSet : ""}${
          setCanMessage ? ", CanMessage = @canMessage" : ""
        }
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
