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
import { accumulateAccountQueueRows, countUnmappedBrandRows } from "./queue-policy";
import type { ReimburseQueueItem, ReimburseQueueRow } from "./queue-policy";
import { loadApproverScopeByStaffId, loadClaimBrandTargets } from "./brand-scope-load";

export type { ReimburseQueueItem, ReimburseQueueRow } from "./queue-policy";

/**
 * What `listReimburseAccountQueue` answers — `rows` alone used to be the
 * whole return value, and that was the gap review round 1 measured (I1): an
 * unmapped-brand claim (`ROCKS`, migration 092's seed) and an out-of-scope
 * claim both simply vanished from `rows` with nothing on screen able to tell
 * them apart from "nothing is pending at all". `scope` and
 * `unmappedBrandCount` are what let `ReimburseApprovalQueue.tsx` say which.
 */
export interface ReimburseAccountQueueResult {
  rows: ReimburseQueueRow[];
  /**
   * This caller's own ticked Interface targets, or `null` when they hold no
   * active `AccReimburseApprover` row at all — the exact three-valued
   * distinction `requireApproverScopeFor` (`approval-service.ts`) makes, so
   * the screen and the action can never disagree about which one this is.
   */
  scope: string[] | null;
  /** See `countUnmappedBrandRows` (`./queue-policy.ts`) — independent of `scope`. */
  unmappedBrandCount: number;
}

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
): Promise<ReimburseAccountQueueResult> {
  const pool = await getAccPool();
  // Both reads run BEFORE the query below, and neither is interposed between
  // the query's own closing `);` and the `const recordset = …` that follows
  // it — see queue-service-guard.test.ts's own adjacency pin for why nothing
  // may sit in that particular gap.
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
             r.RequesterDepartmentName, r.RequesterDepartmentCode,
             (SELECT COUNT(*) FROM [dbo].[AccReimburseItem] i WHERE i.RequestId = r.Id) AS ItemCount,
             -- The manager's sign-off time. MAX, not TOP 1: a claim returned and
             -- resubmitted has more than one MANAGER row, and the queue is about
             -- the approval that put it here — the latest one.
             (SELECT MAX(a.ActionedAt) FROM [dbo].[AccApproval] a
               WHERE a.RequestId = r.Id AND a.StepCode = 'MANAGER' AND a.Status = 'Approved'
             ) AS ManagerApprovedAt
      FROM [dbo].[AccRequest] r
      WHERE r.FormCode = @form AND r.Status = @status AND r.CurrentStepCode = @step
      ORDER BY r.SubmittedAt ASC
    `);

  const recordset = res.recordset as Record<string, unknown>[];
  const rows = accumulateAccountQueueRows(recordset, scope, claimTargets);
  const unmappedBrandCount = countUnmappedBrandRows(recordset, claimTargets);
  // AFTER the accumulator, deliberately, and never between the query above and
  // the `const recordset` that reads it — that gap is pinned by
  // queue-service-guard.test.ts. Only the claims this viewer may actually act
  // on are queried for lines, so a scoped approver never causes a read of
  // another group's expense detail.
  await attachQueueItems(pool, rows);
  return { rows, scope, unmappedBrandCount };
}

/**
 * Load every expense line of `rows` in one query and hang them off their claim.
 *
 * One query for all of them rather than one per claim: the queue is a handful
 * of claims today and a query per row is the shape that stops being a handful
 * quietly. Mutates in place because the rows are this function's caller's and
 * nothing else has seen them yet.
 *
 * An empty `rows` short-circuits: an `IN ()` list is a syntax error, and
 * building one from a scoped approver's empty queue is exactly when it happens.
 */
async function attachQueueItems(
  pool: Awaited<ReturnType<typeof getAccPool>>,
  rows: ReimburseQueueRow[],
): Promise<void> {
  if (rows.length === 0) return;

  const req = pool.request();
  // Parameterised one id at a time — `rows` ids come from the database above,
  // but building SQL by interpolating them anyway is the habit that eventually
  // interpolates something that did not.
  const names = rows.map((r, i) => {
    req.input(`id${i}`, sql.Int, r.id);
    return `@id${i}`;
  });

  const res = await req.query(`
    SELECT Id, RequestId, SortOrder, ExpenseDate, DocumentNo, Description,
           BranchName, VendorTaxId, VendorName, Amount, VatAmount, WhtAmount,
           Category, VendorNo
    FROM [dbo].[AccReimburseItem]
    WHERE RequestId IN (${names.join(", ")})
    ORDER BY RequestId, SortOrder, Id
  `);

  const byRequest = new Map<number, ReimburseQueueItem[]>();
  for (const x of res.recordset as Record<string, unknown>[]) {
    const rid = x.RequestId as number;
    const list = byRequest.get(rid) ?? [];
    list.push({
      id: x.Id as number,
      sortOrder: (x.SortOrder as number) ?? list.length,
      expenseDate: x.ExpenseDate ? toYmdLocal(x.ExpenseDate as Date) : null,
      documentNo: (x.DocumentNo as string | null) ?? null,
      description: (x.Description as string | null) ?? "",
      branchName: (x.BranchName as string | null) ?? null,
      vendorTaxId: (x.VendorTaxId as string | null) ?? null,
      vendorName: (x.VendorName as string | null) ?? null,
      amount: Number(x.Amount) || 0,
      vatAmount: x.VatAmount === null || x.VatAmount === undefined ? null : Number(x.VatAmount),
      whtAmount: x.WhtAmount === null || x.WhtAmount === undefined ? null : Number(x.WhtAmount),
      category: (x.Category as string | null) ?? null,
      vendorNo: (x.VendorNo as string | null) ?? null,
    });
    byRequest.set(rid, list);
  }

  for (const row of rows) row.items = byRequest.get(row.id) ?? [];
}

/** Local getters — the server runs Thai wall time, `toISOString` would shift the day. */
function toYmdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
