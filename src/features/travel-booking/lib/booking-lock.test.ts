import { test } from "node:test";
import assert from "node:assert/strict";
import { bookingFieldsLocked, type SavedBookingEntry } from "./booking-lock";

const EMPTY: SavedBookingEntry = {
  bookingNo: null, priceExVat: null, vatAmount: null, discountAmount: null, totalAmount: null,
};

test("a brand-new row with no file is locked — attach first", () => {
  assert.equal(bookingFieldsLocked({ saved: null, hasFile: false, reading: false }), true);
});

test("attaching a file unlocks it once the read has landed", () => {
  assert.equal(bookingFieldsLocked({ saved: null, hasFile: true, reading: false }), false);
});

test("the read itself locks, whatever else is true", () => {
  assert.equal(bookingFieldsLocked({ saved: null, hasFile: true, reading: true }), true);
  assert.equal(bookingFieldsLocked({ saved: { ...EMPTY, bookingNo: "AGD-1" }, hasFile: true, reading: true }), true);
});

/**
 * The regression this file exists for. Saving and uploading are independent
 * actions in this panel, so a row saved before the lock shipped can hold a
 * booking number and a price with no file behind it. Locking that row strands
 * data somebody already entered, uneditable, behind a message telling them to
 * attach a file.
 */
test("a row that already holds saved data is never locked, file or no file", () => {
  assert.equal(bookingFieldsLocked({ saved: { ...EMPTY, bookingNo: "AGD-123456" }, hasFile: false, reading: false }), false);
  assert.equal(bookingFieldsLocked({ saved: { ...EMPTY, priceExVat: 412 }, hasFile: false, reading: false }), false);
});

test("any one of the five figures counts as saved data", () => {
  for (const saved of [
    { ...EMPTY, vatAmount: 28.84 },
    { ...EMPTY, discountAmount: 0 },
    { ...EMPTY, totalAmount: 440.84 },
  ]) {
    assert.equal(bookingFieldsLocked({ saved, hasFile: false, reading: false }), false);
  }
});

/** Zero is a figure somebody recorded, not an absence — the same rule sanitizeBookingAmount follows. */
test("a saved zero counts as data", () => {
  assert.equal(bookingFieldsLocked({ saved: { ...EMPTY, priceExVat: 0 }, hasFile: false, reading: false }), false);
});

test("a saved row that is blank in every field is still locked", () => {
  assert.equal(bookingFieldsLocked({ saved: EMPTY, hasFile: false, reading: false }), true);
});

test("whitespace is not a booking number", () => {
  assert.equal(bookingFieldsLocked({ saved: { ...EMPTY, bookingNo: "   " }, hasFile: false, reading: false }), true);
});
