/**
 * AP-4's accounting queue — every claim parked at the ACCOUNT step, waiting for
 * the accounting check that fixes the payment date (`approveReimburseAccountCheck`,
 * `./approval-service.ts`).
 *
 * `getAccPool()` is correct here, not `getProductionFormPool()`: this is
 * transactional data, and AP-4 resolves the UAT database for a tester exactly
 * as every other AP-4 read does. A tester's claim belongs on a tester's queue.
 *
 * **`FormCode = 'AP-4'` in the WHERE clause is not optional.** AP-1 parks its
 * own claims at the identical `(ManagerApproved, ACCOUNT)` tuple
 * (`STATUS_AT_STEP`, `approval-engine.ts`) — every claim in that engine is
 * pinned to `FormCode='AP-1'` for the same reason, restated in `AccRequest.*`'s
 * own docblock in CLAUDE.md. Omit the predicate here and this queue shows AP-1's
 * travel claims and offers to approve them through AP-4's `approveReimburse*`
 * functions, which write columns AP-1's rows do not expect.
 *
 * The SQL predicate and `belongsInAccountQueue` (`./queue-policy.ts`) say the
 * same thing twice on purpose — SQL cannot call a TypeScript function, so the
 * rule has one home in prose (`queue-policy.ts`'s own docblock) and two
 * enforcements: the `WHERE` clause, and this file's own re-assertion per row.
 * A future edit that loosens one and not the other is caught here rather than
 * silently widening the queue.
 */
import { getAccPool, sql } from "@/lib/acc/pool";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";
import { belongsInAccountQueue } from "./queue-policy";
import type { ReimburseQueueRow } from "./queue-policy";

export type { ReimburseQueueRow } from "./queue-policy";

/** `TotalAmount` etc. arrive from `mssql` typed loosely; coerce rather than trust. */
function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Date column → YYYY-MM-DD using local getters — the server runs Thai wall time. */
function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Every AP-4 claim currently awaiting the accounting check.
 *
 * `Status` and `CurrentStepCode` are read back out of the result set rather
 * than assumed from the WHERE clause, so `belongsInAccountQueue` has real
 * values to re-check against — not a re-statement of what the query already
 * guaranteed, but a guard against the WHERE clause and the predicate having
 * drifted apart. A row `belongsInAccountQueue` disagrees with is dropped
 * rather than shown; two disagreeing single-source-of-truths would otherwise
 * fail silently in whichever direction nobody happened to test.
 *
 * `AccReimburseItem` is joined by count only, keyed on `RequestId`
 * (`AccRequest.Id`, not `AccReimburse.RequestId` — both are the same column
 * name but the item table's FK is straight to the request, exactly as
 * `request-service.ts`'s own item read uses it).
 */
export async function listReimburseAccountQueue(): Promise<ReimburseQueueRow[]> {
  const pool = await getAccPool();
  const res = await pool
    .request()
    .input("form", sql.NVarChar, AP4_FORM_CODE)
    .input("status", sql.NVarChar, "ManagerApproved")
    .input("step", sql.NVarChar, "ACCOUNT")
    .query(`
      SELECT r.Id, r.RequestNo, r.BrandCode, r.RequesterFullName, r.SubmittedAt,
             r.TotalAmount, r.PaymentDate, r.Status, r.CurrentStepCode,
             (SELECT COUNT(*) FROM [dbo].[AccReimburseItem] i WHERE i.RequestId = r.Id) AS ItemCount
      FROM [dbo].[AccRequest] r
      WHERE r.FormCode = @form AND r.Status = @status AND r.CurrentStepCode = @step
      ORDER BY r.SubmittedAt ASC
    `);

  const rows: ReimburseQueueRow[] = [];
  for (const x of res.recordset as Record<string, unknown>[]) {
    const status = (x.Status as string | null) ?? "";
    const stepCode = (x.CurrentStepCode as string | null) ?? null;
    if (!belongsInAccountQueue(status, stepCode)) continue;
    rows.push({
      id: x.Id as number,
      requestNo: (x.RequestNo as string | null) ?? "",
      brandCode: (x.BrandCode as string | null) ?? "",
      requesterName: (x.RequesterFullName as string | null) ?? "",
      submittedAt: x.SubmittedAt ? (x.SubmittedAt as Date).toISOString() : null,
      totalAmount: num(x.TotalAmount),
      paymentDate: x.PaymentDate ? toYmd(x.PaymentDate as Date) : null,
      itemCount: num(x.ItemCount),
    });
  }
  return rows;
}
