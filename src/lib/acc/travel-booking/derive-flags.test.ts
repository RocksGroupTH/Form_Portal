import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NO_BOOKING_FLAGS,
  deriveBookingFlags,
  firstInvalidOption,
  invalidOptionMessage,
  requiresAdminBooking,
  type AccommodationOption,
  type RentVehicleOption,
  type VehicleFlagOption,
} from "./derive-flags";

/* ── Fixtures ── */

/** A hotel: the Admin has to book the room. */
const hotel: AccommodationOption = { id: 1, isActive: true, needsRoomBooking: true, requiresIdCard: false };
/** Staying with family: nothing to book. */
const ownArrangement: AccommodationOption = { id: 2, isActive: true, needsRoomBooking: false, requiresIdCard: false };

/** A flight: ticket to book, departure locations and a time to record. */
const flight: VehicleFlagOption = {
  id: 10,
  isActive: true,
  needsDepartureLocations: true,
  needsTicketBooking: true,
  needsDepartTime: true,
  needsVehicleRent: false,
  requiresIdCard: false,
};
/** Own car: nothing for anyone else to do. */
const ownCar: VehicleFlagOption = {
  id: 11,
  isActive: true,
  needsDepartureLocations: false,
  needsTicketBooking: false,
  needsDepartTime: false,
  needsVehicleRent: false,
  requiresIdCard: false,
};
/** A hired vehicle chosen as the travel method. */
const hiredVehicle: VehicleFlagOption = {
  id: 12,
  isActive: true,
  needsDepartureLocations: false,
  needsTicketBooking: false,
  needsDepartTime: false,
  needsVehicleRent: true,
  requiresIdCard: false,
};

const rentVan: RentVehicleOption = { id: 20, isActive: true, needsRentBooking: true, requiresIdCard: false };

/* ── Derivation ── */

test("nothing selected implies nothing to book", () => {
  const flags = deriveBookingFlags({
    accommodation: null,
    goVehicle: null,
    returnVehicle: null,
    rentVehicle: null,
  });
  assert.deepEqual(flags, NO_BOOKING_FLAGS);
  assert.equal(requiresAdminBooking(flags), false);
});

test("a hotel implies a room booking whatever the client posted", () => {
  // The finding: `needsRoomBooking: false` posted alongside this accommodation
  // used to be persisted verbatim and auto-complete the request.
  const flags = deriveBookingFlags({
    accommodation: hotel,
    goVehicle: null,
    returnVehicle: null,
    rentVehicle: null,
  });
  assert.equal(flags.needsRoomBooking, true);
  assert.equal(requiresAdminBooking(flags), true);
});

test("a flight out and own car back sets only the outbound leg's flags", () => {
  const flags = deriveBookingFlags({
    accommodation: ownArrangement,
    goVehicle: flight,
    returnVehicle: ownCar,
    rentVehicle: null,
  });
  assert.equal(flags.goNeedsTicketBooking, true);
  assert.equal(flags.goNeedsDepartureLocations, true);
  assert.equal(flags.goNeedsDepartTime, true);
  assert.equal(flags.returnNeedsTicketBooking, false);
  assert.equal(flags.returnNeedsDepartureLocations, false);
  assert.equal(requiresAdminBooking(flags), true);
});

test("choosing a hired vehicle for either leg implies a rent booking", () => {
  // Without this, `needsRentBooking` depended on a separate posted boolean that
  // the leg choice never had to agree with.
  const outbound = deriveBookingFlags({
    accommodation: null,
    goVehicle: hiredVehicle,
    returnVehicle: ownCar,
    rentVehicle: null,
  });
  assert.equal(outbound.needsRentBooking, true);

  const inbound = deriveBookingFlags({
    accommodation: null,
    goVehicle: ownCar,
    returnVehicle: hiredVehicle,
    rentVehicle: null,
  });
  assert.equal(inbound.needsRentBooking, true);
});

test("a rent option on its own implies a rent booking", () => {
  const flags = deriveBookingFlags({
    accommodation: null,
    goVehicle: ownCar,
    returnVehicle: ownCar,
    rentVehicle: rentVan,
  });
  assert.equal(flags.needsRentBooking, true);
  assert.equal(requiresAdminBooking(flags), true);
});

test("own car both ways and own accommodation still auto-completes", () => {
  // The legitimate skip-the-Admin-step case has to keep working.
  const flags = deriveBookingFlags({
    accommodation: ownArrangement,
    goVehicle: ownCar,
    returnVehicle: ownCar,
    rentVehicle: null,
  });
  assert.equal(requiresAdminBooking(flags), false);
});

