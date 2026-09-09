/**
 * AP-4 settings reads: the acknowledgement checklist and the accounting
 * approver pool. Both on `getAccPool()`, so they follow the form's resolved
 * Production/UAT environment (Settings → Form Environment) like every other
 * Acc* read.
 */
import { getAccPool, sql } from "@/lib/acc/pool";
import { writeBothPools } from "@/lib/acc/dual-write";
import { RULE_TEXT_MAX } from "@/features/reimburse/constants";
import type { ReimburseApprover, ReimburseRule } from "@/features/reimburse/types";
import { isApproverScope, normalizeScopeTargets } from "./brand-scope";

/** Every currently-active rule a requester must tick before submitting (spec §5.2 field 6), in display order. */
export async function listActiveRules(): Promise<ReimburseRule[]> {
  const pool = await getAccPool();
  const r = await pool
    .request()
    .query(
      `SELECT Id, RuleText, SortOrder, IsActive
       FROM [dbo].[AccReimburseRule]
       WHERE IsActive = 1
       ORDER BY SortOrder, Id`,
    );
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    id: x.Id as number,
    ruleText: x.RuleText as string,
    sortOrder: (x.SortOrder as number) ?? 0,
    isActive: !!x.IsActive,
  }));
}

/**
 * The full AP-4 accounting-approver roster (active and inactive), by display
 * name. One pool covers both the `ACCOUNT` and `ACCOUNT_FINAL` steps (spec
 * §2.5) — which of the two a given person ends up actioning is decided by who
 * gets there first, bounded by the two-person rule (`canActFinalStep`).
 */
export async function listReimburseApprovers(): Promise<ReimburseApprover[]> {
  const pool = await getAccPool();
  const r = await pool
    .request()
    .query(
      `SELECT Id, StaffId, Email, DisplayName, IsActive
       FROM [dbo].[AccReimburseApprover]
       ORDER BY DisplayName, StaffId`,
    );
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    id: x.Id as number,
    staffId: x.StaffId as number,
    email: x.Email as string,
    displayName: x.DisplayName as string,
    isActive: !!x.IsActive,
  }));
}

/* ─────────────────────────── writes ─────────────────────────── */

/**
 * Every write below goes through `writeBothPools`, not `getAccPool()`.
 *
 * These two tables are configuration, and AP-4 resolves its database per viewer
 * like every other form: a tester in UAT mode reads `AccReimburseApprover` out
 * of `Rocks_Portal_Form_UAT`. Saving to one database only would leave the UAT
 * side with an empty approver pool — precisely the state that makes AP-4's
 * accounting steps refuse everyone — and a checklist whose rule ids do not match
 * the `AccReimburseRuleAck` rows written against them. Same reasoning, and the
 * same mechanism, as `AccApprover` and `AccVehicle` in `../settings-service.ts`.
 *
 * The invariant dual-write depends on holds for both tables: migrations 089 and
 * 090 created them in the two databases from the same script, 089 seeding the
 * identical single rule, so their identity counters start in lockstep and stay
 * there as long as every insert arrives through here. `npm run check:alignment`
 * is what asserts it.
 */

/*
 * `RULE_TEXT_MAX` and `validateRuleText` used to live here. They moved to
 * `@/features/reimburse/constants` — which imports nothing, so the
 * 1,000-character boundary can be unit-tested; this module's `getAccPool`
 * import pulls in `@/env` and a live configuration at module scope. The bound
 * is still used below, to size the `NVarChar` parameters.
 */

/** The whole checklist, active and inactive, in display order — the Settings view. */
export async function listAllRules(): Promise<ReimburseRule[]> {
  const pool = await getAccPool();
  const r = await pool
    .request()
    .query(
      `SELECT Id, RuleText, SortOrder, IsActive
       FROM [dbo].[AccReimburseRule]
       ORDER BY SortOrder, Id`,
    );
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    id: x.Id as number,
    ruleText: x.RuleText as string,
    sortOrder: (x.SortOrder as number) ?? 0,
    isActive: !!x.IsActive,
  }));
}

