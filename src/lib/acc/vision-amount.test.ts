import { test } from "node:test";
import assert from "node:assert/strict";
import { admitReadAmount } from "./vision-amount";
import { sanitizeReceiptAmount, MAX_RECEIPT_AMOUNT } from "@/features/accounting/lib/receipt-amount";
import { sanitizeBookingAmount, MAX_BOOKING_AMOUNT } from "@/features/travel-booking/lib/booking-amounts";

/**
 * The whole point: the ceiling is measured against the BAHT equivalent, and the
 * FOREIGN figure is what comes back. A rate above 1 makes the raw figure look
 * innocently small; a rate below 1 makes it look like a tax id.
 */
test("the gate measures the baht equivalent, not the raw figure", () => {
  // 200,000 MYR is about 1.65M baht — over AP-1's ceiling, though the raw
  // number is well under it.
  assert.equal(admitReadAmount(200_000, 8.25, sanitizeReceiptAmount), null);
  // 100,000 KRW is about 2,500 baht — comfortably legitimate, though the raw
  // number is far above the baht ceiling and would be nulled by it.
  assert.equal(admitReadAmount(100_000, 0.025, sanitizeReceiptAmount), 100_000);
});

test("what comes back is the foreign figure, never the conversion", () => {
  assert.equal(admitReadAmount(12.34, 8.25, sanitizeReceiptAmount), 12.34);
});

/** A rate at exactly the ceiling passes; one satang over does not. */
test("the boundary is the baht ceiling", () => {
  assert.equal(admitReadAmount(MAX_RECEIPT_AMOUNT, 1, sanitizeReceiptAmount), MAX_RECEIPT_AMOUNT);
  assert.equal(admitReadAmount(MAX_RECEIPT_AMOUNT + 1, 1, sanitizeReceiptAmount), null);
  assert.equal(admitReadAmount(MAX_BOOKING_AMOUNT, 1, sanitizeBookingAmount), MAX_BOOKING_AMOUNT);
  assert.equal(admitReadAmount(MAX_BOOKING_AMOUNT + 1, 1, sanitizeBookingAmount), null);
});

/**
 * No rate is a refusal, not a pass-through. Returning the figure here would put
 * an unbounded, unconvertible number into a money field — the one failure this
 * feature exists to prevent.
 */
test("a missing or unusable rate returns null", () => {
  assert.equal(admitReadAmount(100, null, sanitizeReceiptAmount), null);
  assert.equal(admitReadAmount(100, 0, sanitizeReceiptAmount), null);
  assert.equal(admitReadAmount(100, -1, sanitizeReceiptAmount), null);
  assert.equal(admitReadAmount(100, Number.NaN, sanitizeReceiptAmount), null);
});

/** Each sanitiser keeps its own rule about zero — that is why it is passed in. */
test("the two gates still disagree about zero", () => {
  assert.equal(admitReadAmount(0, 8.25, sanitizeReceiptAmount), null);
  assert.equal(admitReadAmount(0, 8.25, sanitizeBookingAmount), 0);
});

test("a negative is refused by both", () => {
  assert.equal(admitReadAmount(-1, 8.25, sanitizeReceiptAmount), null);
  assert.equal(admitReadAmount(-1, 8.25, sanitizeBookingAmount), null);
});

test("junk is refused before any conversion is attempted", () => {
  assert.equal(admitReadAmount(null, 8.25, sanitizeReceiptAmount), null);
  assert.equal(admitReadAmount(undefined, 8.25, sanitizeReceiptAmount), null);
  assert.equal(admitReadAmount("", 8.25, sanitizeReceiptAmount), null);
  assert.equal(admitReadAmount("   ", 8.25, sanitizeReceiptAmount), null);
  assert.equal(admitReadAmount("abc", 8.25, sanitizeReceiptAmount), null);
  assert.equal(admitReadAmount(Number.POSITIVE_INFINITY, 8.25, sanitizeReceiptAmount), null);
});

test("a numeric string is accepted, and rounded to satang", () => {
  assert.equal(admitReadAmount("120.456", 8.25, sanitizeReceiptAmount), 120.46);
});
