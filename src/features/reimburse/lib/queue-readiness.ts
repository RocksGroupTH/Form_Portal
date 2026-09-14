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
 * **The vendor half of the rule lives in `vendor-match-core.ts`, not here.**
 * It is the same predicate the matcher and the ERP payload read, and a second
 * copy on the screen would drift from the one at the money — which is exactly
 * how this file came to demand a vendor on lines that can never carry one.
 *
 * Pure, and import-free at runtime apart from that one rule.
 */
import { vendorRequired } from "@/lib/acc/reimburse/vendor-match-core";
import type { VendorMatchStatus } from "@/lib/acc/reimburse/vendor-match-core";

/** What a claim can be missing. Ordered as the table reads, left to right. */
export type ReadinessGap = "items" | "gl" | "vendor" | "paymentDate";

export interface ReadinessClaim {
  items: readonly {
    id: number;
    category: string | null;
    vendorNo: string | null;
    /** Only a line carrying VAT produces a VAT line, which is the only line a vendor travels on. */
    vatAmount: number | null;
    /** `null` = nobody has looked. Not the same as `"none"` — see `vendorRequired`. */
    vendorMatchStatus: VendorMatchStatus | null;
  }[];
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
  // "ยังไม่ได้ตรวจ" rather than "ยังเลือกไม่ครบ": the remedy is the ตรวจ Vendor
  // button, not a picker. A line whose seller genuinely has no card is
  // released by that button, and telling somebody to "choose one" sends them
  // to a list of a thousand cards looking for something that is not there.
  vendor: "ยังไม่ได้ตรวจ Vendor ให้ครบทุกรายการที่มี VAT",
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
    if (claim.items.some((i) => vendorRequired(i))) missing.push("vendor");
  }

  if (!filled(claim.paymentDate)) missing.push("paymentDate");

  return {
    ready: missing.length === 0,
    missing,
    reason: missing.length === 0 ? null : missing.map((m) => GAP_TEXT[m]).join(" · "),
  };
}
