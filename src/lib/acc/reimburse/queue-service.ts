/**
 * AP-4's accounting queue — every claim parked at the ACCOUNT step, waiting for
 * the accounting check that fixes the payment date (`approveReimburseAccountCheck`,
 * `./approval-service.ts`).
 *
 * `getAccPool()` is correct here, not `getProductionFormPool()`: this is
 * transactional data, and AP-4 resolves the UAT database for a tester exactly
 * as every other AP-4 read does. A tester's claim belongs on a tester's queue.
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
 * **The second layer is `belongsInAccountQueue` (`./queue-policy.ts`), and
 * since round 3 of this file's own review it is form-aware — it takes
 * `r.FormCode` back out of the result set, not just `r.Status` and
 * `r.CurrentStepCode`.** Earlier rounds tried to keep the WHERE clause honest
 * with a regex over its TEXT (`queue-service-guard.test.ts`) while the row
 * check stayed blind to which form a row belonged to; every round found a SQL
 * rearrangement that kept the regex's pinned substrings and changed what the
 * query actually selected — an OR in place of an AND, a
 * `belongsInAccountQueue(...)` call stripped of its guarding `if`, and a
 * re-parenthesisation that left `FormCode = @form AND` sitting there as
 * text while the query meant "AP-4 at the right status, OR *anything* at
 * `CurrentStepCode = 'ACCOUNT'`". A status-and-step-only row check could not
 * catch any of those, because an AP-1 row genuinely IS
 * `(ManagerApproved, ACCOUNT)` — it is simply the wrong form's row. Passing
 * `r.FormCode` into `belongsInAccountQueue` means the row check now
 * RE-DERIVES the whole predicate from data the database actually returned,
 * so no SQL rearrangement can satisfy it without also being correct — the
 * check no longer trusts that the WHERE clause meant what it appears to say.
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
 * `FormCode`, `Status` and `CurrentStepCode` are all read back out of the
 * result set rather than assumed from the WHERE clause, so
 * `belongsInAccountQueue` has real values to re-derive the predicate from —
 * not a re-statement of what the query already guaranteed, but an
 * independent check against whatever the WHERE clause actually selected. A
 * row `belongsInAccountQueue` disagrees with is dropped rather than shown;
 * see that function's own docblock for why `FormCode` specifically has to be
 * part of what it re-checks, and `queue-service-guard.test.ts`'s docblock for
 * how the SQL-text guard and this row check now divide the work between them.
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
             r.TotalAmount, r.PaymentDate, r.FormCode, r.Status, r.CurrentStepCode,
             (SELECT COUNT(*) FROM [dbo].[AccReimburseItem] i WHERE i.RequestId = r.Id) AS ItemCount
      FROM [dbo].[AccRequest] r
      WHERE r.FormCode = @form AND r.Status = @status AND r.CurrentStepCode = @step
      ORDER BY r.SubmittedAt ASC
    `);

  const rows: ReimburseQueueRow[] = [];
  for (const x of res.recordset as Record<string, unknown>[]) {
    const formCode = (x.FormCode as string | null) ?? "";
    const status = (x.Status as string | null) ?? "";
    const stepCode = (x.CurrentStepCode as string | null) ?? null;
    if (!belongsInAccountQueue(formCode, status, stepCode)) continue;
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
