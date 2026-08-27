/**
 * The earliest day AP-17 will accept a trip on: tomorrow.
 *
 * A booking desk has to actually book something — a hotel, a ticket — and a
 * request naming today reaches them with the day already gone. Same-day travel
 * is not a booking, it is a reimbursement, which is what AP-1 is for.
 *
 * **The boundary is the calendar, not twenty-four hours.** Somebody filling the
 * form at 23:59 gets the same earliest date as somebody filling it at 00:01,
 * because "the next working day" is what a desk plans around, and a rule that
 * slid with the clock would offer a day at one hour and refuse it the next.
 *
 * Pure and import-free so it is unit-tested without a database, and shared by
 * the picker's `minDate`, the client validator and the submit route — one rule,
 * asserted in all three places, because a control removed from a page is not a
 * rule.
 */

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** `YYYY-MM-DD` for tomorrow, in the viewer's own calendar. */
export function earliestTravelDate(now: Date): string {
  // Local getters and `setDate` throughout: `setDate` past the end of a month
  // rolls the month, and past December rolls the year, so there is nothing to
  // special-case. `toISOString()` would answer in UTC and, at UTC+7, name
  // yesterday for most of the evening.
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Whether a chosen date falls before that boundary.
 *
 * A blank date is **not** too soon: that is somebody part-way through the form,
 * and the required-field check is what speaks to it. Reporting both would put
 * two errors on one empty box.
 */
export function isTravelDateTooSoon(date: string | null | undefined, now: Date): boolean {
  if (!date) return false;
  return date < earliestTravelDate(now);
}