/**
 * Append a rule to the end of the checklist.
 *
 * `SortOrder` is computed inside each transaction rather than read first and
 * passed in: the two databases are aligned, so the same expression yields the
 * same number in both, and a read from `getAccPool()` would have taken it from
 * whichever environment the editing admin happens to be resolved to.
 */
export async function createRule(ruleText: string, userId: number): Promise<void> {
  await writeBothPools(async (tx) => {
    await tx
      .request()
      .input("text", sql.NVarChar(RULE_TEXT_MAX), ruleText)
      .input("user", sql.Int, userId || null)
      .query(
        `INSERT INTO [dbo].[AccReimburseRule] (RuleText, SortOrder, IsActive, UpdatedBy)
         SELECT @text, ISNULL(MAX(SortOrder), 0) + 1, 1, @user FROM [dbo].[AccReimburseRule]`,
      );
  });
}

/** Reword an existing rule in place. The id is kept, so acknowledgements survive. */
export async function updateRuleText(id: number, ruleText: string, userId: number): Promise<void> {
  await writeBothPools(async (tx) => {
    await tx
      .request()
      .input("id", sql.Int, id)
      .input("text", sql.NVarChar(RULE_TEXT_MAX), ruleText)
      .input("user", sql.Int, userId || null)
      .query(
        `UPDATE [dbo].[AccReimburseRule]
         SET RuleText = @text, UpdatedBy = @user, UpdatedAt = SYSDATETIME()
         WHERE Id = @id`,
      );
  });
}

/**
 * Retire a rule, or bring it back. Never a DELETE: `AccReimburseRuleAck` holds a
 * foreign key to this row for every request that ticked it, and a submitted
 * claim has to keep being able to say what its author agreed to.
 */
export async function setRuleActive(id: number, isActive: boolean, userId: number): Promise<void> {
  await writeBothPools(async (tx) => {
    await tx
      .request()
      .input("id", sql.Int, id)
      .input("active", sql.Bit, isActive ? 1 : 0)
      .input("user", sql.Int, userId || null)
      .query(
        `UPDATE [dbo].[AccReimburseRule]
         SET IsActive = @active, UpdatedBy = @user, UpdatedAt = SYSDATETIME()
         WHERE Id = @id`,
      );
  });
}

/** Persist a new checklist order (SortOrder = position in the array), as `reorderVehicles` does. */
export async function reorderRules(orderedIds: number[], userId: number): Promise<void> {
  if (orderedIds.length === 0) return;
  await writeBothPools(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .request()
        .input("id", sql.Int, orderedIds[i])
        .input("sort", sql.Int, i)
        .input("user", sql.Int, userId || null)
        .query(
          `UPDATE [dbo].[AccReimburseRule]
           SET SortOrder = @sort, UpdatedBy = @user, UpdatedAt = SYSDATETIME()
           WHERE Id = @id`,
        );
    }
  });
}

/*
 * `upsertReimburseApprover` and `setReimburseApproverActive` used to live here
 * — the pair the deleted `settings/approvers` route called to add/reactivate
 * and to turn an approver off or on. Removed 2026-09-10 along with that route:
 * `setReimburseApproverBrands` below writes `AccReimburseApproverBrand` and
 * can only ever move `AccReimburseApprover.IsActive` toward 0 (or leave it
 * where it was) — never toward 1 by itself. Turning it back on is
 * `setReimburseAccessAndApprovalActive`'s job (`./access-service.ts`), called
 * from the same route's PATCH; see that function's own docblock for the
 * `EXISTS` check that gates reactivation on a tick actually surviving, and
 * `setReimburseApproverBrands`' own docblock below for why the two writers
 * do not race even though both touch the same column.
 */

/* ─────────────────────── per-brand scope (AccReimburseApproverBrand) ─────────────────────── */