test("departure locations and depart time alone do not need an Admin", () => {
  // They are things the requester records, not things anyone books.
  const flags = deriveBookingFlags({
    accommodation: ownArrangement,
    goVehicle: {
      ...ownCar,
      needsDepartureLocations: true,
      needsDepartTime: true,
    },
    returnVehicle: ownCar,
    rentVehicle: null,
  });
  assert.equal(flags.goNeedsDepartureLocations, true);
  assert.equal(requiresAdminBooking(flags), false);
});

/* ── Option validity ── */

test("a selected id with no row is reported", () => {
  const bad = firstInvalidOption([
    { field: "accommodationId", id: 99, option: null },
    { field: "goVehicleId", id: 10, option: flight },
  ]);
  assert.equal(bad?.field, "accommodationId");
  assert.match(invalidOptionMessage(bad!), /ที่พัก/);
});

test("a selected id whose row has been deactivated is reported", () => {
  const bad = firstInvalidOption([
    { field: "goVehicleId", id: 10, option: { id: 10, isActive: false } },
  ]);
  assert.equal(bad?.field, "goVehicleId");
});

test("an unselected option is not an invalid one", () => {
  assert.equal(
    firstInvalidOption([
      { field: "accommodationId", id: null, option: null },
      { field: "rentVehicleId", id: null, option: null },
    ]),
    null,
  );
});

test("all selections valid reports nothing", () => {
  assert.equal(
    firstInvalidOption([
      { field: "accommodationId", id: 1, option: hotel },
      { field: "goVehicleId", id: 10, option: flight },
    ]),
    null,
  );
});

test("an unknown field name still produces a usable message", () => {
  assert.match(
    invalidOptionMessage({ field: "somethingElse", id: 1, option: null }),
    /ไม่มีอยู่หรือถูกปิดใช้งาน/,
  );
});

/** The "ไม่เช่า" row: a real, active option whose whole meaning is "no rental". */
const noRent: RentVehicleOption = { id: 4, isActive: true, needsRentBooking: false, requiresIdCard: false };

/**
 * **An explicit "ไม่เช่า" beats a leg vehicle that merely implies a rental.**
 *
 * Reported from production-shaped data on 2026-09-02: TRL26-09007 flew both
 * ways (`เครื่องบิน`, `NeedsVehicleRent = 1`) and picked `ไม่เช่า`
 * (`NeedsRentBooking = 0`), and the Admin panel still opened a rental group
 * saying "กำลังรอ Admin กรอกข้อมูลการจอง" for a rental nobody wanted.
 *
 * The two flags mean different things and the OR conflated them.
 * `NeedsVehicleRent` on a leg vehicle is what makes the form **ask** the rent
 * question — `TravelBookingTab.tsx:123`, `showRentBlock` — and `rentVehicleId`
 * is the **answer**. Reading the question as though it were a "yes" left the
 * requester unable to say no.
 */
test("an explicit no-rent option beats a leg vehicle that implies one", () => {
  const flags = deriveBookingFlags({
    accommodation: null,
    goVehicle: hiredVehicle,
    returnVehicle: hiredVehicle,
    rentVehicle: noRent,
  });
  assert.equal(flags.needsRentBooking, false);
  // The leg flags themselves are untouched — they still record what was chosen.
  assert.equal(flags.goNeedsVehicleRent, true);
  assert.equal(flags.returnNeedsVehicleRent, true);
});

/**
 * The safety net stays for the case it was built for: the question was asked and
 * **not answered**. The client validator requires an answer whenever a leg
 * implies a rental (`useTravelBookingForm.ts:332-334`), so this is the path that
 * bypasses it — a direct POST, or a row written before that rule existed.
 */
test("a leg that implies a rental still forces one when nothing was answered", () => {
  const flags = deriveBookingFlags({
    accommodation: null,
    goVehicle: hiredVehicle,
    returnVehicle: ownCar,
    rentVehicle: null,
  });
  assert.equal(flags.needsRentBooking, true);
});

/** And an explicit rental is still a rental, whatever the legs say. */
test("an explicit rent option implies a booking even with own-car legs", () => {
  const flags = deriveBookingFlags({
    accommodation: null,
    goVehicle: ownCar,
    returnVehicle: ownCar,
    rentVehicle: rentVan,
  });
  assert.equal(flags.needsRentBooking, true);
});

