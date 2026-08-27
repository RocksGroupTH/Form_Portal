import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeBookingAmount,
  suggestedTotal,
  totalMismatch,
  MAX_BOOKING_AMOUNT,
} from "./booking-amounts";

test("a plain figure survives", () => {
  assert.equal(sanitizeBookingAmount(1234.5), 1234.5);
  assert.equal(sanitizeBookingAmount("1234.50"), 1234.5);
});

/** Zero is a real answer here, unlike AP-1's receipt total: a booking can carry no VAT and no discount. */
test("zero is kept, because no VAT and no discount are real answers", () => {
  assert.equal(sanitizeBookingAmount(0), 0);
  assert.equal(sanitizeBookingAmount("0"), 0);
});

test("nothing at all reads as absent, not as zero", () => {
  assert.equal(sanitizeBookingAmount(null), null);
  assert.equal(sanitizeBookingAmount(undefined), null);
  assert.equal(sanitizeBookingAmount(""), null);
  assert.equal(sanitizeBookingAmount("   "), null);
});

test("a negative is refused — a discount is entered as its own positive figure", () => {
  assert.equal(sanitizeBookingAmount(-1), null);
  assert.equal(sanitizeBookingAmount("-250.00"), null);
});

test("non-finite and non-numeric are refused", () => {
  assert.equal(sanitizeBookingAmount(Number.NaN), null);
  assert.equal(sanitizeBookingAmount(Number.POSITIVE_INFINITY), null);
  assert.equal(sanitizeBookingAmount("AGD-123456"), null);
});

/** A 13-digit tax id is the number most likely to come back wrong from a Thai invoice. */
test("anything above the cap is refused rather than guessed at", () => {
  assert.equal(sanitizeBookingAmount(MAX_BOOKING_AMOUNT), MAX_BOOKING_AMOUNT);
  assert.equal(sanitizeBookingAmount(MAX_BOOKING_AMOUNT + 1), null);
  assert.equal(sanitizeBookingAmount(1234567890123), null);
});

test("more than two decimals round to satang", () => {
  assert.equal(sanitizeBookingAmount(100.456), 100.46);
  assert.equal(sanitizeBookingAmount(100.454), 100.45);
});

test("the suggested total is before + VAT - discount", () => {
  assert.equal(suggestedTotal(1000, 70, 0), 1070);
  assert.equal(suggestedTotal(1000, 70, 100), 970);
});

test("the suggestion treats an unfilled VAT or discount as nothing to add", () => {
  assert.equal(suggestedTotal(1000, null, null), 1000);
  assert.equal(suggestedTotal(1000, 70, null), 1070);
});

/** Without a base price there is nothing to suggest from — a lone VAT is not a total. */
test("no base price means no suggestion", () => {
  assert.equal(suggestedTotal(null, 70, 0), null);
});

test("a total matching the arithmetic is not a mismatch", () => {
  assert.equal(totalMismatch(1000, 70, 0, 1070), false);
});

/**
 * One satang of rounding is not a discrepancy worth interrupting somebody over;
 * the tolerance exists so the warning means something when it does appear.
 */
test("a satang of rounding is tolerated", () => {
  assert.equal(totalMismatch(1000, 70, 0, 1070.01), false);
  assert.equal(totalMismatch(1000, 70, 0, 1069.99), false);
});

test("a real discrepancy is reported", () => {
  assert.equal(totalMismatch(1000, 70, 0, 1200), true);
});

/** Half-filled is somebody mid-entry, not a contradiction to warn about. */
test("an incomplete row is never a mismatch", () => {
  assert.equal(totalMismatch(null, 70, 0, 1070), false);
  assert.equal(totalMismatch(1000, 70, 0, null), false);
});
