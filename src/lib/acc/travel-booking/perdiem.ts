/**
 * AP-17 per-diem engine.
 *
 * Per-diem rate is looked up from a historical allowance rate log
 * (`AllowanceLogEntry[]`) — the rate in effect for a given day is the
 * `amount` of the entry with the greatest `effectiveDate` that is
 * `<= day`. Rates change over time, so a multi-day trip can span more
 * than one rate.
 */

export type AllowanceLogEntry = {
  effectiveDate: string; // 'YYYY-MM-DD'
  amount: number;
};

/**
 * The per-diem rate in effect for `day`, per the allowance log.
 * Picks the entry with the greatest `effectiveDate` that is `<= day`.
 * Returns 0 if no entry's `effectiveDate` is `<= day`.
 *
 * Dates are compared as 'YYYY-MM-DD' strings — this works lexicographically
 * for zero-padded ISO dates without needing to parse them.
 */
export function rateForDay(day: string, log: AllowanceLogEntry[]): number {
  let best: AllowanceLogEntry | null = null;
  for (const entry of log) {
    if (entry.effectiveDate > day) continue;
    if (!best || entry.effectiveDate > best.effectiveDate) {
      best = entry;
    }
  }
  return best ? best.amount : 0;
}

/** Format a local Date back to a 'YYYY-MM-DD' string using local getters. */
function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Parse a 'YYYY-MM-DD' string into a local Date (midnight local time). */
function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Computes the per-diem days + total for a trip spanning departDate..returnDate
 * (inclusive), applying the allowance rate for each counted day.
 *
 * If `isContinuation` is true, this leg continues from a previous request
 * (e.g. the traveler's departure day was already paid on an earlier request),
 * so the first day of the range is dropped from the count.
 */
export function computePerDiem(
  departDate: string,
  returnDate: string,
  isContinuation: boolean,
  log: AllowanceLogEntry[]
): { days: number; total: number; groups: { rate: number; days: number }[] } {
  const days: string[] = [];
  const cursor = parseDateKey(departDate);
  const end = parseDateKey(returnDate);
  while (cursor <= end) {
    days.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  const countedDays = isContinuation ? days.slice(1) : days;

  // Group counted days by their rate (first-seen order) so a trip that spans a rate change
  // can be shown as a breakdown (e.g. 1 วัน × ฿300 + 1 วัน × ฿400) instead of a wrong flat rate.
  const perRate = new Map<number, number>();
  const rateOrder: number[] = [];
  let total = 0;
  for (const d of countedDays) {
    const rate = rateForDay(d, log);
    total += rate;
    if (!perRate.has(rate)) rateOrder.push(rate);
    perRate.set(rate, (perRate.get(rate) ?? 0) + 1);
  }
  // Round to 2dp, avoiding floating-point drift (e.g. 0.1 + 0.2).
  total = Math.round(total * 100) / 100;
  const groups = rateOrder.map((rate) => ({ rate, days: perRate.get(rate)! }));

  return { days: countedDays.length, total, groups };
}
