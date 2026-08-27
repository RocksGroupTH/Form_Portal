/**
 * Whose fate a trip's per-diem figure still hangs on.
 *
 * A trip that departs on the day the one before it returned drops that day as a
 * duplicate. So its figure is only final once the earlier trip's own fate is: if
 * that trip is later rejected, `perdiem-recompute.ts` gives the day back and the
 * number changes. While the earlier trip is still sitting with its manager, the
 * number an accountant is looking at can still move under them — and that is the
 * one thing a sign-off must not be.
 *
 * This answers two questions at once, because the accounting queue asks both:
 * **which** request the figure depends on (so it can be named on screen), and
 * **whether that request is settled** (so the approve control can refuse).
 *
 * It supersedes an earlier idea — freezing the figure once accounting is holding
 * it. Blocking the sign-off is the better half of that trade: freezing would have
 * left accounting signing a number known to be provisional, where this refuses
 * until the number is real.
 *
 * Pure and import-free so it is unit-tested without a database.
 */

export interface DependencyTrip {
  requestId: number;
  requestNo: string | null;
  /** `AccTravelBooking.SortOrder` — the order the group was filled in. */
  sortOrder: number;
  departDate: string | null;
  returnDate: string | null;
  /** `AccRequest.Status`. */
  status: string;
}

export interface PerDiemDependency {
  requestId: number;
  requestNo: string | null;
  /** The status that decided `settled`, so the UI can say what it is waiting on. */
  status: string;
  /** False while the manager could still change this trip's fate. */
  settled: boolean;
}

/**
 * Dead, and so no longer a predecessor at all — `continuationFlags` skips these,
 * which is why a rejected trip's successor has already had its day returned.
 */
const DEAD: readonly string[] = ["Cancelled", "Rejected"];

/**
 * Fates the manager has finished deciding.
 *
 * `Returned` is deliberately **not** here: a returned request goes back to the
 * requester and may be resubmitted and approved, so the trip it precedes is not
 * safe to sign yet. `Draft` is absent for the same reason — nothing stops it
 * being submitted into the group later.
 *
 * An allow-list, so a status this file has never heard of counts as unsettled.
 * Refusing a sign-off that could have gone ahead costs somebody a second look;
 * allowing one on a figure that then moves costs a wrong payment.
 */
const SETTLED: readonly string[] = ["ManagerApproved", "Completed", "Cancelled", "Rejected"];

export function perDiemDependency(
  target: DependencyTrip,
  group: readonly DependencyTrip[],
): PerDiemDependency | null {
  if (!target.departDate) return null;

  const ordered = group.slice().sort((a, b) => a.sortOrder - b.sortOrder);
  const index = ordered.findIndex((t) => t.requestId === target.requestId);
  if (index <= 0) return null;

  // The nearest *live* predecessor, and only that one — the same rule
  // `continuationFlags` applies, because this has to answer for the figure that
  // rule produced. A dead trip is skipped: its day has already come back.
  let previous: DependencyTrip | null = null;
  for (let i = index - 1; i >= 0; i--) {
    if (DEAD.indexOf(ordered[i].status) === -1) {
      previous = ordered[i];
      break;
    }
  }

  // Not adjacent, so this trip never dropped a day to it and nothing that
  // happens to it can change this figure.
  if (!previous || !previous.returnDate || previous.returnDate !== target.departDate) {
    return null;
  }

  return {
    requestId: previous.requestId,
    requestNo: previous.requestNo,
    status: previous.status,
    settled: SETTLED.indexOf(previous.status) !== -1,
  };
}
