import type { ChainTrip } from "@/lib/acc/travel-booking/continuation-chain";

/**
 * Inputs to the LIVE per-diem estimate `useTravelBookingForm.ts` shows while a
 * requester is filling the form in — built so the two things that decide
 * `computePerDiem`'s answer (continuation, room booking) agree with what
 * `submitTravelBookingGroup` (request-service.ts) actually stores, rather than
 * being a private re-implementation of either rule.
 *
 * Pure and import-free of anything reaching a database, so it is unit-tested
 * without one — the hook itself is not directly importable, since it reaches
 * `@/env` transitively through its own imports.
 */

/** The tab fields this module needs — a subset of `TabFormState`. */
export interface EstimateTab {
  /** `AccRequest.Id` — unset until this tab has been saved at least once. */
  id?: number;
  departDate: string | null;
  returnDate: string | null;
}

/** The other-trip fields this module needs — a subset of `OtherTrip`, widened
 *  with the real `AccTravelBooking.SortOrder` column (Task 8 fix round 1). */
export interface EstimateOtherTrip {
  requestId: number;
  departDate: string;
  returnDate: string;
  sortOrder: number;
}

/**
 * The form's own tabs plus the requester's other, already-saved trips, as one
 * ordered list for the shared `continuationFlags` (continuation-chain.ts) —
 * the same two halves `submitTravelBookingGroup` concatenates into its own
 * `chainTrips` at submit (request-service.ts: this group's tabs, `sortOrder:
 * i`, concatenated with `liveOthers`), so the live estimate's continuation
 * call agrees with the one the submit makes rather than being a private,
 * fourth independent answer.
 *
 * **`requestId`.** A tab not yet saved has no `AccRequest.Id` yet, so it is
 * given a synthetic id, `-(index + 1)`. Negative, because every real id —
 * production or UAT — is a positive integer (CLAUDE.md, "Ids never
 * collide"), so a synthetic one can never be mistaken for a real
 * `otherTrip.requestId`. It only ever serves as `continuationFlags`' map key
 * for reading the answer back out; it plays no part in the continuation
 * decision itself, which reads `departDate`/`returnDate`/`alive`.
 *
 * **`sortOrder`.** The real `AccTravelBooking.SortOrder` column
 * `continuation-chain.ts` uses ONLY as a depart-date tiebreak. Own tabs get
 * their array index — exactly what `request-service.ts`'s own `chainTrips`
 * gives an unsaved tab (`sortOrder: i`), so an unsaved tab's estimate orders
 * identically to how that same tab would order at submit; this is not
 * invented, it is parity with the server. **The requester's OTHER trips now
 * carry their own real `SortOrder` too (Task 8 fix round 1)** —
 * `/api/request/travel-booking/date-ranges`
 * (`listTravelBookingDateRanges`, request-service.ts) was widened to select
 * `AccTravelBooking.SortOrder`, the same column `loadRequesterTrips` (the
 * server's own continuation source) already read — so this is no longer an
 * approximation on either half: both arms hand `continuationFlags` the exact
 * value the submit itself would. (An earlier version of this module used
 * each other trip's `requestId` as a stand-in tiebreak, real data but not the
 * real column; that stand-in and the report section explaining why it was
 * safe are both gone, superseded by the real value.)
 */
export function buildEstimateChainTrips(
  tabs: readonly EstimateTab[],
  otherTrips: readonly EstimateOtherTrip[],
): ChainTrip[] {
  const own: ChainTrip[] = tabs.map((t, i) => ({
    requestId: t.id ?? -(i + 1),
    sortOrder: i,
    departDate: t.departDate,
    returnDate: t.returnDate,
    alive: true,
  }));
  const others: ChainTrip[] = otherTrips.map((o) => ({
    requestId: o.requestId,
    sortOrder: o.sortOrder,
    departDate: o.departDate,
    returnDate: o.returnDate,
    alive: true,
  }));
  return own.concat(others);
}

/**
 * Whether a tab's room-booking state should withhold the live per-diem
 * estimate's MONEY. Never its day count — see `useTravelBookingForm.ts`,
 * which keeps `computePerDiem`'s `days` and only zeroes `total`/`groups` when
 * this answers true, the same shaping already used for an unresolved foreign
 * rate (`attribution.kind === "pending"`).
 *
 * **The chosen-accommodation case mirrors the server exactly, not merely by
 * name.** `TravelBookingTab.tsx` sets `tab.needsRoomBooking` straight from
 * the selected option's own flag the moment it is picked
 * (`needsRoomBooking: !!a?.needsRoomBooking`), which is the same
 * `AccTravelAccommodation.NeedsRoomBooking` column `deriveBookingFlags`
 * reads server-side (`derive-flags.ts`) and that the submit reads back off
 * the persisted row (`tabs[i].needsRoomBooking`, request-service.ts) — never
 * off a posted DTO. So once an accommodation is chosen, this predicate
 * answers exactly what the submit will.
 *
 * **No accommodation chosen yet is a third state `deriveBookingFlags` never
 * sees**, because AP-17 cannot be submitted without one (`validateTab`'s
 * `accommodation` issue) — the server-side flag is always resolved from a
 * real row by the time it matters. Treated here the same as "chosen, books no
 * room": the true answer is not yet decided, and showing a confident non-zero
 * figure that may disappear the instant an option is picked is exactly the
 * "confidently wrong in the other direction" this fix exists to avoid.
 * `ratesKnown`/`settled` in `useTravelBookingForm.ts` withhold a foreign
 * trip's money the same way, for the same reason — an unresolved input must
 * not brand its guess as a fact.
 */
export function moneyWithheldForRoom(accommodationId: number | null, needsRoomBooking: boolean): boolean {
  return accommodationId == null || !needsRoomBooking;
}
