import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeBookingNo, MAX_BOOKING_NO_LENGTH } from "./booking-no";

test("a plain reference survives untouched", () => {
  assert.equal(sanitizeBookingNo("AGD-123456"), "AGD-123456");
});

test("surrounding whitespace is trimmed", () => {
  assert.equal(sanitizeBookingNo("  AGD-123456\n"), "AGD-123456");
});

/** Interior spaces are part of some suppliers' references — collapsed, never stripped. */
test("interior whitespace is collapsed to single spaces, not removed", () => {
  assert.equal(sanitizeBookingNo("AGD 123  456"), "AGD 123 456");
  assert.equal(sanitizeBookingNo("AGD\n123\t456"), "AGD 123 456");
});

test("blank and whitespace-only become null", () => {
  assert.equal(sanitizeBookingNo(""), null);
  assert.equal(sanitizeBookingNo("   \n\t "), null);
});

test("a non-string is null rather than coerced", () => {
  assert.equal(sanitizeBookingNo(null), null);
  assert.equal(sanitizeBookingNo(undefined), null);
  assert.equal(sanitizeBookingNo(123456), null);
  assert.equal(sanitizeBookingNo({ bookingNo: "AGD-1" }), null);
});

/** The column is NVARCHAR(100) and the driver truncates silently, so the boundary matters. */
test("exactly the column's length is kept", () => {
  const at = "A".repeat(MAX_BOOKING_NO_LENGTH);
  assert.equal(sanitizeBookingNo(at), at);
});

test("one character over is refused outright, never truncated", () => {
  const over = "A".repeat(MAX_BOOKING_NO_LENGTH + 1);
  assert.equal(sanitizeBookingNo(over), null);
});

/** Collapsing runs first, so a long string of newlines is measured after it shrinks. */
test("length is measured after whitespace collapses", () => {
  const spaced = `AGD-1${"\n".repeat(200)}234`;
  assert.equal(sanitizeBookingNo(spaced), "AGD-1 234");
});
