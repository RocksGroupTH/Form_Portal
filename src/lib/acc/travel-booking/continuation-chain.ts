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
  /**
   * `AccTravelBooking.SortOrder` — the order the group was filled in.
   * **Tiebreak only, since 2026-09-21**: the chain now orders by depart date,
   * because it spans a person's whole calendar rather than one booking group,
   * and SortOrder means nothing between groups filed weeks apart. This stays
   * only so two trips departing the same day keep a stable, reproducible
   * order instead of depending on row order.
   */
  sortOrder: number;
  departDate: string | null;
  returnDate: string | null;
  /** False once the trip is Cancelled or Rejected: it will not be paid. */
  alive: boolean;
}

/**
 * Each trip's own nearest live predecessor — the same walk `continuationFlags`
 * below has always done, exposed by identity rather than collapsed straight to
 * a boolean.
 *
 * **Added 2026-09-22, for I1**: naming *who* changed a trip's flag needs the
 * predecessor's identity, not only whether one touches. `submitTravelBookingGroup`
 * rewrites an existing trip when a newly filed one changes its continuation
 * status, and the activity log has to name that newly filed trip as the cause
 * — which needs this, not `continuationFlags`' boolean.
 *
 * `continuationFlags` is now a thin wrapper over this, so the two can never
 * disagree about who or what "the predecessor" is — the risk a hand-written
 * second walk would carry.
 */
export function continuationPredecessors(
  trips: readonly ChainTrip[],
): Map<number, ChainTrip | null> {
  // **Ordered by depart date, not by SortOrder** (2026-09-21). SortOrder orders
  // trips within ONE booking group and means nothing between groups filed weeks
  // apart — and this chain now spans a person's whole calendar, not one group.
  // SortOrder stays the tiebreak so two trips departing the same day keep a
  // stable, reproducible order instead of depending on row order.
  const ordered = trips.slice().sort((a, b) => {
    const ad = a.departDate ?? "";
    const bd = b.departDate ?? "";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return a.sortOrder - b.sortOrder;
  });
  const predecessors = new Map<number, ChainTrip | null>();

  for (let i = 0; i < ordered.length; i++) {
    const trip = ordered[i];
    // A dead trip, or one with no depart date, has no predecessor worth
    // finding — nothing will be computed from it either way (see
    // `continuationFlags` below), but every trip still gets an entry so a
    // caller iterating the map does not have to special-case it.
    if (!trip.alive || !trip.departDate) {
      predecessors.set(trip.requestId, null);
      continue;
    }

    // The nearest live predecessor, and only that one. Looking further back
    // would let a trip continue a journey it is not adjacent to. Deliberately
    // NOT also requiring a depart date here — a live, undated trip can still
    // sort immediately before another and stand as its "previous", exactly as
    // this walk has always allowed; `continuationFlags`' own boolean below
    // then reads false regardless, since a predecessor with no returnDate
    // never touches anything.
    let previous: ChainTrip | null = null;
    for (let j = i - 1; j >= 0; j--) {
      if (ordered[j].alive) {
        previous = ordered[j];
        break;
      }
    }
    predecessors.set(trip.requestId, previous);
  }

  return predecessors;
}

export function continuationFlags(trips: readonly ChainTrip[]): Map<number, boolean> {
  const predecessors = continuationPredecessors(trips);
  const flags = new Map<number, boolean>();
  for (const trip of trips) {
    const previous = predecessors.get(trip.requestId) ?? null;
    flags.set(
      trip.requestId,
      !!(previous && previous.returnDate && trip.departDate && previous.returnDate === trip.departDate),
    );
  }
  return flags;
}
