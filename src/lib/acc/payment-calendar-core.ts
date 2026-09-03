/**
 * Pure date-math helpers shared by every Accounting payment calendar.
 *
 * Deliberately free of any database import (contrast with payment-calendar.ts,
 * which pulls in getCorePool for the holiday lookup): src/lib/db/mssql.ts reads
 * @/env at module scope, so anything that statically imports it — even just to
 * reach an unrelated named export — fails immediately outside a Next.js request
 * unless every MSSQL_* / AUTH_SECRET var is already in process.env, which the
 * test runner (tsx, no .env loading) never sets. Keeping nthFridayOfMonth and
 * ymd here, with no import chain back to the DB layer, is what lets AP-4's
 * payment-calendar tests (src/lib/acc/reimburse/payment-calendar.test.ts) run
 * as plain unit tests. src/lib/acc/payment-calendar.ts (AP-1) re-exports both
 * from here unchanged, so this is a relocation, not a behaviour change.
 */

export function nthFridayOfMonth(year: number, month0: number, nth: number): Date {
  const d = new Date(year, month0, 1);
  const offset = (5 - d.getDay() + 7) % 7; // 5 = Friday
  return new Date(year, month0, 1 + offset + (nth - 1) * 7);
}

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The Friday rounds of a month, unshifted — before any holiday adjustment.
 *
 * `nths` is the form's own calendar: AP-1 pays on the 2nd and 4th Friday, AP-4
 * on the 1st and 3rd. That is the *only* difference between them, which is why
 * the cut-off below is shared rather than copied.
 */
export function paymentRoundsInMonth(year: number, month0: number, nths: readonly number[]): Date[] {
  return nths.map((nth) => nthFridayOfMonth(year, month0, nth));
}

/** Monday 12:00 of the week containing `d` — `d` being a Friday round date. */
export function weekMondayNoon(d: Date): Date {
  const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
  // getDay(): 0 Sun .. 6 Sat. Step back to that week's Monday.
  const back = (mon.getDay() + 6) % 7;
  mon.setDate(mon.getDate() - back);
  return mon;
}

/**
 * The round a claim belongs to when it was approved at `at`: the first round
 * whose own week's Monday noon has not yet passed.
 *
 * **Each round's deadline is its OWN Monday noon, not one cutoff shared by every
 * round.** An approval at Monday 13:00 does not merely miss that week's Friday —
 * it is then measured against the *next* round's Monday, which is normally still
 * well ahead. A single cutoff derived from the approval's own week cannot say
 * that: it happens to equal this week's Friday's deadline and has no
 * relationship to the next round's at all.
 *
 * `<=` is what makes exactly Monday noon still in time.
 *
 * `rounds` are UNSHIFTED round dates, so the arithmetic is not perturbed by a
 * holiday moving a Friday into another week. The shift happens after a round is
 * chosen, never before.
 *
 * Null when every round given has passed its deadline — the caller looks further
 * out rather than this inventing a month.
 */
export function defaultPaymentRound(at: Date, rounds: readonly Date[]): Date | null {
  for (const r of rounds) {
    if (at.getTime() <= weekMondayNoon(r).getTime()) return r;
  }
  return null;
}
