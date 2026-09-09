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
   * Everything this person holds in `AccReimburseAccessTab` — **both
   * vocabularies**, despite the field's name: the grantable settings tabs
   * (`rules`, `brands`) *and* the menu keys (`approvalQueue`, `clearance`),
   * because `loadReimburseTabsByAccessIds` narrows with the union filter
   * `filterStorableReimburseKeys`. The name predates the menu keys and is kept
   * because it is the wire field the settings grid POSTs back; the grid renders
   * two checkbox groups off this one list, and each authorization surface
   * re-narrows it with its own filter (`filterGrantableReimburseTabKeys` /
   * `filterReimburseMenuKeys`).
   *
   * `[]` means none — the rows ARE the granted set, never "all". An admin's own
   * grants do not come from here; they see every tab and every menu.
   */
  settingsTabs: string[];
}

/**
 * AP-4's access list (migration 120).
 *
 * Deliberately **not** `AccReimburseApprover`. That table is the pool that takes
 * the ACCOUNT and ACCOUNT_FINAL steps, so a row on it approves real
 * reimbursement payments; hanging settings-tab grants there would make "may
 * edit the payment rules" and "may approve a payment" the same tick.
 *
 * This list grants **sight only** — of a settings tab, or, since 2026-09-08, of
 * a working screen (the `approvalQueue` / `clearance` menu keys share the same
 * `TabKey` column; see `./settings-tabs`). It never grants authority to act:
 * that is `AccReimburseApprover`, re-decided inside the approval service where
 * the money moves. Membership alone grants nothing either — the ticks do.
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
      // **An ABSENT `isActive` leaves an existing row's flag alone; only an
      // explicit boolean moves it.** It used to default to `true` and write
      // unconditionally, so a settings POST that simply omitted the field
      // reactivated a deactivated person — restoring their settings-tab grants
      // *and* the `approvalQueue` menu key, i.e. sight of every claim's number,
      // requester, amount and payment date. Nothing server-side prevented it;
      // the only thing that did was the grid echoing `isActive: row.isActive`
      // back on every save, which is a client-side invariant of exactly the
      // kind the sibling `AccReimburseApprover` bug was raised about.
      //
      // A brand-new row still defaults to active — `WHEN NOT MATCHED` has no
      // prior state to preserve, and adding somebody through the directory
      // search is a deliberate act. This is the same "absent is not null"
      // distinction `ApiKey`'s `expiresAt` PATCH makes, for the same reason:
      // "leave it alone" has to be expressible.
      .input("active", sql.Bit, a.isActive === undefined ? null : a.isActive)
      .input("by", sql.Int, a.createdBy ?? null)
      .query(`
        MERGE [dbo].[AccReimburseAccess] WITH (HOLDLOCK) AS t
        USING (SELECT @staffId AS StaffId) AS s ON t.StaffId = s.StaffId
        WHEN MATCHED THEN UPDATE SET
          Email = @email, DisplayName = @name,
          IsActive = COALESCE(@active, t.IsActive),
          UpdatedBy = @by, UpdatedAt = SYSDATETIME()
        WHEN NOT MATCHED THEN
          INSERT (StaffId, Email, DisplayName, IsActive, CreatedBy)
          VALUES (@staffId, @email, @name, COALESCE(@active, 1), @by);
      `);
  });
}

/**
 * Soft delete / restore — and, since review round 1 on the merged
 * สิทธิ์เข้าถึง grid (2026-09-10), the ONE off switch on that screen, so it
 * has to be honest about both grants a row can carry.
 *
 * **Before this fix it wrote `AccReimburseAccess.IsActive` alone.** The grid
 * shows a person's `AccReimburseApproverBrand` ticks on the very same row, so
 * an admin clicking "ปิด" here — reading only "ปิดสิทธิ์เข้าถึง" — would see
 * the row settle on a red "ปิด" badge while that person's
 * `AccReimburseApprover` row, and their brand ticks, stayed exactly as
 * active as before. The button lied about what it did.
 *
 * **Two independent `UPDATE`s, because a StaffId on this screen may have
 * either row without the other.** `settings/access`'s GET unions in
 * `AccReimburseApprover` rows with no matching `AccReimburseAccess` row (an
 * "orphan" — see that route's own docblock), and a freshly-added
 * สิทธิ์เข้าถึง row often has no `AccReimburseApprover` row yet (nobody has
 * ticked a brand for them). Both are legitimate, common states, so requiring
 * both tables to match before this succeeds would make the button fail for
 * exactly the rows review round 1 asked it to handle:
 *
 * - `AccReimburseAccess.IsActive` is set to `@active` outright, unchanged
 *   from before.
 * - `AccReimburseApprover.IsActive` is set to `@active AND (this approver
 *   currently holds ≥1 AccReimburseApproverBrand row)` — computed with a live
 *   `EXISTS`, never trusted from the caller, so this path cannot violate the
 *   invariant `setReimburseApproverBrands` maintains: `IsActive` can never be
 *   1 for zero ticks. Deactivating always succeeds (`@active = 0`
 *   short-circuits the `CASE` to 0 regardless of ticks); reactivating restores
 *   approval authority only when the person still holds a tick — turning
 *   สิทธิ์เข้าถึง back on for somebody who was never an approver, or who has
 *   since been unticked to zero brands, must not silently hand them approval
 *   back.
 *
 * **Brand rows are never touched here.** Deactivating clears `IsActive` but
 * leaves every `AccReimburseApproverBrand` row exactly as it was — the same
 * "revokes without deleting" shape `AccReimburseAccessTab` already has (see
 * that table's own service) — so the grid keeps showing the ticks on a "ปิด"
 * row (an admin needs to see what a deactivated person still holds, and to
 * set it up before switching them back on) and reactivating restores exactly
 * the same authority they had, not a blank slate.
 *
 * **Throws only when NEITHER table has a matching StaffId** — a genuinely
 * unknown person. Either update alone landing is not an error: a StaffId
 * with only a settings-access row, or only an approver row, is the normal
 * case this fix exists to keep working.
 *
 * `updatedBy` is stamped alongside `UpdatedAt` on whichever row(s) exist:
 * turning access off is the one write on this table with a real audit
 * question behind it, and recording *when* without *who* answers half of it.
 * Optional only so a future non-interactive caller can honestly say it had no
 * acting user rather than borrow one; every route call passes it.
 */
