import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeReceiptAmount, MAX_RECEIPT_AMOUNT } from "./receipt-amount";

test("a plain positive number passes through", () => {
  assert.equal(sanitizeReceiptAmount(120), 120);
});

test("rounds to satang", () => {
  assert.equal(sanitizeReceiptAmount(1234.567), 1234.57);
});

test("a numeric string is accepted", () => {
  // The schema asks for a number; this is the belt to that braces.
  assert.equal(sanitizeReceiptAmount("89.50"), 89.5);
});

test("zero fills nothing — a blank field is more honest than a wrong 0", () => {
  assert.equal(sanitizeReceiptAmount(0), null);
});

test("a negative amount fills nothing", () => {
  assert.equal(sanitizeReceiptAmount(-50), null);
});

test("NaN and Infinity fill nothing", () => {
  assert.equal(sanitizeReceiptAmount(NaN), null);
  assert.equal(sanitizeReceiptAmount(Infinity), null);
  assert.equal(sanitizeReceiptAmount(-Infinity), null);
});

test("a missing answer fills nothing", () => {
  assert.equal(sanitizeReceiptAmount(null), null);
  assert.equal(sanitizeReceiptAmount(undefined), null);
});

test("text that is not a number fills nothing", () => {
  assert.equal(sanitizeReceiptAmount("ไม่พบยอด"), null);
  assert.equal(sanitizeReceiptAmount(""), null);
  assert.equal(sanitizeReceiptAmount("   "), null);
});

test("an object or array fills nothing", () => {
  assert.equal(sanitizeReceiptAmount({ amount: 120 }), null);
  assert.equal(sanitizeReceiptAmount([120]), null);
});

test("an implausible amount fills nothing — a misread tax id looks like this", () => {
  assert.equal(sanitizeReceiptAmount(MAX_RECEIPT_AMOUNT + 1), null);
  assert.equal(sanitizeReceiptAmount(105558123456), null);
});

test("an amount exactly at the ceiling is still accepted", () => {
  assert.equal(sanitizeReceiptAmount(MAX_RECEIPT_AMOUNT), MAX_RECEIPT_AMOUNT);
});
