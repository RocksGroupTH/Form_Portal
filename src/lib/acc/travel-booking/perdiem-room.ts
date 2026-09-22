/**
 * Does this AP-17 trip earn per diem on the strength of a room? — the ONE
 * decision, and the SQL that produces its second input.
 *
 * Package B's rule (user, 2026-09-21) is **no accommodation booking, no per
 * diem**: `computePerDiem` answers `{ days: 0, total: 0, groups: [] }` for
 * `roomBooked: false`, so a three-night trip staying with relatives pays
 * nothing.
 *
 * Package E's พักห้องเดียวกับ is its one exception, and it is the user's own —
 * *"(ถ้าเลือกอันนี้จะได้เบี้ยเลี้ยง)"* (spec §1). A room-share **guest** books
 * nothing themselves, sleeps in the **host's** room, and **must still be
 * paid**. So a guest's `roomBooked` argument is `true` even though their own
 * `needsRoomBooking` is `false`.
 *
 * ## Why this is a module and not three `needsRoomBooking || isGuest`s
 *
 * CLAUDE.md records that **four things compute an AP-17 per-diem figure
 * independently** — the live estimate on the form, the write at submit, the
 * recompute after a cancellation, and the rate the report prints — and that
 * the way they are kept from disagreeing is that each resolves through one
 * shared decision rather than re-expressing it. `perDiemLogFor`
 * (`perdiem-country.ts`) is that module for *which rate log applies*; this one
 * is it for *whether the trip is paid at all*.
 *
 * Three of the four consume it. The report is the exception and deliberately
 * so: it prints the stored `PerDiemDays` / `PerDiemTotal` columns and derives
 * only the RATE from the log (`computeReportPerDiemDisplay`,
 * `report-service.ts`), so it never re-answers the room question and cannot
 * disagree with the three that do.
 *
 * `perdiem-room-guard.test.ts` is what keeps that true: the failure to catch
 * is a **missing call** — a fourth pricing consumer arriving with the
 * disjunction typed out inline — and no behavioural test of the three would
 * see it.
 *
 * **This module imports nothing.** That is what lets `useTravelBookingForm.ts`
 * — a `"use client"` file — import it without dragging `@/lib/db/mssql` →
 * `@/env` into the browser bundle, the build break `perdiem-source-guard.ts`
 * records and that no type error predicts. Keep it that way.
 */

/**
 * The two facts that decide it, as an object rather than two positional
 * booleans.
 *
 * Two adjacent `boolean` parameters are swappable with no type error —
 * `f(needsRoom, isGuest)` and `f(isGuest, needsRoom)` both compile and mean
 * opposite things on the path that writes `AccRequest.TotalAmount`. This
 * repository already carries that lesson written down for `listGlAccounts`,
 * where a new positional parameter left every existing call type-checking
 * while passing a branch where a company belonged. Named fields cannot do it.
 */
export interface RoomPerDiemInput {
  /**
   * `AccTravelBooking.NeedsRoomBooking` — derived from the selected
   * accommodation option's own column, never from a posted DTO
   * (`derive-flags.ts`).
   */
  needsRoomBooking: boolean;
  /**
   * True when this request has an `AccTravelRoomShare` row as the **guest** —
   * it is attached to a colleague's booking. Produced server-side by
   * `IS_ROOM_SHARE_GUEST_COLUMN` below; never posted by a client, for the same
   * reason `needsRoomBooking` is not.
   */
  isRoomShareGuest: boolean;
}

/**
 * What to pass as `computePerDiem`'s `roomBooked`.
 *
 * **A guest is paid; a non-guest who booked no room is not.** Those two look
 * like each other's bug, which is why `perdiem.test.ts` asserts them side by
 * side in one test rather than in two that could be read apart — the same
 * pairing `payout-rule.test.ts` uses for the domestic/foreign payout
 * asymmetry.
 *
 * Note what this deliberately does NOT do: it does not reach into
 * `computePerDiem`. That function's own docblock says the exception "lives
 * there, not here" — meaning in the caller's argument — and that stays exactly
 * true: `computePerDiem` still knows only `roomBooked`, and this module is
 * what every caller works the argument out with.
 */
export function roomBookedOrShared(trip: RoomPerDiemInput): boolean {
  return trip.needsRoomBooking || trip.isRoomShareGuest;
}

/**
 * The SELECT-list expression every server-side pricing read uses to fetch
 * `isRoomShareGuest`, so there is **one** of it rather than one per reader.
 *
 * Two files interpolate it today — `request-service.ts` (the submit's own read
 * of the group, and `listMyTravelBookings`) and `perdiem-recompute.ts`
 * (`PERDIEM_ROW_COLUMNS`, shared by both of that file's readers). That file's
 * own doc comment records what it costs when a pricing column is tidied out of
 * one reader and not the other; one shared expression is the answer to the
 * same question asked across two files instead of within one.
 *
 * **It assumes the enclosing query aliases `AccRequest` as `r`.** All four
 * current sites do. Getting that wrong is **loud**, not silent: SQL Server
 * answers `The multi-part identifier "r.Id" could not be bound` at compile
 * time, so the query fails outright rather than quietly reporting every trip
 * as not-a-guest — which is the failure mode that would matter, since it
 * prices a guest at ฿0.
 *
 * `CAST(... AS BIT)` rather than a bare `CASE`: the mappers all read it with
 * `!!`, and a BIT arrives as a JavaScript boolean, so the column reads the
 * same way `NeedsRoomBooking` beside it does.
 *
 * **`EXISTS`, not a JOIN**, deliberately — `UQ_AccTravelRoomShare_Guest`
 * (migration 156) already makes at most one row match, but a JOIN that a later
 * edit points at `HostRequestId` instead would fan the outer row out silently,
 * and `EXISTS` cannot.
 */
export const IS_ROOM_SHARE_GUEST_COLUMN =
  "CAST(CASE WHEN EXISTS (SELECT 1 FROM [dbo].[AccTravelRoomShare] rs " +
  "WHERE rs.GuestRequestId = r.Id) THEN 1 ELSE 0 END AS BIT) AS IsRoomShareGuest";
