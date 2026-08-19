import { nthFridayOfMonth, ymd } from "@/lib/acc/payment-calendar-core";

// AP-4 (staff reimbursement) pays on the 1st and 3rd Friday of the month.
// AP-1 (travel expense) pays on the 2nd and 4th Friday — a different calendar,
// which is why this lives in its own module rather than adding a branch to
// src/lib/acc/payment-calendar.ts. The building blocks are shared by import,
// not by copy: nthFridayOfMonth/ymd come from the pure payment-calendar-core.ts
// (see that file for why "pure" matters — it has no @/lib/db/mssql import, so
// paymentRoundsInMonth/defaultPaymentRound stay plain, DB-free unit tests).
// getHolidaySet/shiftPaymentDay are DB-touching and only used inside
// getReimbursePaymentDates below, imported dynamically there for the same reason.
const ROUNDS = [1, 3];

/** The 1st and 3rd Friday of the given month, unshifted (i.e. before holiday adjustment). */
export function paymentRoundsInMonth(year: number, month0: number): Date[] {
  return ROUNDS.map((nth) => nthFridayOfMonth(year, month0, nth));
}

/** Whether `date` is one of the (unshifted) 1st/3rd Friday rounds for its month. */
export function isPaymentRound(date: Date): boolean {
  const rounds = paymentRoundsInMonth(date.getFullYear(), date.getMonth());
  const target = ymd(date);
  return rounds.some((r) => ymd(r) === target);
}

/** Monday 12:00 of the week that contains `d` (d is a Friday round date). */
function weekMondayNoon(d: Date): Date {
  const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
  // getDay(): 0 Sun .. 6 Sat. Step back to that week's Monday.
  const back = (mon.getDay() + 6) % 7;
  mon.setDate(mon.getDate() - back);
  return mon;
}

/**
 * The round a payment defaults to when accounting checks the request at
 * `checkedAt`: the first round (in the given order) whose own week's Monday
 * noon has not yet passed.
 *
 * Each round's deadline is *its own* Monday noon, not one cutoff shared by every
 * round — a check on Monday 13:00 (past that week's noon) does not just miss
 * that week's Friday, it evaluates the next round against *that* round's Monday
 * noon, which is normally still well in the future. A single checkedAt-relative
 * cutoff cannot express this: it would need to compare against a fixed point
 * derived from checkedAt's own week, which happens to equal this week's Friday's
 * deadline but has no relationship to the next round's deadline at all.
 *
 * "At or before" (`<=`) is what makes exactly Monday noon still count as in time.
 *
 * `rounds` are unshifted round dates (see paymentRoundsInMonth / getReimbursePaymentDates)
 * so the cut-off math is not perturbed by a holiday shift changing which round a
 * date belongs to — shift happens after a round is chosen, never before.
 */
export function defaultPaymentRound(checkedAt: Date, rounds: Date[]): Date | null {
  for (const r of rounds) {
    if (checkedAt.getTime() <= weekMondayNoon(r).getTime()) return r;
  }
  return null;
}

/** Valid reimbursement payment dates (1st & 3rd Friday, holiday-shifted) for the next `months`. */
export async function getReimbursePaymentDates(from: Date = new Date(), months = 4): Promise<string[]> {
  // Imported dynamically (not at module top) so loading this module for the
  // synchronous exports above never requires a live database configuration —
  // see the file banner and payment-calendar-core.ts.
  const { getHolidaySet, shiftPaymentDay } = await import("@/lib/acc/payment-calendar");

  const start = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(from.getFullYear(), from.getMonth() + months + 1, 0);
  const holidays = await getHolidaySet(start, end);

  const out: string[] = [];
  for (let m = 0; m <= months; m++) {
    const anchor = new Date(from.getFullYear(), from.getMonth() + m, 1);
    for (const round of paymentRoundsInMonth(anchor.getFullYear(), anchor.getMonth())) {
      const shifted = shiftPaymentDay(round, holidays);
      const s = ymd(shifted);
      const todayMidnight = new Date(from.getFullYear(), from.getMonth(), from.getDate());
      if (shifted >= todayMidnight && !out.includes(s)) out.push(s);
    }
  }
  return out.sort();
}
