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
const hotel: AccommodationOption = { id: 1, isActive: true, needsRoomBooking: true };
/** Staying with family: nothing to book. */
const ownArrangement: AccommodationOption = { id: 2, isActive: true, needsRoomBooking: false };

/** A flight: ticket to book, departure locations and a time to record. */
const flight: VehicleFlagOption = {
  id: 10,
  isActive: true,
  needsDepartureLocations: true,
  needsTicketBooking: true,
  needsDepartTime: true,
  needsVehicleRent: false,
};
/** Own car: nothing for anyone else to do. */
const ownCar: VehicleFlagOption = {
  id: 11,
  isActive: true,
  needsDepartureLocations: false,
  needsTicketBooking: false,
  needsDepartTime: false,
  needsVehicleRent: false,
};
/** A hired vehicle chosen as the travel method. */
const hiredVehicle: VehicleFlagOption = {
  id: 12,
  isActive: true,
  needsDepartureLocations: false,
  needsTicketBooking: false,
  needsDepartTime: false,
  needsVehicleRent: true,
};

const rentVan: RentVehicleOption = { id: 20, isActive: true, needsRentBooking: true };

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
