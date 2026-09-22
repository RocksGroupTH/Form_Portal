/**
 * What picking — or clearing — a พักห้องเดียวกับ host does to the tab, and what
 * the save then posts about it (AP-17 package E, reworked 2026-09-22).
 *
 * ## One place, because two fields now hold one fact
 *
 * `TabFormState` carries **`roomShareHostRequestId`**, the choice the save
 * persists, and **`isRoomShareGuest`**, which the per-diem estimate and both
 * validators already read. They must move together: a tab claiming to be a
 * guest with no host posts a binding it cannot name, and a tab holding a host
 * while `isRoomShareGuest` is false shows the ที่พักค้างคืน grid *and* a host
 * card at once — the state `room-share-control-guard.test.ts` exists to
 * prevent. "A flag plus a value can hold two contradictory states that then
 * have to be defended against on every read" is this repository's own words
 * about `ExpiresAt`; the answer there and here is to write them in one place.
 *
 * Pure and import-free so it is unit-tested without a database — the form's
 * components and hook all reach `@/env` transitively and none of them can be
 * imported into a `node:test` run.
 *
 * ## The dates come with the host, and that closes a filed defect
 *
 * Package E's final review filed it as **I4**: the picker matches hosts on
 * date **overlap**, so a 20–22 trip can attach to an 18–25 host — and the
 * first time the host's dates move, `cascadeForHostDates` replaces the
 * guest's whole span, silently changing their day count and the money on it.
 * Writing the host's dates into the tab at the moment of the pick makes the
 * two agree from the start, so the first cascade is a no-op instead of a
 * surprise. It is the reason for this behaviour, not a side effect of it.
 *
 * **Only when the host has both.** A host with a half-filled range would
 * otherwise blank a date the requester had already chosen, which is worse
 * than leaving them to disagree.
 *
 * ## What clearing does NOT do
 *
 * It does not restore the accommodation, and it does not restore the dates.
 * The requester is put back at an unanswered required field, which is the
 * honest state — resurrecting the choice the attach replaced would re-book a
 * room they had decided against, and `room-share-guest-room.ts` makes that
 * true of the stored row as well as of the screen. The dates follow the same
 * rule for the weaker reason that there is nothing to restore them *to*: the
 * value they replaced is not kept anywhere.
 */

/** The host fields a pick reads. A structural subset of `HostCandidateRow`, deliberately not an import of it. */
export interface RoomShareHostChoice {
  requestId: number;
  departDate: string | null;
  returnDate: string | null;
}

/**
 * The tab patch for choosing `host`.
 *
 * `departDate`/`returnDate` are **absent** rather than `undefined` when the
 * host has no range: `updateTab` spreads the patch over the tab, and
 * `{ ...tab, departDate: undefined }` overwrites a real date with `undefined`,
 * which is not the same thing as leaving it alone.
 */
export function roomShareChoicePatch(host: RoomShareHostChoice): {
  isRoomShareGuest: true;
  roomShareHostRequestId: number;
  accommodationId: null;
  accommodationCustomText: null;
  needsRoomBooking: false;
  departDate?: string;
  returnDate?: string;
} {
  const patch: {
    isRoomShareGuest: true;
    roomShareHostRequestId: number;
    accommodationId: null;
    accommodationCustomText: null;
    needsRoomBooking: false;
    departDate?: string;
    returnDate?: string;
  } = {
    isRoomShareGuest: true,
    roomShareHostRequestId: host.requestId,
    // A guest books nothing themselves (spec §1), so the choice the grid had
    // made is withdrawn in the same patch that records the share — the grid is
    // hidden from here on, so a value left behind is one the requester can
    // neither see nor change while `deriveBookingFlags` still reads it.
    accommodationId: null,
    accommodationCustomText: null,
    needsRoomBooking: false,
  };
  if (host.departDate && host.returnDate) {
    patch.departDate = host.departDate;
    patch.returnDate = host.returnDate;
  }
  return patch;
}

/** The tab patch for clearing the choice. Only the two fields that hold it. */
export function roomShareClearPatch(): {
  isRoomShareGuest: false;
  roomShareHostRequestId: null;
} {
  return { isRoomShareGuest: false, roomShareHostRequestId: null };
}

/**
 * What the save should post for this tab's binding — and the one case where
 * the answer is "say nothing".
 *
 * - a host chosen → that id, **set it**;
 * - no host and not a guest → `null`, **clear it**;
 * - `isRoomShareGuest` with no host id → **`undefined`, leave the stored row
 *   alone.**
 *
 * That third case is the one worth having a function for. It is what a tab
 * resumed from a read that carries `isRoomShareGuest` but not
 * `roomShareHostRequestId` looks like — `listMyTravelBookings` is exactly such
 * a read, and `mapTravelBookingRow`'s own comment says the list reads "do not
 * pay for the subquery". The form resumes through `getTravelBookingGroup` →
 * `getTravelBookingRequest`, which does fill both, so this is not reachable
 * today; if it ever becomes reachable, posting `null` would **delete a binding
 * the requester never touched**, on an ordinary save, with nothing on screen
 * to say so. Absent is the fail-safe direction, and it is the same
 * absent-versus-`null` distinction the API-key PATCH draws for `expiresAt`.
 */
export function roomShareHostFieldFor(tab: {
  isRoomShareGuest: boolean;
  roomShareHostRequestId: number | null;
}): number | null | undefined {
  if (tab.roomShareHostRequestId != null) return tab.roomShareHostRequestId;
  return tab.isRoomShareGuest ? undefined : null;
}