/* ── ID card requirement ── */

test("needsIdCard is true when only the accommodation requires one", () => {
  const flags = deriveBookingFlags({
    accommodation: { id: 1, isActive: true, needsRoomBooking: true, requiresIdCard: true },
    goVehicle: null,
    returnVehicle: null,
    rentVehicle: null,
  });
  assert.equal(flags.needsIdCard, true);
});

test("needsIdCard is true when only the go vehicle requires one", () => {
  const flags = deriveBookingFlags({
    accommodation: null,
    goVehicle: { ...flight, requiresIdCard: true },
    returnVehicle: null,
    rentVehicle: null,
  });
  assert.equal(flags.needsIdCard, true);
});

test("needsIdCard is true when only the return vehicle requires one", () => {
  const flags = deriveBookingFlags({
    accommodation: null,
    goVehicle: null,
    returnVehicle: { ...flight, requiresIdCard: true },
    rentVehicle: null,
  });
  assert.equal(flags.needsIdCard, true);
});

test("needsIdCard is true when only the rent vehicle requires one", () => {
  const flags = deriveBookingFlags({
    accommodation: null,
    goVehicle: null,
    returnVehicle: null,
    rentVehicle: { ...rentVan, requiresIdCard: true },
  });
  assert.equal(flags.needsIdCard, true);
});

test("needsIdCard is true when several options require one", () => {
  const flags = deriveBookingFlags({
    accommodation: { ...hotel, requiresIdCard: true },
    goVehicle: { ...flight, requiresIdCard: true },
    returnVehicle: null,
    rentVehicle: { ...rentVan, requiresIdCard: true },
  });
  assert.equal(flags.needsIdCard, true);
});

test("needsIdCard is false when no option requires one — the fresh-database state", () => {
  // The state every database is in the moment migration 154 lands: existing
  // rows default to RequiresIdCard = 0, so nothing asks for a card at all.
  const flags = deriveBookingFlags({
    accommodation: { id: 1, isActive: true, needsRoomBooking: true, requiresIdCard: false },
    goVehicle: null,
    returnVehicle: null,
    rentVehicle: null,
  });
  assert.equal(flags.needsIdCard, false);
});

/**
 * **The discriminating case for `needsIdCard`'s plain OR, and the one the six
 * tests above could not tell apart from its opposite.**
 *
 * Every other `needsIdCard` case passes either `rentVehicle: null` or a rent
 * option that itself requires a card, so all of them pass unchanged if somebody
 * "restores the symmetry" with `needsRentBooking` twelve lines above and
 * rewrites the OR into the answer-wins shape:
 *
 * ```ts
 * options.rentVehicle !== null
 *   ? options.rentVehicle.requiresIdCard
 *   : (accommodation ?? false) || (go ?? false) || (back ?? false)
 * ```
 *
 * Measured by the final review on 2026-09-22: that rewrite left the whole suite
 * at 2088/2088 and `tsc --noEmit` clean. This test is what reds it.
 *
 * The case is the ordinary one, not an exotic one. A leg vehicle with
 * `NeedsVehicleRent = 1` is what makes the form ask the rental question at all,
 * and `ไม่เช่า` — a real row, carrying `RequiresIdCard = 0` like every row does
 * by default — is how a requester declines it. Under the answer-wins shape that
 * decline would cancel the *card* requirement the leg vehicle itself carries,
 * on both client and server, silently: no card asked for, no refusal at submit.
 *
 * The asymmetry is deliberate and this test pins both halves of it at once.
 * `ไม่เช่า` means "no" to a rental because a rental is a thing one can decline;
 * there is no option meaning "and no identification", so nothing can answer the
 * card question in the negative and the OR has nothing to defer to.
 */
test("a selected ไม่เช่า does not cancel another option's card requirement", () => {
  const flags = deriveBookingFlags({
    accommodation: null,
    goVehicle: { ...hiredVehicle, requiresIdCard: true },
    returnVehicle: { ...hiredVehicle, requiresIdCard: true },
    rentVehicle: noRent,
  });
  // The decline still wins the question it answers…
  assert.equal(flags.needsRentBooking, false);
  // …and does not reach the one it does not.
  assert.equal(flags.needsIdCard, true);
});

test("NO_BOOKING_FLAGS carries needsIdCard false", () => {
  assert.equal(NO_BOOKING_FLAGS.needsIdCard, false);
});
