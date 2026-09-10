/**
 * Is this claim complete enough to be approved from the accounting queue?
 *
 * The queue's checkbox is disabled until it is. That is a screen-side courtesy
 * and **not a control**: `approveReimburseAccountCheck` is what actually
 * decides, inside the transaction that claims the row, and it is where a rule
 * with teeth would go. What this prevents is an approver ticking eight claims,
 * pressing approve, and being told afterwards that three of them were missing a
 * G/L account — the failure the batch loop reports as a count.
 *
 * **It answers WHY, not just no.** A checkbox that is disabled and silent is
 * indistinguishable from one that is broken; every refusal here carries the
 * list of what is missing and a Thai sentence naming all of it at once, because
 * naming one gap of three sends somebody back twice more.
 *
 * Pure and import-free, so it is unit-tested without a database or a DOM.
 */

/** What a claim can be missing. Ordered as the table reads, left to right. */
export type ReadinessGap = "items" | "gl" | "vendor" | "paymentDate";

export interface ReadinessClaim {
  items: readonly { id: number; category: string | null; vendorNo: string | null }[];
  /** The date on this claim's own row, which may be the shared field's value. */
  paymentDate: string;
}

export interface ClaimReadiness {
  ready: boolean;
  /** Every gap, not the first — see the module note. */
  missing: ReadinessGap[];
  /** One Thai sentence for a `title`, or null when nothing is missing. */
  reason: string | null;
}

const GAP_TEXT: Record<ReadinessGap, string> = {
  items: "ยังไม่มีรายการค่าใช้จ่าย",
  gl: "ยังเลือก G/L ไม่ครบทุกรายการ",
  vendor: "ยังเลือก Vendor ไม่ครบทุกรายการ",
  paymentDate: "ยังไม่ได้เลือกวันจ่าย",
};

/** Trimmed-empty counts as absent: a value can reach these columns as "  ". */
function filled(v: string | null | undefined): boolean {
  return (v ?? "").trim() !== "";
}

export function claimReadiness(claim: ReadinessClaim): ClaimReadiness {
  const missing: ReadinessGap[] = [];

  // Refused rather than allowed. `every` on an empty list answers true, so a
  // claim with no lines would otherwise read as fully filled — and approving it
  // posts a journal with nothing on it.
  if (claim.items.length === 0) {
    missing.push("items");
  } else {
    if (!claim.items.every((i) => filled(i.category))) missing.push("gl");
    if (!claim.items.every((i) => filled(i.vendorNo))) missing.push("vendor");
  }

  if (!filled(claim.paymentDate)) missing.push("paymentDate");

  return {
    ready: missing.length === 0,
    missing,
    reason: missing.length === 0 ? null : missing.map((m) => GAP_TEXT[m]).join(" · "),
  };
}