export async function setReimburseAccessAndApprovalActive(
  staffId: number,
  isActive: boolean,
  updatedBy?: number | null,
): Promise<void> {
  await writeBothPools(async (tx) => {
    const accessResult = await tx
      .request()
      .input("staffId", sql.Int, staffId)
      .input("active", sql.Bit, isActive)
      .input("by", sql.Int, updatedBy ?? null)
      .query(`
        UPDATE [dbo].[AccReimburseAccess]
        SET IsActive = @active, UpdatedBy = @by, UpdatedAt = SYSDATETIME()
        WHERE StaffId = @staffId
      `);

    // `EXISTS` against the approver's OWN brand rows, evaluated live inside
    // this same UPDATE — not a count passed in from the caller, so a stale
    // read can never tell this statement a tick exists when it does not (or
    // the reverse). Deactivating (`@active = 0`) never reaches the `EXISTS`
    // branch at all: the CASE's first arm already answers 0.
    const approverResult = await tx
      .request()
      .input("staffId", sql.Int, staffId)
      .input("active", sql.Bit, isActive)
      .input("by", sql.Int, updatedBy ?? null)
      .query(`
        UPDATE a
        SET a.IsActive = CASE
              WHEN @active = 0 THEN 0
              WHEN EXISTS (
                SELECT 1 FROM [dbo].[AccReimburseApproverBrand] b
                WHERE b.ApproverId = a.Id
              ) THEN 1
              ELSE 0
            END,
            a.UpdatedBy = @by,
            a.UpdatedAt = SYSDATETIME()
        FROM [dbo].[AccReimburseApprover] a
        WHERE a.StaffId = @staffId
      `);

    // Check the row counts rather than reporting success on a double no-op. A
    // PATCH for a StaffId on NEITHER roster would otherwise answer ok, and the
    // caller would believe something had been revoked when nothing was
    // written. Throwing inside writeBothPools rolls both databases back,
    // which is also what should happen if the two ever disagree about who is
    // on either list.
    if (accessResult.rowsAffected[0] !== 1 && approverResult.rowsAffected[0] !== 1) {
      throw new Error(`ไม่พบผู้มีสิทธิ์เข้าถึงหรือผู้อนุมัติรหัสพนักงาน ${staffId}`);
    }
  });
}
