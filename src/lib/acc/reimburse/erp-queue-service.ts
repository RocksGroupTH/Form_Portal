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
 * ## Two layers, for the reason `queue-service.ts`'s own docblock records
 *
 * `AccRequest` is shared, and AP-1 and AP-3 both park their own approved
 * claims at the identical `Status = 'Approved'` — AP-3's
 * `clear-advance-erp-queue-service.ts` uses that exact predicate for its own
 * form. `queue-service.ts` records three separate SQL rearrangements that each
 * kept a text-guard's pinned substrings while quietly widening what the WHERE
 * clause actually selected (an AND loosened to an OR, a re-parenthesisation, a
 * policy call stripped of its guarding `if`) — a lesson this file inherits
 * rather than re-derives. So the WHERE clause below is the first, cheaper
 * layer: correct on its own, but not trusted alone. `req.FormCode` and
 * `req.Status` are read back off the result set and handed to
 * `belongsInErpQueue` (`./erp-queue-policy.ts`), which re-derives the whole
 * predicate from what the database actually returned rather than from what the
 * WHERE clause merely appears to say. A row it refuses is dropped before it
 * reaches the client, regardless of how the SQL above is later reshaped.
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
import { belongsInErpQueue, erpReadiness } from "./erp-queue-policy";
import type { ReimburseErpQueueRow } from "./erp-queue-policy";

export type { ReimburseErpQueueRow } from "./erp-queue-policy";

/** `TotalAmount` etc. arrive from `mssql` typed loosely; coerce rather than trust. */
function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoOrNull(v: unknown): string | null {
  return v instanceof Date ? v.toISOString() : null;
}

/** Date column -> YYYY-MM-DD using local getters — the server runs Thai wall time. */
function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** One claim, accumulated across its joined item rows before `erpReadiness` runs over `items`. */
interface AccumulatedRow {
  id: number;
  requestNo: string;
  brandCode: string;
  requesterName: string;
  formCode: string;
  status: string;
  submittedAt: string | null;
  paymentDate: string | null;
  totalAmount: number;
  erpStatus: string | null;
  erpDocumentNo: string | null;
  erpEnvironment: string | null;
  erpSentAt: string | null;
  erpError: string | null;
  items: { category: string | null; amount: number | null }[];
}

/**
 * Every APPROVED AP-4 claim, joined to its lines, in the shape the Interface
 * ERP tab renders.
 *
 * `FormCode` and `Status` are read back off every joined row rather than
 * assumed from the WHERE clause, so `belongsInErpQueue` has real values to
 * re-derive the predicate from — see the file header for why that is the
 * layer with teeth. A row it disagrees with is dropped from the accumulator
 * before any of its item rows are collected, so a leaked AP-1/AP-3 row cannot
 * contribute a phantom entry to this queue's item counts either.
 *
 * The join fans one claim out to one row per item (or one row with every item
 * column NULL, for a claim with none), so results are accumulated into a Map
 * keyed on `req.Id` and only flattened back to `ReimburseErpQueueRow[]` at the
 * end — `order` preserves the SQL's own `req.Id DESC` ordering, which the Map
 * alone would not.
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

  const byId = new Map<number, AccumulatedRow>();
  const order: number[] = [];

  for (const x of res.recordset as Record<string, unknown>[]) {
    const id = x.Id as number;
    const formCode = (x.FormCode as string | null) ?? "";
    const status = (x.Status as string | null) ?? "";
    if (!belongsInErpQueue(formCode, status)) continue;

    let acc = byId.get(id);
    if (!acc) {
      acc = {
        id,
        requestNo: (x.RequestNo as string | null) ?? "",
        brandCode: (x.BrandCode as string | null) ?? "",
        requesterName: (x.RequesterFullName as string | null) ?? "",
        formCode,
        status,
        submittedAt: isoOrNull(x.SubmittedAt),
        paymentDate: x.PaymentDate ? toYmd(x.PaymentDate as Date) : null,
        totalAmount: num(x.TotalAmount),
        erpStatus: (x.ErpInterfaceStatus as string | null) ?? null,
        erpDocumentNo: (x.ErpDocumentNo as string | null) ?? null,
        erpEnvironment: (x.ErpInterfaceEnvironment as string | null) ?? null,
        erpSentAt: isoOrNull(x.ErpInterfaceSentAt),
        erpError: (x.ErpInterfaceError as string | null) ?? null,
        items: [],
      };
      byId.set(id, acc);
      order.push(id);
    }

    // A claim with no items at all joins to one row with ItemId NULL — do not
    // count that as a line with a missing category (see the file header).
    if (x.ItemId != null) {
      acc.items.push({
        category: (x.ItemCategory as string | null) ?? null,
        amount: numOrNull(x.ItemAmount),
      });
    }
  }

  return order.map((id) => {
    const acc = byId.get(id)!;
    return {
      id: acc.id,
      requestNo: acc.requestNo,
      brandCode: acc.brandCode,
      requesterName: acc.requesterName,
      formCode: acc.formCode,
      status: acc.status,
      submittedAt: acc.submittedAt,
      paymentDate: acc.paymentDate,
      totalAmount: acc.totalAmount,
      itemCount: acc.items.length,
      erpStatus: acc.erpStatus,
      erpDocumentNo: acc.erpDocumentNo,
      erpEnvironment: acc.erpEnvironment,
      erpSentAt: acc.erpSentAt,
      erpError: acc.erpError,
      readiness: erpReadiness(acc.items),
    };
  });
}
