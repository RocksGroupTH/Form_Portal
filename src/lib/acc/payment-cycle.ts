/**
 * Which payment round a manager-approved claim is *meant* for.
 *
 * The company's rule: a claim the manager approves **before noon** goes out on
 * the next round; from noon onwards it waits for the one after. The rounds
 * themselves are the 2nd and 4th Friday, walked backward off weekends and
 * holidays — `payment-calendar.ts` decides those, this only picks among them.
 *
 * **A suggestion, not an assignment.** Nothing writes it: the accountant sees it
 * beside the date they are choosing and can pick another round, which is the
 * point of the column being editable. `getDefaultPaymentDate` still takes the
 * next round outright, so a claim approved without anybody opening this queue
 * lands there.
 *
 * **Local getters, not UTC ones.** ACC Portal's twin reads `getUTCHours()`
 * because that app still runs the driver on `useUTC: true`, where a Thai wall
 * clock comes back labelled UTC. This app set `useUTC: false` on 2026-08-27, so
 * the same `Date` is a real instant and the local getters are the ones that read
 * back the hour the manager actually clicked at. Copying that line across
 * unchanged would put every afternoon approval seven hours earlier and quietly
 * move half of them into the wrong round.
 *
 * Pure and import-free, so it is unit-tested without a database.
 */

/** Noon, on the manager's clock. */
const CUTOFF_HOUR = 12;

export function paymentDateForApproval(
  approvedAt: Date | null | undefined,
  validDates: readonly string[],
): string | null {
  if (!approvedAt || Number.isNaN(approvedAt.getTime())) return null;
  if (validDates.length === 0) return null;

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const approvedYmd = `${approvedAt.getFullYear()}-${pad2(approvedAt.getMonth() + 1)}-${pad2(approvedAt.getDate())}`;

  // Strictly after the approval day. A manager approving *on* a payment Friday
  // is approving for the round after it either way — that day's batch has
  // already been prepared.
  const upcoming = validDates.filter((s) => s > approvedYmd).sort();
  if (upcoming.length === 0) return null;

  const afterNoon = approvedAt.getHours() >= CUTOFF_HOUR;
  // `?? null` and not `upcoming[upcoming.length - 1]`: running off the end of
  // the calendar means the answer is not known, and naming the last round would
  // be a guess presented as a computation.
  return upcoming[afterNoon ? 1 : 0] ?? null;
}
