import {
  continuationFlags,
  continuationPredecessors,
  type ChainTrip,
} from "@/lib/acc/travel-booking/continuation-chain";
import { roomBookedOrShared } from "@/lib/acc/travel-booking/perdiem-room";

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
  /**
   * The running number to show the requester when this trip is the one whose
   * day was already counted. Nullable because the column is — in practice an
   * other trip always has one, since `listTravelBookingDateRanges` excludes
   * Drafts and a number is allocated at submit.
   */
  requestNo: string | null;
  departDate: string;
  returnDate: string;
  sortOrder: number;
}

/**
 * Where a tab's dropped first day went, for the note on the form.
 *
 * `sibling` and `request` are deliberately separate rather than one nullable
 * number: a tab in this same group has an `AccRequest.Id` once saved but **no
 * running number until submit**, so "name the request" is not a thing the form
 * can do for it, and rendering an empty number would read as a bug.
 */
export type ContinuationSource =
  | { kind: "none" }
  | { kind: "sibling" }
  | { kind: "request"; requestNo: string | null };

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
 * estimate's MONEY. This predicate itself governs money only, and still does
 * — but its CALLER's day count does not always stay untouched, which the
 * sentence here used to claim outright.
 *
 * **Corrected (fix round 2, 2026-09-22, N5): "keeps `computePerDiem`'s `days`
 * and only zeroes `total`/`groups`" is true for exactly ONE of this
 * predicate's two `true` states and false for the other.** Since I3
 * (2026-09-22), `useTravelBookingForm.ts` passes `{ roomBooked:
 * tab.needsRoomBooking }` to `computePerDiem` once an accommodation is
 * CHOSEN — so in the "chosen, books no room" state, `computePerDiem` itself
 * returns `{ days: 0, total: 0 }` before this predicate's answer is even
 * consulted for shaping; there is no day count left to "keep". Only in the
 * "no accommodation chosen yet" state does `roomBooked` stay withheld, `days`
 * stay the real span, and THIS predicate's `true` answer do the zeroing —
 * the same shaping already used for an unresolved foreign rate
 * (`attribution.kind === "pending"`). See `useTravelBookingForm.ts`'s own
 * estimate block for the exact split.
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
 *
 * ## Package E (2026-09-22): a room-share guest is never withheld from
 *
 * **Everything above still describes the non-guest case exactly; the guest
 * case is a second way the room question gets settled.** A พักห้องเดียวกับ guest
 * books no room of their own, sleeps in the host's, and IS paid — spec §1,
 * the user's own *"(ถ้าเลือกอันนี้จะได้เบี้ยเลี้ยง)"*. So for a guest the
 * room question is not unresolved and not settled-to-zero; it is settled to
 * **paid**, by the attachment rather than by an accommodation option, and
 * withholding the money would put ฿0 on the screen of somebody the submit is
 * about to store real money for. That is the defect
 * `useTravelBookingForm.ts`'s own estimate block has already shipped once
 * with the sign the other way round.
 *
 * Algebraically the new predicate is `!isRoomShareGuest && <the old one>`, so
 * the two `true` states described above are unchanged and each simply also
 * requires not being a guest. `roomBookedOrShared` is asked rather than
 * re-expressed — it is the same single predicate the submit and the recompute
 * apply, which is the whole point of it existing.
 *
 * **The parameter became an object in the same change.** A third argument
 * here would have sat beside `needsRoomBooking` as a second adjacent
 * `boolean`, and `f(7, false, true)` / `f(7, true, false)` both compile while
 * meaning opposite things about somebody's money. Named fields cannot be
 * transposed; the `listGlAccounts` note in CLAUDE.md is this repository's own
 * record of that going wrong positionally.
 */
export function moneyWithheldForRoom(tab: {
  accommodationId: number | null;
  needsRoomBooking: boolean;
  isRoomShareGuest: boolean;
}): boolean {
  // Two questions, kept apart. **Is the room state decided yet?** — choosing
  // an accommodation decides it, and so does attaching to a host, which is
  // what a guest does INSTEAD of choosing one, so `accommodationId` stays
  // null for them and the old `accommodationId == null` test alone would read
  // a settled guest as undecided. **And if it is decided, is the trip paid?**
  // — that one is `roomBookedOrShared`'s and is not re-expressed here.
  const roomStateSettled = tab.accommodationId != null || tab.isRoomShareGuest;
  return !roomStateSettled || !roomBookedOrShared(tab);
}

/**
 * Which trip already counted each tab's first day, one answer per tab in tab
 * order.
 *
 * The form used to say only "ต่อเนื่องจากคำขอก่อนหน้า", which states that a day
 * was deducted and gives the requester nothing to check it against — the same
 * defect the detail page had until 2026-09-22, fixed there and not here.
 *
 * **It reads `continuationPredecessors`, the identity half of the very walk
 * `continuationFlags` is a wrapper over**, so the trip named here is by
 * construction the trip whose presence dropped the day. A second hand-written
 * walk could name a different one, which is the whole reason that export
 * exists.
 */
export function estimateContinuationSources(
  tabs: readonly EstimateTab[],
  otherTrips: readonly EstimateOtherTrip[],
): ContinuationSource[] {
  const chain = buildEstimateChainTrips(tabs, otherTrips);
  const predecessors = continuationPredecessors(chain);
  // **Both halves, and neither re-derived here.** `continuationPredecessors`
  // answers the nearest live predecessor whether or not it touches;
  // `continuationFlags` is what adds `previous.returnDate === departDate`. So
  // the identity comes from one and the "is this actually a continuation"
  // from the other, rather than this module retyping the touch test — which
  // is how it would become the fourth independent answer the whole module
  // exists to avoid. Caught by the agreement test, which asserted a source is
  // reported exactly when the flag is true and failed when it was not.
  const flags = continuationFlags(chain);

  // Own tabs are the first `tabs.length` entries of the chain, in order, so
  // their keys are read back from it rather than re-deriving `id ?? -(i + 1)`
  // here — two copies of that rule could drift apart.
  const ownKeys: Record<number, true> = {};
  for (let i = 0; i < tabs.length; i++) ownKeys[chain[i].requestId] = true;

  const numberByRequestId: Record<number, string | null> = {};
  for (const other of otherTrips) numberByRequestId[other.requestId] = other.requestNo;

  return tabs.map((_t, i) => {
    if (flags.get(chain[i].requestId) !== true) return { kind: "none" };
    const previous = predecessors.get(chain[i].requestId) ?? null;
    if (!previous) return { kind: "none" };
    if (ownKeys[previous.requestId]) return { kind: "sibling" };
    return { kind: "request", requestNo: numberByRequestId[previous.requestId] ?? null };
  });
}
