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
