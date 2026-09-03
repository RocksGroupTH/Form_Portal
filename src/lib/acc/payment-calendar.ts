import { getCorePool, sql } from "@/lib/db/mssql";
import {
  defaultPaymentRound,
  nthFridayOfMonth,
  paymentRoundsInMonth,
  ymd,
} from "@/lib/acc/payment-calendar-core";

/** AP-1 pays on the 2nd and 4th Friday. AP-4 pays on the 1st and 3rd. */
const ROUNDS = [2, 4];

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

/**
 * The round a claim belongs to, given when its **manager** approved it.
 *
 * **The deadline is noon on the Monday of the round's own week**, not noon on
 * the day of approval. September 2026 pays on Fri 11 and Fri 25, whose Mondays
 * are the 7th and the 21st: a claim approved Thu 3 Sep at 16:31 is past noon on
 * its own day and still comfortably inside the 11th's round, while one approved
 * Mon 7 Sep at 12:01 falls to the 25th.
 *
 * **AP-1 had no such rule at all**, though `AP1_HEADER_MESSAGE_LINES` has been
 * promising it to requesters and a comment beside that copy said outright that
 * nothing enforced it. What stood here took the first upcoming 2nd/4th Friday,
 * which is right only when the approval happens to fall before that round's
 * Monday. `defaultPaymentRound` is AP-4's rule, now shared rather than copied —
 * the two forms differ only in which Fridays they pay on.
 *
 * Rounds are matched UNSHIFTED and the holiday shift applied after, so a Friday
 * moved back past a holiday cannot change which round a claim belongs to. The
 * returned string is the shifted, payable date.
 *
 * Null when nothing within `months` still has a deadline ahead — the caller
 * decides what to do rather than this inventing a date.
 */
export async function getDefaultPaymentDate(
  approvedAt: Date = new Date(),
  months = 4,
): Promise<string | null> {
  const start = new Date(approvedAt.getFullYear(), approvedAt.getMonth(), 1);
  const end = new Date(approvedAt.getFullYear(), approvedAt.getMonth() + months + 1, 0);
  const holidays = await getHolidaySet(start, end);

  const rounds: Date[] = [];
  for (let m = 0; m <= months; m++) {
    const anchor = new Date(approvedAt.getFullYear(), approvedAt.getMonth() + m, 1);
    for (const r of paymentRoundsInMonth(anchor.getFullYear(), anchor.getMonth(), ROUNDS)) {
      rounds.push(r);
    }
  }
  rounds.sort((a, b) => a.getTime() - b.getTime());

  const chosen = defaultPaymentRound(approvedAt, rounds);
  return chosen ? ymd(shiftPaymentDay(chosen, holidays)) : null;
}