/**
 * Every approver's ticked interface-brand targets, keyed by
 * `AccReimburseApprover.Id` — the same key AP-1's
 * `loadInterfaceBrandsByApproverIds` uses for `AccApproverInterfaceBrand`, so
 * a settings grid can join this straight onto `listReimburseApprovers()`'s
 * `id` field.
 *
 * An approver with no `AccReimburseApproverBrand` rows is simply absent from
 * the map — the caller reads that with `?? []`. That is a different question
 * from `loadApproverScopeByStaffId`'s `null`-vs-`[]` distinction in
 * `brand-scope-load.ts`: this function lists *every* approver's brands for a
 * grid, not "does this one specific person have an active roster row at all".
 */
export async function listReimburseApproverBrands(): Promise<Map<number, string[]>> {
  const pool = await getAccPool();
  const r = await pool
    .request()
    .query(
      `SELECT ApproverId, InterfaceBrandCode
       FROM [dbo].[AccReimburseApproverBrand]
       ORDER BY ApproverId, InterfaceBrandCode`,
    );
  const map = new Map<number, string[]>();
  for (const row of r.recordset as { ApproverId: number; InterfaceBrandCode: string }[]) {
    const list = map.get(row.ApproverId) ?? [];
    list.push(String(row.InterfaceBrandCode ?? "").trim());
    map.set(row.ApproverId, list);
  }
  return map;
}

/**
 * The single writer for AP-4's per-brand approver scope — but, since the fix
 * below, ONE of two writers of `AccReimburseApprover.IsActive`, not the only
 * one. This is what `settings/access`'s POST calls, when an admin edits
 * somebody's ticked brands. The route's PATCH calls a different function,
 * `setReimburseAccessAndApprovalActive` (`./access-service.ts`), when an
 * admin flips the row's own off/on switch — that one is a real, separate
 * toggle, kept in step with the tick set by its own `EXISTS` check rather
 * than by there being only one place `IsActive` is written.
 *
 * **Ticks may only ever turn approval OFF; only the PATCH turns it back ON.**
 * The MERGE below writes
 * `IsActive = CASE WHEN @active = 0 THEN 0 ELSE t.IsActive END` — zero
 * recognised targets forces `IsActive` to 0 regardless of what it held, and a
 * non-empty target set leaves whatever `IsActive` already was untouched; it
 * never sets it to 1. **Before this fix the MERGE wrote `IsActive = @active`
 * unconditionally** (derived from the tick count alone, with no memory of the
 * row's own prior state), which reactivated a deactivated approver as a side
 * effect of an ordinary brand-tick edit: an admin deactivates X through the
 * PATCH (`AccReimburseAccess.IsActive = 0` AND, via that function's own
 * `EXISTS` check, `AccReimburseApprover.IsActive = 0` — brand rows left
 * intact by design, so an admin can see what a deactivated person still
 * holds and set it up before switching them back on); the admin later adjusts
 * one of X's brand ticks on that same row — the checkboxes render on every
 * row with no active-guard — and the old MERGE derived `active = true` from
 * the non-empty tick set and wrote it straight to `IsActive`, silently
 * restoring X's authority to approve real payments while the สถานะ badge kept
 * reading "ปิด". Found in the final whole-branch review, before it shipped.
 *
 * **The two writers do not race, because each owns a different direction of
 * the same column.** `setReimburseAccessAndApprovalActive`'s own docblock has
 * the mirror image of the rule above: its `@active = 0` branch always
 * succeeds, and its `@active = 1` branch (an admin switching a row back on)
 * sets `IsActive = 1` only when a brand tick still exists, checked live with
 * an `EXISTS` rather than trusted from any value read before that statement.
 * Between the two functions, `IsActive` can move 1 → 0 by either path, and
 * 0 → 1 only through the PATCH's own `EXISTS` check — ticking a brand alone
 * can never be what turns someone back into an active approver, which is
 * exactly the property the bug above violated.
 *
 * One `writeBothPools` transaction, in order: MERGE the `AccReimburseApprover`
 * row on `StaffId` (the same MERGE shape the deleted `upsertReimburseApprover`
 * used, plus the guarded `IsActive` above), delete every existing
 * `AccReimburseApproverBrand` row for that approver, then insert one row per
 * normalized target.
 *
 * **The child rows' `ApproverId` is re-selected inside this same transaction,
 * on this same pool — never carried over from the other database.**
 * `writeBothPools` runs this callback once against production and once
 * against UAT; each call MERGEs and re-reads `Id` against its own connection,
 * so the two form databases' independent identity counters — which are kept
 * in lockstep by every dual-write inserting through the same statements, not
 * by copying an id across — are what keeps the two `ApproverId` values equal.
 * Copying an id between the two pools is `upsertVehicle`'s one deliberate
 * exception (`dual-write.ts`), forced by a cross-table foreign key that has no
 * analogue here; reproducing it would be the wrong pattern for this table.
 *
 * `targets` is normalized (`normalizeScopeTargets`) before anything is
 * written, so a duplicate, blank or unrecognised entry in the posted body
 * never reaches the table — consistent with `AccReimburseApproverBrand`
 * having no CHECK constraint on `InterfaceBrandCode` to catch it for us.
 */
