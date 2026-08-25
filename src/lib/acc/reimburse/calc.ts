export interface ReimburseItemInput {
  amount: number;
  vatAmount?: number | null;
  whtAmount?: number | null;
}

/**
 * The claim total: each line's VAT-inclusive `amount`, **less the withholding
 * tax on it** — the AP-4.1 sheet's จำนวนจ่ายสุทธิ column.
 *
 * `vatAmount` is not added: `amount` already contains its VAT, so summing it
 * again would double-count.
 *
 * **`whtAmount` is subtracted, and that changed on 2026-08-25.** The rule was
 * the other way round, on the reading that withholding tax is the company's
 * obligation to the revenue department rather than a deduction from the person
 * being paid back. That reads the money backwards for a *reimbursement*: the
 * employee withheld it on the company's behalf and handed the vendor only the
 * net, so the net is what they are out of pocket and the net is what they are
 * owed. The withheld part never left the employee's hands; the company remits
 * it separately. The AP-4.1 sheet ends in that figure, and a Thai tax invoice
 * prints it as "จำนวนเงินที่ชำระ".
 *
 * Safe to change when it was: measured that day, `AccReimburseItem` held **zero
 * rows** in both form databases, so no approved claim's stored total could be
 * contradicted by the new arithmetic.
 *
 * Both breakdown fields are coerced defensively rather than trusted. This is
 * the function that decides a payout, and `Number(null)` is 0 while
 * `Number("abc")` is NaN — one of those would quietly deduct nothing and the
 * other would turn the whole claim into NaN.
 */
export function sumReimburseItems(items: ReimburseItemInput[]): number {
  let total = 0;
  for (const i of items) {
    const amount = Number(i.amount) || 0;
    const wht = Number(i.whtAmount) || 0;
    // Never below zero: a line cannot owe the company money, and a negative one
    // would silently reduce every other line in the claim.
    // `sanitizeReceiptFields` already refuses a withheld figure larger than its
    // total, but a hand-typed one has been through no such gate.
    total += Math.max(0, amount - wht);
  }
  // Two decimal places, so a claim of 0.1 + 0.2 is 0.3 and not 0.30000000000000004.
  return Math.round(total * 100) / 100;
}
