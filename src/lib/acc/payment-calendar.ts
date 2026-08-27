import { getCorePool, sql } from "@/lib/db/mssql";
import { nthFridayOfMonth, ymd } from "@/lib/acc/payment-calendar-core";

// Re-exported for src/lib/acc/reimburse/payment-calendar.ts (AP-4), which needs
// the same building blocks but a different round (1st/3rd Friday instead of
// 2nd/4th). Behaviour is unchanged — the bodies just moved to payment-calendar-core.ts
// (a module with no database import) so a pure-logic caller can use them without
// pulling in @/lib/db/mssql. See that file for why that matters.
export { nthFridayOfMonth, ymd };

/** Fetch holiday date strings (YYYY-MM-DD) within [from,to] from Rocks_Codex. */
export async function getHolidaySet(from: Date, to: Date): Promise<Set<string>> {
  const pool = await getCorePool();
  const r = await pool
    .request()
    .input("from", sql.Date, from)
    .input("to", sql.Date, to)
    .query(`
      SELECT CONVERT(varchar(10), [Date], 23) AS d
      FROM [Rocks_Codex].[dbo].[Holiday]
      WHERE [Date] BETWEEN @from AND @to
        AND IsActive = 1
    `);
  return new Set(r.recordset.map((x: { d: string }) => x.d));
}

/** Shift backward when the payment Friday falls on a weekend or public holiday. */
export function shiftPaymentDay(d: Date, holidays: Set<string>): Date {
  const cur = new Date(d);
  while (cur.getDay() === 0 || cur.getDay() === 6 || holidays.has(ymd(cur))) {
    cur.setDate(cur.getDate() - 1);
  }
  return cur;
}

/** Valid payment dates (2nd & 4th Friday, holiday-shifted) for the next `months`. */
export async function getPaymentDates(
  from: Date = new Date(),
  months = 4,
  /**
   * How many months back to include.
   *
   * Zero for the picker a requester sees — nobody schedules a payment into the
   * past. The payment-date correction route passes a window because an admin
   * fixing an already-approved claim may need a round that has been and gone.
   */
  monthsBack = 0,
): Promise<string[]> {
  const start = new Date(from.getFullYear(), from.getMonth() - monthsBack, 1);
  const end = new Date(from.getFullYear(), from.getMonth() + months + 1, 0);
  const holidays = await getHolidaySet(start, end);

  // Hoisted: it does not change per round, and rebuilding it inside the inner
  // loop was a new Date on every candidate.
  const todayMidnight = new Date(from.getFullYear(), from.getMonth(), from.getDate());

  const out: string[] = [];
  for (let m = -monthsBack; m <= months; m++) {
    const anchor = new Date(from.getFullYear(), from.getMonth() + m, 1);
    for (const nth of [2, 4]) {
      const base = nthFridayOfMonth(anchor.getFullYear(), anchor.getMonth(), nth);
      const shifted = shiftPaymentDay(base, holidays);
      const s = ymd(shifted);
      // Past rounds only when explicitly backfilling. A requester's picker asks
      // for none and so is unchanged.
      if ((monthsBack > 0 || shifted >= todayMidnight) && !out.includes(s)) out.push(s);
    }
  }
  return out.sort();
}

/** The default next payment date (first upcoming). */
export async function getDefaultPaymentDate(from: Date = new Date()): Promise<string | null> {
  const dates = await getPaymentDates(from);
  return dates[0] ?? null;
}
