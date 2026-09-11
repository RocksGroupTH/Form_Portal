/**
 * The seller's branch on a Thai tax invoice, as the five-digit code BC keeps.
 *
 * Thailand's Revenue Department numbers a company's establishments: `00000` is
 * the head office, `00001` the first branch. BC stores it as `Code[5]` on the
 * Vendor (`NWTH Branch Code`, captioned "Thai Branch Code"), and the journal
 * line's `Branch Code` is filled from the vendor card — so it is the **seller's**
 * branch that belongs here, never the buyer's.
 *
 * The OCR copies whatever the invoice prints; the rule lives here, the way the
 * printed Thai date and the ภ.ง.ด. type do.
 */

const HEAD_OFFICE = /สำนักงานใหญ่|สนญ|head\s*office|h\.?o\.?$/i;

/**
 * What a line gets when the invoice's branch could not be read.
 *
 * `taxBranchCode` still answers null for "nothing readable" — that is the
 * honest answer and other callers depend on it. The receipt-read path fills
 * this in on top (user, 2026-09-11) because nearly every invoice is the head
 * office and chasing the field row by row costs more than it saves. The read
 * dialog names the rows it was filled on, so it is a default, not a claim.
 */
export const DEFAULT_TAX_BRANCH_CODE = "00000";

/**
 * Null means nothing readable was printed — and nothing is then sent, so BC
 * keeps whatever the vendor card holds. A guess here would put a branch on a tax
 * filing, which is not a field to be helpful in.
 */
export function taxBranchCode(printed: string | null | undefined): string | null {
  const t = (printed ?? "").trim();
  if (!t) return null;

  if (HEAD_OFFICE.test(t)) return "00000";

  // "สาขาที่ 00001", "สาขา 1", "Branch 23", or a bare "00002".
  const digits = t.replace(/\D/g, "");
  if (!digits) return null;
  // Six digits or more is not a branch code, and cutting it down would name a
  // different branch than the one printed.
  if (digits.length > 5) return null;
  return digits.padStart(5, "0");
}
