/**
 * AP-4's accounting queue — every claim parked at the ACCOUNT step, waiting for
 * the accounting check that fixes the payment date (`approveReimburseAccountCheck`,
 * `./approval-service.ts`).
 *
 * `getAccPool()` is correct here, not `getProductionFormPool()`: this is
 * transactional data, and AP-4 resolves the UAT database for a tester exactly
 * as every other AP-4 read does. A tester's claim belongs on a tester's queue.
 *
 * ## Two layers, and what each one can and cannot catch
 *
 * **`FormCode = 'AP-4'` in the WHERE clause is not optional, but it is no
 * longer the ONLY thing standing between this queue and AP-1's claims.** AP-1
 * parks its own claims at the identical `(ManagerApproved, ACCOUNT)` tuple
 * (`STATUS_AT_STEP`, `approval-engine.ts`) — every claim in that engine is
 * pinned to `FormCode='AP-1'` for the same reason, restated in `AccRequest.*`'s
 * own docblock in CLAUDE.md. The WHERE clause is still the first, cheaper
 * layer: it is correct, and a correct predicate here means fewer rows cross
 * the network before the second layer even runs.
 *
 * **The SQL text pin (`queue-service-guard.test.ts`) catches an edited WHERE
 * clause.** It is a regex over this file's own source, and three review
 * rounds proved — each time by producing a working mutation, not by argument —
 * that a regex over SQL TEXT cannot verify SQL SEMANTICS: an AND loosened to
 * an OR, a `belongsInAccountQueue(...)` call stripped of its guarding `if`,
 * and a re-parenthesisation —
 * `WHERE (r.FormCode = @form AND r.Status = @status) OR r.CurrentStepCode = @step`
 * — that leaves `FormCode = @form AND` sitting there as a contiguous,
 * regex-satisfying substring while the query now means "AP-4 at the right
 * status, OR *anything* at `CurrentStepCode = 'ACCOUNT'`".
 *
 * **`accumulateAccountQueueRows` (`./queue-policy.ts`) is the second, real
 * layer, and it lives there — not inline in this function — for the same
 * reason `accumulateErpQueueRows` lives in `erp-queue-policy.ts`: this file
 * imports `getAccPool`, which reaches `@/env` and throws at import outside a
 * configured machine, so nothing that imports THIS file can be exercised with
 * a plain array. It takes `FormCode`, `Status` AND `CurrentStepCode` back out
 * of the result set and re-derives the WHOLE predicate from data the database
 * actually returned, so no SQL rearrangement can satisfy the WHERE-clause pin
 * without also being correct — the check no longer trusts that the WHERE
 * clause meant what it appears to say. A later review round found the row
 * loop's own blind spot once it still lived inline here: a caller can select
 * the right columns and gate on `belongsInAccountQueue` correctly-shaped and
 * still lie by rebinding `status`/`stepCode` to literals instead of reading
 * them off the row — every source-shape regex in `queue-service-guard.test.ts`
 * passed while the check became tautological. Only a behavioural test that
 * hands the function an actual row and checks what comes back closes that —
 * `queue-service.test.ts`, mirroring `erp-queue-service.test.ts`.
 *
 * **The WHERE clause is not widened for brand scope, and never should be.**
 * `staffId`/`email` load the caller's scope (`loadApproverScopeByStaffId`) and
 * the claim-brand→target map (`loadClaimBrandTargets`, loaded ONCE — never
 * `resolveClaimTarget` per row, which would be a query per row on an
 * authorization path) BEFORE the query runs, and both are handed to
 * `accumulateAccountQueueRows` to filter the same way it already filters
 * `(FormCode, Status, CurrentStepCode)` — from the row's own `BrandCode`, not
 * from a second WHERE-clause predicate this file's own history says cannot be
 * trusted at face value.
 */
import { getAccPool, sql } from "@/lib/acc/pool";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";
import { accumulateAccountQueueRows } from "./queue-policy";
import type { ReimburseQueueRow } from "./queue-policy";
import { loadApproverScopeByStaffId, loadClaimBrandTargets } from "./brand-scope-load";

export type { ReimburseQueueRow } from "./queue-policy";

/**
 * Every AP-4 claim currently awaiting the accounting check, that `staffId`/
 * `email` may act on.
 *
 * The WHERE clause is the first, cheap layer (see the file header);
 * `accumulateAccountQueueRows` is the second, real one — see that function's
 * own docblock (`./queue-policy.ts`) for why the row-mapping loop lives there
 * rather than here.
 *
 * `AccReimburseItem` is joined by count only, keyed on `RequestId`
 * (`AccRequest.Id`, not `AccReimburse.RequestId` — both are the same column
 * name but the item table's FK is straight to the request, exactly as
 * `request-service.ts`'s own item read uses it).
 */
export async function listReimburseAccountQueue(
  staffId: number | null,
  email: string | null,
): Promise<ReimburseQueueRow[]> {
  const pool = await getAccPool();
  // Both reads run BEFORE the query below, and neither is interposed between
  // the query's own closing `);` and the `return` — see
  // queue-service-guard.test.ts's own adjacency pin for why nothing may sit
  // in that particular gap.
  const scope = await loadApproverScopeByStaffId(staffId, email);
  const claimTargets = await loadClaimBrandTargets();
  const res = await pool
    .request()
    .input("form", sql.NVarChar, AP4_FORM_CODE)
    .input("status", sql.NVarChar, "ManagerApproved")
    .input("step", sql.NVarChar, "ACCOUNT")
    .query(`
      SELECT r.Id, r.RequestNo, r.BrandCode, r.RequesterFullName, r.SubmittedAt,
             r.TotalAmount, r.PaymentDate, r.FormCode, r.Status, r.CurrentStepCode,
             (SELECT COUNT(*) FROM [dbo].[AccReimburseItem] i WHERE i.RequestId = r.Id) AS ItemCount
      FROM [dbo].[AccRequest] r
      WHERE r.FormCode = @form AND r.Status = @status AND r.CurrentStepCode = @step
      ORDER BY r.SubmittedAt ASC
    `);

  return accumulateAccountQueueRows(res.recordset as Record<string, unknown>[], scope, claimTargets);
}
