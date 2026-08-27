import { test } from "node:test";
import assert from "node:assert/strict";
import { bookingRowDirty, type BookingRowFields } from "./booking-dirty";
import type { SavedBookingEntry } from "./booking-lock";

const SAVED: SavedBookingEntry = {
  bookingNo: "AGD-123456",
  priceExVat: 5183.68,
  vatAmount: 917.22,
  discountAmount: 0,
  totalAmount: 6100.9,
};

const MATCHING: BookingRowFields = {
  bookingNo: "AGD-123456",
  priceExVat: "5183.68",
  vat: "917.22",
  discount: "0",
  totalAmount: "6100.90",
};

const dirty = (o: Partial<Parameters<typeof bookingRowDirty>[0]> = {}) =>
  bookingRowDirty({ saved: SAVED, current: MATCHING, pendingFileCount: 0, ...o });

test("fields matching what was saved are not dirty", () => {
  assert.equal(dirty(), false);
});

/** "6100.90" and 6100.9 are the same figure — comparing the strings would call every row dirty. */
test("the comparison is on the figure, not on how it was typed", () => {
  assert.equal(dirty({ current: { ...MATCHING, totalAmount: "6100.9" } }), false);
  assert.equal(dirty({ current: { ...MATCHING, priceExVat: " 5183.68 " } }), false);
});

test("any changed figure is dirty", () => {
  assert.equal(dirty({ current: { ...MATCHING, priceExVat: "5183.69" } }), true);
  assert.equal(dirty({ current: { ...MATCHING, vat: "900" } }), true);
  assert.equal(dirty({ current: { ...MATCHING, discount: "50" } }), true);
  assert.equal(dirty({ current: { ...MATCHING, totalAmount: "5368.84" } }), true);
});

test("a changed booking number is dirty, and surrounding space is not a change", () => {
  assert.equal(dirty({ current: { ...MATCHING, bookingNo: "AGD-999999" } }), true);
  assert.equal(dirty({ current: { ...MATCHING, bookingNo: "  AGD-123456  " } }), false);
});

/** Zero is a figure somebody recorded; clearing it to blank is a real change. */
test("clearing a saved zero is dirty", () => {
  assert.equal(dirty({ current: { ...MATCHING, discount: "" } }), true);
});

test("filling a field that was saved blank is dirty", () => {
  assert.equal(
    bookingRowDirty({
      saved: { ...SAVED, vatAmount: null },
      current: MATCHING,
      pendingFileCount: 0,
    }),
    true,
  );
});

/** A file only on this page is unsaved work, whatever the figures say. */
test("a held file makes the row dirty on its own", () => {
  assert.equal(dirty({ pendingFileCount: 1 }), true);
});

test("a new row with anything typed into it is dirty", () => {
  assert.equal(
    bookingRowDirty({ saved: null, current: { ...MATCHING }, pendingFileCount: 0 }),
    true,
  );
});

/** An empty slot nobody has touched must not block the whole booking from completing. */
test("an untouched new row is not dirty", () => {
  assert.equal(
    bookingRowDirty({
      saved: null,
      current: { bookingNo: "", priceExVat: "", vat: "", discount: "", totalAmount: "" },
      pendingFileCount: 0,
    }),
    false,
  );
});

/**
 * A figure the sanitizer refuses — negative, or past the ceiling — is not equal to
 * what was saved, so it counts as an edit. Reporting it clean would let a row be
 * completed while showing a number it never stored.
 */
test("a refused figure still counts as an edit", () => {
  assert.equal(dirty({ current: { ...MATCHING, priceExVat: "-5" } }), true);
  assert.equal(dirty({ current: { ...MATCHING, priceExVat: "abc" } }), true);
});
