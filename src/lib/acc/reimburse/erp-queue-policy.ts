/**
 * AP-4 — which approved claims belong in the ERP queue, and whether they are
 * ready to post.
 *
 * Deliberately free of any import that reaches a pool: this module imports
 * nothing, so it is testable without a database. Every function is total over
 * plain values.
 *
 * ## Why FormCode matters
 *
 * `AccRequest` is shared by every Acc* form, and AP-1 and AP-3 park their
 * approved claims at exactly the same status as AP-4 — `Status='Approved'`.
 * Without a FormCode filter, a claim from AP-1 or AP-3 would leak into AP-4's
 * ERP queue. AP-1's own `erp-prep-service.ts` comment spells out what happens:
 * a journal is built from nothing — zero line items — and posted to Business
 * Central. FormCode is the only discriminator that stops that.
 *
 * ## Why readiness reads lines
 *
 * `AccReimburseItem.Category` holds the G/L account. It is written by an AI
 * document read, correctable by an accountant, and validated only for length —
 * it may be null or blank. So "ready to post" is a property of the lines, not
 * of the claim's status.
 */

export type ErpReadiness = { ready: boolean; issues: string[] };

/**
 * One row of AP-4's Interface ERP queue.
 *
 * It lives here rather than beside the query for the reason `ReimburseQueueRow`
 * lives in `queue-policy.ts`: the shape is what the predicate and the readiness
 * rule are about, and a screen that renders it must be typeable without
 * dragging a pool import into the browser bundle.
 *
 * `formCode` and `status` are carried deliberately, not for display. They are
 * what the query re-derives `belongsInErpQueue` from — the row check that has
 * teeth, as opposed to the WHERE clause a later edit can rearrange while
 * leaving its pinned text intact. Dropping them from this type is how that
 * defence gets removed by accident.
 *
 * The ERP columns come straight off `AccRequest` and every one of them is
 * nullable: nothing has been sent, so `erpStatus` is null on every row this
 * queue currently shows. `readiness` is not a column — it is `erpReadiness`
 * over the claim's lines, so the screen can say *why* a claim is not ready
 * rather than only that it is not.
 */
export interface ReimburseErpQueueRow {
  id: number;
  requestNo: string;
  brandCode: string;
  requesterName: string;
  formCode: string;
  status: string;
  submittedAt: string | null;
  paymentDate: string | null;
  totalAmount: number;
  itemCount: number;
  erpStatus: string | null;
  erpDocumentNo: string | null;
  erpEnvironment: string | null;
  erpSentAt: string | null;
  erpError: string | null;
  readiness: ErpReadiness;
}

/**
 * Only an APPROVED AP-4 claim is in the ERP queue.
 *
 * An allow-list, not a catch-all: unknown statuses are OUT. The only status
 * that returns true is "Approved", and only for FormCode "AP-4".
 */
export function belongsInErpQueue(formCode: string, status: string): boolean {
  return formCode === "AP-4" && status === "Approved";
}

/**
 * Whether a claim is ready to post, and if not, which lines are missing their
 * G/L account.
 *
 * A claim is ready only when EVERY line has a non-null, non-blank category.
 * An empty array — a claim with no lines at all — is not ready, because a
 * journal built from nothing and posted to Business Central is the AP-1
 * failure this module exists to prevent.
 *
 * Both bad lines are named, not just the first: the accountant fixes them and
 * comes back, and discovering a second problem is a waste of a round trip.
 * Lines are numbered as a human counts them (1, 2, 3...), not as a programmer
 * counts arrays.
 */
export function erpReadiness(
  items: readonly { category: string | null; amount: number | null }[],
): ErpReadiness {
  // Empty array is not ready
  if (items.length === 0) {
    return {
      ready: false,
      issues: ["ไม่มีรายการที่จะบันทึก"],
    };
  }

  const issues: string[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const category = item.category;

    // Check if category is null or blank (only whitespace)
    if (category == null || (typeof category === "string" && category.trim() === "")) {
      // Line number is 1-indexed (human counting)
      issues.push(`บรรทัดที่ ${i + 1} ยังไม่ได้เลือกผังบัญชี`);
    }
  }

  return {
    ready: issues.length === 0,
    issues,
  };
}
