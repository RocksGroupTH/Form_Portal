/**
 * Which trips in a booking group continue the one before them.
 *
 * A trip is a continuation when it departs on the day the previous trip
 * returned: the day is worked once and paid once, so the later trip drops it.
 *
 * **`alive` is the whole reason this module exists.** `submitTravelBookingGroup`
 * decides the same thing from `tabs[i - 1]` at submit time and stores the answer,
 * so a trip cancelled afterwards goes on absorbing a day nobody will be paid
 * for. Here a dead trip is skipped and the search continues to the nearest live
 * predecessor — usually finding one whose dates do not touch, which gives the
 * day back.
 *
 * Pure and import-free so it is unit-tested without a database.
 */

export interface ChainTrip {
  requestId: number;
  /** `AccTravelBooking.SortOrder` — the order the group was filled in. */
  sortOrder: number;
  departDate: string | null;
  returnDate: string | null;
  /** False once the trip is Cancelled or Rejected: it will not be paid. */
  alive: boolean;
}

export function continuationFlags(trips: readonly ChainTrip[]): Map<number, boolean> {
  const ordered = trips.slice().sort((a, b) => a.sortOrder - b.sortOrder);
  const flags = new Map<number, boolean>();

  for (let i = 0; i < ordered.length; i++) {
    const trip = ordered[i];
    // A dead trip's own flag is meaningless — nothing will be computed from it —
    // but it is reported false rather than left absent so a caller iterating the
    // map does not have to special-case it.
    if (!trip.alive || !trip.departDate) {
      flags.set(trip.requestId, false);
      continue;
    }

    // The nearest live predecessor, and only that one. Looking further back
    // would let a trip continue a journey it is not adjacent to.
    let previous: ChainTrip | null = null;
    for (let j = i - 1; j >= 0; j--) {
      if (ordered[j].alive) {
        previous = ordered[j];
        break;
      }
    }

    flags.set(
      trip.requestId,
      !!(previous && previous.returnDate && previous.returnDate === trip.departDate),
    );
  }

  return flags;
}
