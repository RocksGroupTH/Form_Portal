/**
 * The payout months AP-17's accounting step may choose between.
 *
 * AP-17 pays at a month's end — `payment-month.ts` already sets the date that
 * way at manager approval (on or before the 20th pays this month, after it rolls
 * to the next). This is the same convention offered as a choice: pick a month,
 * and the date is that month's last day. There is no day to get wrong.
 *
 * From the current month forward, never back: a payout already in the past is
 * not a schedule. AP-1's correction case does not apply here because the figure
 * is not signed yet — see the spec.
 *
 * Pure and import-free so it is unit-tested without a database.
 */

const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

export interface PayoutMonth {
  /** `"YYYY-MM"` — what the client posts back. */
  ym: string;
  /** That month's last day, `"YYYY-MM-DD"`. */
  date: string;
  /** `"สิงหาคม 2569"`. */
  label: string;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * `new Date(y, m, 0)` is the last day of month `m - 1` (0-indexed), so passing
 * the 1-indexed month gives that month's own end, and `Date` normalises a
 * December rollover on its own.
 */
function lastDayOf(year: number, month1: number): Date {
  return new Date(year, month1, 0);
}

export function payoutDateForMonth(ym: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym ?? "");
  if (!m) return null;
  const year = Number(m[1]);
  const month1 = Number(m[2]);
  if (month1 < 1 || month1 > 12) return null;
  const d = lastDayOf(year, month1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function payoutMonthOptions(from: Date = new Date(), count = 12): PayoutMonth[] {
  const out: PayoutMonth[] = [];
  for (let i = 0; i < count; i++) {
    const anchor = new Date(from.getFullYear(), from.getMonth() + i, 1);
    const year = anchor.getFullYear();
    const month0 = anchor.getMonth();
    const ym = `${year}-${pad2(month0 + 1)}`;
    const date = payoutDateForMonth(ym);
    if (!date) continue;
    out.push({ ym, date, label: `${THAI_MONTHS[month0]} ${year + 543}` });
  }
  return out;
}
