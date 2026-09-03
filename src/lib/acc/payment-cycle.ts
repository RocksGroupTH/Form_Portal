import { weekMondayNoon } from "@/lib/acc/payment-calendar-core";

/**
 * Which payment round a manager-approved claim is *meant* for.
 *
 * The company's rule: each round closes at **noon on the Monday of its own
 * week**. A claim the manager approves at or before that moment goes out on that
 * round; past it, the claim is measured against the NEXT round's own Monday,
 * which is normally a fortnight away. The rounds themselves are the 2nd and 4th
 * Friday, walked backward off weekends and holidays — `payment-calendar.ts`
 * decides those, this only picks among them.
 *
 * **This read `getHours() >= 12` on the approval's own day until 2026-09-03**,
 * skipping a round for any afternoon approval. TOF26-09046 was approved Thu
 * 03/09 16:31 — four days before its round's Monday — and was suggested 25/09
 * instead of 11/09. Noon is the right hour and the wrong day: the deadline
 * belongs to the round, not to the approver.
 *
 * **A suggestion, not an assignment.** Nothing writes it: the accountant sees it
 * beside the date they are choosing and can pick another round, which is the
 * point of the column being editable. `getDefaultPaymentDate` now applies the
 * same rule, so a claim approved without anybody opening this queue lands on the
 * same round this would have suggested.
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

export function paymentDateForApproval(
  approvedAt: Date | null | undefined,
  validDates: readonly string[],
): string | null {
  if (!approvedAt || Number.isNaN(approvedAt.getTime())) return null;

  // The Monday is read off whichever date is given, and these arrive
  // holiday-shifted. A Friday walked back within its own week keeps the same
  // Monday, so the shift does not move the deadline; a shift far enough to
  // cross a week would need five consecutive non-working days, and the round
  // would then be its own week's Monday or earlier anyway.
  for (const s of validDates.slice().sort()) {
    const parts = s.split("-");
    const round = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (approvedAt.getTime() <= weekMondayNoon(round).getTime()) return s;
  }
  // Not the last round: running off the end of the calendar means the answer is
  // not known, and naming one would be a guess presented as a computation.
  return null;
}
