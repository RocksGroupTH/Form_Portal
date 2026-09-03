import {
  defaultPaymentRound,
  nthFridayOfMonth,
  paymentRoundsInMonth as roundsOf,
  ymd,
} from "@/lib/acc/payment-calendar-core";

// Re-exported unchanged: `approval-service.ts` and `approval-policy.test.ts`
// import it from here, and the rule is now shared with AP-1 rather than living
// in this file. Moving it did not change it — the core's tests carry the same
// cases plus AP-1's.
export { defaultPaymentRound };

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
  return roundsOf(year, month0, ROUNDS);
}

/** Whether `date` is one of the (unshifted) 1st/3rd Friday rounds for its month. */
export function isPaymentRound(date: Date): boolean {
  const rounds = paymentRoundsInMonth(date.getFullYear(), date.getMonth());
  const target = ymd(date);
  return rounds.some((r) => ymd(r) === target);
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
