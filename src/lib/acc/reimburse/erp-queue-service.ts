/**
 * AP-4's Interface ERP queue — every APPROVED claim, together with whatever
 * Business Central posting status `AccRequest.ErpInterface*` already carries
 * and whether the claim's own lines are ready to post.
 *
 * `getAccPool()` is correct here, not `getProductionFormPool()`: this is
 * transactional data, and AP-4 resolves the UAT database for a tester exactly
 * as `queue-service.ts` does for the accounting-approval queue. A tester's
 * claim belongs on a tester's queue.
 *
 * ## Two layers, and what each one can and cannot catch
 *
 * `AccRequest` is shared, and AP-1 and AP-3 both park their own approved
 * claims at the identical `Status = 'Approved'` — AP-3's
 * `clear-advance-erp-queue-service.ts` uses that exact predicate for its own
 * form. `queue-service.ts` records three separate SQL rearrangements that each
 * kept a text-guard's pinned substrings while quietly widening what the WHERE
 * clause actually selected (an AND loosened to an OR, a re-parenthesisation, a
 * policy call stripped of its guarding `if`) — a lesson this file inherits.
 *
 * **The SQL text pin (`erp-queue-service-guard.test.ts`) catches an edited
 * WHERE clause.** It is a regex over this file's own source, and it can only
 * ever prove that `FormCode = @form` still appears somewhere and that `@form`
 * is still bound to `AP4_FORM_CODE` — it says nothing about what the query
 * actually returns, and nothing about what the row loop does with what comes
 * back.
 *
 * **The behavioural test (`erp-queue-service.test.ts`) catches a rebinding
 * inside the row loop, which a WHERE-clause pin cannot see at all.** A review
 * round found exactly this: the WHERE clause left untouched, `req.FormCode` and
 * `req.Status` still selected, `belongsInErpQueue` still called and gated with
 * `if (!… ) continue;` — every SQL-text assertion this file could pass — while
 * the row-loop code that used to read `const status = (x.Status as string |
 * null) ?? "";` had become `const status = "Approved";`. That single line makes
 * `belongsInErpQueue(formCode, status)` tautological for every row the widened
 * WHERE clause (`... OR req.CurrentStepCode = 'ACCOUNT'`) now returns, and the
 * queue lists claims still parked at `(ManagerApproved, ACCOUNT)` under a
 * header saying they are approved and waiting to post. No SQL-text regex
 * catches that, because nothing about the SQL text changed to hide the row
 * check — the row check itself was fed a lie. **Neither layer is sufficient
 * alone**; the behavioural test is what closes the gap, because it hands
 * `accumulateErpQueueRows` a row shaped exactly like the exploit
 * (`{FormCode:"AP-4", Status:"ManagerApproved"}`) and asserts it is dropped —
 * no regex needs to be written correctly for that to work.
 *
 * The row loop itself now lives in `accumulateErpQueueRows`
 * (`./erp-queue-policy.ts`), not here — see that function's own docblock for
 * why it has to live in an import-free module rather than in this one.
 * `listReimburseErpQueue` below is the pool call and one call into it.
 *
 * ## Readiness is a property of the lines, not the header
 *
 * `AccReimburseItem` is LEFT JOINed rather than counted, so every line's
 * `Category` and `Amount` travels alongside its request and `erpReadiness`
 * (`./erp-queue-policy.ts`) can say *which* line is missing its G/L account —
 * not just that one is. A claim with no items at all joins to a single row
 * with every item column NULL, which is why `i.Id` is selected too: without
 * it there is no way to tell "this claim has no items" apart from "this claim
 * has one item with a NULL category", and the two must not collapse into the
 * same readiness answer for the wrong reason — `erpReadiness([])` and
 * `erpReadiness([{ category: null, amount: ... }])` both report "not ready"
 * but for different reasons, and only one of them is true here.
 */
import { getAccPool, sql } from "@/lib/acc/pool";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";
import { accumulateErpQueueRows } from "./erp-queue-policy";
import type { ReimburseErpQueueRow } from "./erp-queue-policy";

export type { ReimburseErpQueueRow } from "./erp-queue-policy";

/**
 * Every APPROVED AP-4 claim, joined to its lines, in the shape the Interface
 * ERP tab renders. The WHERE clause is the first, cheap layer (see the file
 * header); `accumulateErpQueueRows` is the second, real one.
 */
export async function listReimburseErpQueue(): Promise<ReimburseErpQueueRow[]> {
  const pool = await getAccPool();
  const res = await pool
    .request()
    .input("form", sql.NVarChar, AP4_FORM_CODE)
    .query(`
      SELECT req.Id, req.RequestNo, req.BrandCode, req.RequesterFullName, req.FormCode, req.Status,
             req.SubmittedAt, req.PaymentDate, req.TotalAmount,
             req.ErpInterfaceStatus, req.ErpDocumentNo, req.ErpInterfaceEnvironment,
             req.ErpInterfaceSentAt, req.ErpInterfaceError,
             i.Id AS ItemId, i.Category AS ItemCategory, i.Amount AS ItemAmount
      FROM [dbo].[AccRequest] req
      LEFT JOIN [dbo].[AccReimburseItem] i ON i.RequestId = req.Id
      WHERE req.FormCode = @form AND req.Status = 'Approved'
      ORDER BY req.Id DESC, i.SortOrder ASC, i.Id ASC
    `);

  return accumulateErpQueueRows(res.recordset as Record<string, unknown>[]);
}