export async function setReimburseApproverBrands(
  staffId: number,
  targets: string[],
  userId: number,
  identity: { email: string; displayName: string },
): Promise<void> {
  const normalized = normalizeScopeTargets(targets);
  const active = isApproverScope(normalized);

  // A blank identity is refused rather than written. Both columns are NOT NULL
  // and NOT NULL accepts `''`, so a caller that defaults a missing field to the
  // empty string would blank the roster row on a tick change — and `Email` is
  // `findActiveApprover`'s ONLY fallback for an approver with no
  // `Rocks_Portal_HR.Employee` row, as well as the second arm of `/my-work`'s
  // AP-4 clause. The person would silently stop being findable on the path that
  // decides who may approve a payment, with nothing raised anywhere.
  const email = identity.email?.trim() ?? "";
  const displayName = identity.displayName?.trim() ?? "";
  if (!email) throw new Error("กรุณาระบุอีเมลของผู้อนุมัติ");
  if (!displayName) throw new Error("กรุณาระบุชื่อผู้อนุมัติ");

  await writeBothPools(async (tx) => {
    await tx
      .request()
      .input("staff", sql.Int, staffId)
      .input("email", sql.NVarChar(200), email)
      .input("name", sql.NVarChar(200), displayName)
      .input("active", sql.Bit, active ? 1 : 0)
      .input("user", sql.Int, userId || null)
      .query(
        `MERGE [dbo].[AccReimburseApprover] AS t
         USING (SELECT @staff AS StaffId) AS s ON t.StaffId = s.StaffId
         WHEN MATCHED THEN UPDATE SET
           Email = @email, DisplayName = @name,
           IsActive = CASE WHEN @active = 0 THEN 0 ELSE t.IsActive END,
           UpdatedBy = @user, UpdatedAt = SYSDATETIME()
         WHEN NOT MATCHED THEN
           INSERT (StaffId, Email, DisplayName, IsActive, CreatedBy)
           VALUES (@staff, @email, @name, @active, @user);`,
      );

    // Re-select within this same transaction/pool — see the docblock above.
    const idResult = await tx
      .request()
      .input("staff", sql.Int, staffId)
      .query(`SELECT Id FROM [dbo].[AccReimburseApprover] WHERE StaffId = @staff`);
    const approverId = idResult.recordset[0]?.Id as number | undefined;
    if (approverId == null) {
      throw new Error("ไม่พบแถวผู้อนุมัติหลังบันทึก — โปรดลองใหม่");
    }

    await tx
      .request()
      .input("approver", sql.Int, approverId)
      .query(`DELETE FROM [dbo].[AccReimburseApproverBrand] WHERE ApproverId = @approver`);

    for (const target of normalized) {
      await tx
        .request()
        .input("approver", sql.Int, approverId)
        .input("target", sql.NVarChar(20), target)
        .query(
          `INSERT INTO [dbo].[AccReimburseApproverBrand] (ApproverId, InterfaceBrandCode)
           VALUES (@approver, @target)`,
        );
    }
  });
}
