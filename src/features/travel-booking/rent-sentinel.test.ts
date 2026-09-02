import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_RENT_VEHICLE_NAME, rentBookingContradictsNoRent } from "./constants";

/**
 * The "ไม่เช่า" row is the one option whose meaning is the absence of a booking.
 * Since a selected rent option decides `NeedsRentBooking` outright
 * (`derive-flags.ts`, 2026-09-02), ticking the box on it reproduces the bug that
 * change fixed — so the settings service refuses the combination.
 */
test("the no-rental row may not claim to need a booking", () => {
  assert.equal(rentBookingContradictsNoRent(NO_RENT_VEHICLE_NAME, true), true);
  assert.equal(rentBookingContradictsNoRent("ไม่เช่า", true), true);
  // The editor does not trim, and a stored "ไม่เช่า " is the same row to a reader.
  assert.equal(rentBookingContradictsNoRent("  ไม่เช่า  ", true), true);
});

test("the same row with the box unticked is the normal, correct state", () => {
  assert.equal(rentBookingContradictsNoRent(NO_RENT_VEHICLE_NAME, false), false);
});

test("every other option may need a booking, which is the point of them", () => {
  assert.equal(rentBookingContradictsNoRent("รถยนต์", true), false);
  assert.equal(rentBookingContradictsNoRent("รถตู้พร้อมคนขับ", true), false);
  assert.equal(rentBookingContradictsNoRent(null, true), false);
  assert.equal(rentBookingContradictsNoRent("", true), false);
});
