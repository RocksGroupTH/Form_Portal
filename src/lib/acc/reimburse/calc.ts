export interface ReimburseItemInput {
  amount: number;
  vatAmount?: number | null;
  whtAmount?: number | null;
}

/**
 * The claim total: the sum of each item's VAT-inclusive `amount`.
 *
 * `vatAmount` and `whtAmount` are informational breakdowns, not add-ons —
 * `amount` already contains its VAT, so summing `vatAmount` too would
 * double-count it, and withholding tax is money the company owes the revenue
 * department, not a deduction from what the employee is owed back. Neither
 * field changes the total.
 */
export function sumReimburseItems(items: ReimburseItemInput[]): number {
  let total = 0;
  for (const i of items) total += Number(i.amount) || 0;
  // Two decimal places, so a claim of 0.1 + 0.2 is 0.3 and not 0.30000000000000004.
  return Math.round(total * 100) / 100;
}
