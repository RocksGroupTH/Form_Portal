import { getCorePool, sql } from "@/lib/db/mssql";
import { defaultPaymentRound, ymd } from "@/lib/acc/payment-calendar-core";
import { paydaysInMonth, type PaydayForm } from "@/lib/acc/payment-rounds";

// Re-exported for src/lib/acc/reimburse/approval-service.ts (AP-4), which takes
// `ymd` from here alongside getHolidaySet/shiftPaymentDay and so has one import
// of this module rather than two. AP-4's own payment-calendar.ts does NOT come
// through here: it imports the pure helpers straight from payment-calendar-core
// and reaches this module only through a dynamic import for the two DB-touching
// functions, precisely so it stays loadable without @/lib/db/mssql. The body
// moved to payment-calendar-core.ts (a module with no database import) so a
// pure-logic caller can use it without pulling in @/env. See that file for why
// that matters.
export { ymd };

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

/**
 * Valid payment dates (holiday-shifted) for the next `months`.
 *
 * `form` has no default on purpose: every caller must say which form it is
 * asking for, so the compiler — not a review — finds anyone still assuming
 * the old shared 2nd/4th-Friday calendar.
 */
export async function getPaymentDates(
  form: PaydayForm,
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
    for (const base of paydaysInMonth(form, anchor.getFullYear(), anchor.getMonth())) {
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
 * the day of approval, and every round carries its own — there is no single
 * cut-off shared by the calendar. Which Fridays are rounds is `form`'s business
 * (`paydaysInMonth`); this rule applies to whatever they turn out to be.
 *
 * For AP-1 and AP-3, September 2026 pays on Fri 11 and Fri 25, whose Mondays are
 * the 7th and the 21st: a claim approved Thu 3 Sep at 16:31 is past noon on its
 * own day and still comfortably inside the 11th's round, while one approved Mon
 * 7 Sep at 12:01 falls all the way to the 25th. For AP-2 the same September pays
 * on the 4th, 11th, 18th and 25th, with Mondays on the 31st of August, the 7th,
 * the 14th and the 21st — so that Mon 7 Sep 12:01 approval falls only to the
 * 18th, one week rather than two.
 *
 * **The cut-off is not AP-2-shaped, and that is an open question, not a
 * decision.** It was designed for a fortnightly cadence, where missing Monday
 * noon cost two weeks and was worth a rule. Under AP-2's weekly cadence an
 * approval at Monday 12:01 defaults to the Friday eleven days out while the
 * Friday four days out sits selectable in the picker beside it. Whether AP-2
 * should have a cut-off of its own is with the business as of 2026-09-24; until
 * that comes back AP-2 deliberately shares this one, so the behaviour here is
 * intentional rather than overlooked.
 *
 * **AP-1 had no such rule at all** before this, though `AP1_HEADER_MESSAGE_LINES`
 * had been promising it to requesters and a comment beside that copy said
 * outright that nothing enforced it. What stood here took the first upcoming
 * round, which is right only when the approval happens to fall before that
 * round's Monday. `defaultPaymentRound` is AP-4's rule, now shared rather than
 * copied.
 *
 * Rounds are matched UNSHIFTED and the holiday shift applied after, so a Friday
 * moved back past a holiday cannot change which round a claim belongs to. The
 * returned string is the shifted, payable date.
 *
 * Null when nothing within `months` still has a deadline ahead — the caller
 * decides what to do rather than this inventing a date.
 */
export async function getDefaultPaymentDate(
  form: PaydayForm,
  approvedAt: Date = new Date(),
  months = 4,
): Promise<string | null> {
  const only = await paymentRoundsForApprovals(form, [approvedAt], months);
  return only[0];
}

/**
 * Every round for `form`, from `from`'s month through `months` later, UNSHIFTED,
 * ascending. "Round" means a fortnightly round for AP-1 and AP-3 and any Friday
 * of the month for AP-2 — `paydaysInMonth` owns which, this only orders them.
 */
function unshiftedRounds(form: PaydayForm, from: Date, months: number): Date[] {
  const out: Date[] = [];
  for (let m = 0; m <= months; m++) {
    const anchor = new Date(from.getFullYear(), from.getMonth() + m, 1);
    for (const r of paydaysInMonth(form, anchor.getFullYear(), anchor.getMonth())) {
      out.push(r);
    }
  }
  out.sort((a, b) => a.getTime() - b.getTime());
  return out;
}

/**
 * The round each claim belongs to, from when its **manager** approved it,
 * returned as the payable (holiday-shifted) date.
 *
 * **Anchored on each approval, never on "now", and that is the point.** The
 * round is a property of the claim, fixed the moment the manager signs. The
 * suggestion used to be computed against `getPaymentDates(form)`, which drops every
 * round earlier than today — so a claim approved 03/09 read 11/09 up to and
 * including the 11th and then silently read 25/09 from the 12th, with nothing on
 * screen saying anything had changed. An accountant working a queue on Monday
 * and again on Friday saw two different answers for the same untouched claim.
 *
 * Batched because the holidays are one query for the whole page rather than one
 * per row: the window spans the earliest approval forward, so every claim in the
 * list finds its own round in the same list of candidates.
 *
 * Rounds are matched UNSHIFTED and the shift applied to the chosen one, so a
 * holiday moves the payout and never the deadline — see
 * `payment-calendar-core.ts`.
 */
export async function paymentRoundsForApprovals(
  form: PaydayForm,
  approvedAts: readonly (Date | null | undefined)[],
  months = 4,
): Promise<(string | null)[]> {
  let earliest: Date | null = null;
  for (const a of approvedAts) {
    if (!a || Number.isNaN(a.getTime())) continue;
    if (earliest === null || a.getTime() < earliest.getTime()) earliest = a;
  }
  if (earliest === null) return approvedAts.map(() => null);

  const start = new Date(earliest.getFullYear(), earliest.getMonth(), 1);
  const end = new Date(earliest.getFullYear(), earliest.getMonth() + months + 1, 0);
  const holidays = await getHolidaySet(start, end);
  const rounds = unshiftedRounds(form, earliest, months);

  return approvedAts.map((a) => {
    if (!a || Number.isNaN(a.getTime())) return null;
    const chosen = defaultPaymentRound(a, rounds);
    return chosen ? ymd(shiftPaymentDay(chosen, holidays)) : null;
  });
}
