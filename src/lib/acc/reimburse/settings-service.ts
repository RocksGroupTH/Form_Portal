/**
 * AP-4 settings reads: the acknowledgement checklist and the accounting
 * approver pool. Both on `getAccPool()`, so they follow the form's resolved
 * Production/UAT environment (Settings → Form Environment) like every other
 * Acc* read.
 */
import { getAccPool, sql } from "@/lib/acc/pool";
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
