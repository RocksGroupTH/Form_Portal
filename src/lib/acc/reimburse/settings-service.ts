/**
 * AP-4 settings reads: the acknowledgement checklist and the accounting
 * approver pool. Both on `getAccPool()`, so they follow the form's resolved
 * Production/UAT environment (Settings → Form Environment) like every other
 * Acc* read.
 */
import { getAccPool, sql } from "@/lib/acc/pool";
import { writeBothPools } from "@/lib/acc/dual-write";
import type { ReimburseApprover, ReimburseRule } from "@/features/reimburse/types";

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
       ORDER BY DisplayName`,
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

/** Longest `AccReimburseRule.RuleText` the column will take (migration 089). */
export const RULE_TEXT_MAX = 1000;

export const RULE_TEXT_REQUIRED = "กรุณากรอกข้อความระเบียบ";
export const RULE_TEXT_TOO_LONG = `ข้อความระเบียบยาวเกิน ${RULE_TEXT_MAX} ตัวอักษร`;

/**
 * The rule text as it will be stored, or the message refusing it.
 *
 * Pure and exported so the boundary and the tests can share one answer — the
 * column is `NVARCHAR(1000)` and SQL Server truncates silently on some paths,
 * which would publish a compliance line missing its last clause.
 */
export function validateRuleText(raw: unknown): { text: string; error: null } | { text: null; error: string } {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { text: null, error: RULE_TEXT_REQUIRED };
  if (text.length > RULE_TEXT_MAX) return { text: null, error: RULE_TEXT_TOO_LONG };
  return { text, error: null };
}

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

/**
 * Add someone to AP-4's accounting pool, or reactivate them.
 *
 * Keyed on `StaffId`, which is the column's `UNIQUE` constraint and the identity
 * the two-person rule compares — so re-adding a retired approver restores the
 * row rather than colliding with it, and the id stays the one both databases
 * already agree on.
 */
export async function upsertReimburseApprover(
  a: { staffId: number; email: string; displayName: string },
  userId: number,
): Promise<void> {
  await writeBothPools(async (tx) => {
    await tx
      .request()
      .input("staff", sql.Int, a.staffId)
      .input("email", sql.NVarChar(200), a.email)
      .input("name", sql.NVarChar(200), a.displayName)
      .input("user", sql.Int, userId || null)
      .query(
        `MERGE [dbo].[AccReimburseApprover] AS t
         USING (SELECT @staff AS StaffId) AS s ON t.StaffId = s.StaffId
         WHEN MATCHED THEN UPDATE SET
           Email = @email, DisplayName = @name, IsActive = 1,
           UpdatedBy = @user, UpdatedAt = SYSDATETIME()
         WHEN NOT MATCHED THEN
           INSERT (StaffId, Email, DisplayName, IsActive, CreatedBy)
           VALUES (@staff, @email, @name, 1, @user);`,
      );
  });
}

/**
 * Turn an approver off or on. Soft, like every other roster in this app: the
 * `AccApproval` rows they actioned name them by StaffId, and the two-person rule
 * reads that history.
 *
 * Keyed on StaffId rather than the surrogate id — dual-write prefers a natural
 * key, because it is the one value that cannot drift between the two databases.
 */
export async function setReimburseApproverActive(
  staffId: number,
  isActive: boolean,
  userId: number,
): Promise<void> {
  await writeBothPools(async (tx) => {
    await tx
      .request()
      .input("staff", sql.Int, staffId)
      .input("active", sql.Bit, isActive ? 1 : 0)
      .input("user", sql.Int, userId || null)
      .query(
        `UPDATE [dbo].[AccReimburseApprover]
         SET IsActive = @active, UpdatedBy = @user, UpdatedAt = SYSDATETIME()
         WHERE StaffId = @staff`,
      );
  });
}
