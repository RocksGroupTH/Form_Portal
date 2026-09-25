import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAmountForDisplay, parseAmountInput } from "./amount-input-core";

test("separators never reach the stored value", () => {
  // The whole point: the state stays the plain digits it has always been, so
  // num(), the totals and the ERP payload never learn about commas.
  assert.equal(parseAmountInput("1,000"), "1000");
  assert.equal(parseAmountInput("1,234,567.89"), "1234567.89");
});

test("a value is kept as a string, because typing passes through states a number cannot hold", () => {
  for (const mid of ["", "0", "1.", ".", "0.0"]) {
    assert.equal(parseAmountInput(mid), mid);
  }
});

test("anything that is not a digit or a dot is dropped", () => {
  assert.equal(parseAmountInput("1 000 บาท"), "1000");
  assert.equal(parseAmountInput("฿1,000.50"), "1000.50");
  assert.equal(parseAmountInput("abc"), "");
});

test("a negative is refused, the way min=0 refused it before", () => {
  assert.equal(parseAmountInput("-500"), "500");
});

test("the first dot is kept and the rest are dropped, rather than the value thrown away", () => {
  // A stray dot is a slip. Erasing what somebody typed to punish it is the
  // wrong trade in a grid where the number came off a receipt in front of them.
  assert.equal(parseAmountInput("1.2.3"), "1.23");
  assert.equal(parseAmountInput("1..5"), "1.5");
});

test("null and undefined are empty, not a crash", () => {
  assert.equal(parseAmountInput(null), "");
  assert.equal(parseAmountInput(undefined), "");
  assert.equal(formatAmountForDisplay(null), "");
});

test("display groups the whole part", () => {
  assert.equal(formatAmountForDisplay("1000"), "1,000");
  assert.equal(formatAmountForDisplay("1234567"), "1,234,567");
  assert.equal(formatAmountForDisplay("999"), "999");
});

test("display shows the fraction exactly as entered, and never pads it", () => {
  // These fields have never padded to two places. Padding on blur would mean a
  // field that changes what it says the moment it loses focus, on a form whose
  // numbers are checked against a receipt.
  assert.equal(formatAmountForDisplay("1000.5"), "1,000.5");
  assert.equal(formatAmountForDisplay("1000.50"), "1,000.50");
  assert.equal(formatAmountForDisplay("1000.567"), "1,000.567");
});

test("a trailing dot survives — somebody mid-decimal who clicked away", () => {
  assert.equal(formatAmountForDisplay("1000."), "1,000.");
});

test("a leading dot keeps its shape", () => {
  assert.equal(formatAmountForDisplay(".5"), ".5");
});

test("an empty field shows nothing, so the placeholder still does its job", () => {
  assert.equal(formatAmountForDisplay(""), "");
  assert.equal(formatAmountForDisplay("   "), "");
});

test("display accepts an already-grouped value without doubling it up", () => {
  // It parses first, so re-rendering a displayed value is safe.
  assert.equal(formatAmountForDisplay("1,000"), "1,000");
  assert.equal(formatAmountForDisplay(formatAmountForDisplay("1234567.8")), "1,234,567.8");
});

test("a leading zero is not preserved by grouping, and that is the number's own rule", () => {
  // Number("007") is 7. Worth pinning: it is the one place display is not a
  // pure re-spelling of what is stored.
  assert.equal(formatAmountForDisplay("007"), "7");
  assert.equal(parseAmountInput("007"), "007");
});
