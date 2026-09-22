/**
 * "A guest books nothing themselves" — enforced in the database, AP-17
 * package E, spec §1.
 *
 * ## Why this is its own module rather than three lines inside `attachRoomShare`
 *
 * Two reasons, and the second is the one that matters.
 *
 * `room-share-service.ts` answers a colleague's running number, dates and
 * work location and **nothing else**, and
 * `room-share-response-shape-guard.test.ts` enforces that by, among three
 * other pins, banning a list of column names from that file outright —
 * `Accommodation` among them. That ban is about what the picker may *read*
 * from somebody else's request. This is a **write to the guest's own row**,
 * which is a different question, and a file-wide `indexOf` cannot tell the
 * two apart. Rather than weaken a guard that is otherwise exactly right, the
 * write lives here.
 *
 * And it deserves a name. Until 2026-09-22 the invariant existed **only as a
 * React state patch**: `TravelBookingTab.tsx`'s `onAttached` cleared
 * `accommodationId` / `needsRoomBooking` in local state while
 * `attachRoomShare` had already committed the binding server-side and touched
 * `AccTravelBooking` not at all. Reload between the attach and the next save
 * and the cleared values came straight back from the server — into a grid
 * that `isRoomShareGuest` now hides, so the requester could neither see nor
 * change them. `buildSaveInput` then posted the stale `accommodationId`,
 * `deriveBookingFlags` read it as a live answer, `NeedsRoomBooking` went back
 * to `1`, and `approveByManager` routed the request to **`ADMIN`**, where the
 * desk books a real hotel room for somebody who is sharing one.
 * `validateTravelBookingTab` does not catch it: with `accommodationId` set it
 * takes the `else if` arm and only checks `requiresCustomReason`.
 *
 * **A client-enforced invariant is not one** — this repository says so in a
 * dozen places, and "a control removed from a page is not a rule" is the same
 * sentence. The patch in `TravelBookingTab.tsx` stays: it keeps the screen
 * honest between the attach and the reload that would otherwise be needed,
 * and it is now a mirror of the database rather than the only copy of it.
 *
 * ## What is cleared, and what is deliberately not
 *
 * All four columns `deriveBookingFlags` and `validateTravelBookingTab` read
 * to decide whether a room is wanted: `AccommodationId`, `AccommodationName`,
 * `AccommodationCustomText` and `NeedsRoomBooking`. Clearing the id alone
 * would leave a name on screen for a choice that no longer exists, and
 * clearing the name alone would leave the desk a booking to make.
 *
 * **Nothing is restored on detach**, here or anywhere: the requester is put
 * back at an unanswered required field, which is the honest state and the one
 * `TravelBookingTab.tsx`'s `onDetached` comment already describes.
 * Resurrecting the accommodation they replaced would re-book a room they had
 * decided against — and since this module makes the clear real, that comment
 * is now true of the persisted row as well as of the screen.
 */

import { getAccPool, sql } from "@/lib/acc/pool";

type AccPool = Awaited<ReturnType<typeof getAccPool>>;
/** A pool or the caller's open transaction — the same structural type the rest of package E uses. */
type SqlRunner = { request: () => ReturnType<AccPool["request"]> };

/**
 * Drop the guest's own accommodation, on `runner`.
 *
 * **Called inside `attachRoomShare`'s transaction**, so the binding and the
 * withdrawal of the room it replaces commit or roll back together. That is
 * not decoration: a commit that recorded the share while leaving the
 * accommodation live is exactly the half-state described above, and it is
 * reachable in one statement rather than through a race.
 *
 * No state predicate of its own, and it needs none: every caller has already
 * passed `requireEditableGuest`, which takes `UPDLOCK, HOLDLOCK` on this
 * request's `AccRequest` row a few statements earlier and holds it to commit.
 *
 * A guest with no `AccTravelBooking` row updates nothing and that is correct
 * rather than silent — such a request cannot be a guest at all, since
 * `IS_ROOM_SHARE_GUEST_COLUMN` and every per-diem read join through that very
 * row.
 */
export async function clearGuestOwnAccommodation(
  runner: SqlRunner,
  guestRequestId: number,
): Promise<void> {
  await runner
    .request()
    .input("gid", sql.Int, guestRequestId)
    .query(`UPDATE [dbo].[AccTravelBooking]
               SET AccommodationId = NULL,
                   AccommodationName = NULL,
                   AccommodationCustomText = NULL,
                   NeedsRoomBooking = 0,
                   UpdatedAt = SYSDATETIME()
             WHERE RequestId = @gid`);
}
