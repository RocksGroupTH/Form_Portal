import { test } from "node:test";
import assert from "node:assert/strict";
import {
  amountInBaht,
  currencyWord,
  fmtAmountWithCurrency,
  fmtMoneyTh,
  fmtRateTh,
  referenceRateNote,
  showsForeignCurrency,
} from "./currency-display";

test("baht keeps the Thai word, a foreign currency shows its code", () => {
  assert.equal(currencyWord(null), "บาท");
  assert.equal(currencyWord(undefined), "บาท");
  assert.equal(currencyWord(""), "บาท");
  assert.equal(currencyWord("THB"), "บาท");
  assert.equal(currencyWord("thb"), "บาท");
  assert.equal(currencyWord("MYR"), "MYR");
  assert.equal(currencyWord(" myr "), "MYR");
});

test("an absent figure is a dash, never 0.00", () => {
  assert.equal(fmtMoneyTh(null), "—");
  assert.equal(fmtMoneyTh(undefined), "—");
  assert.equal(fmtMoneyTh(Number.NaN), "—");
  assert.equal(fmtMoneyTh(0), "0.00");
});

test("a figure carries its own currency word", () => {
  assert.equal(fmtAmountWithCurrency(1234.5, "MYR"), "1,234.50 MYR");
  assert.equal(fmtAmountWithCurrency(1234.5, null), "1,234.50 บาท");
  assert.equal(fmtAmountWithCurrency(null, "MYR"), "— MYR");
});

test("a rate prints at four to six places — what DECIMAL(18,6) can hold", () => {
  assert.equal(fmtRateTh(8.25), "8.2500");
  assert.equal(fmtRateTh(8.123456), "8.123456");
  assert.equal(fmtRateTh(null), "—");
});

/** Never captioned as a Bank of Thailand rate — BOT_API_CLIENT_ID is unprovisioned. */
test("the rate caption says reference, and names no bank", () => {
  const note = referenceRateNote("MYR", 8.25);
  assert.ok(note.indexOf("อัตราอ้างอิง") === 0, note);
  assert.ok(note.indexOf("1 MYR") !== -1, note);
  assert.equal(note.indexOf("ธนาคารแห่งประเทศไทย"), -1);
});

/**
 * The invariant a baht claim rests on: no rate is consulted and the figure comes
 * back untouched, so nothing a baht claim displays can move.
 */
test("a baht figure passes through unconverted, with or without a rate", () => {
  assert.equal(amountInBaht(1234.56, null, null), 1234.56);
  assert.equal(amountInBaht(1234.56, "THB", 8.25), 1234.56);
  assert.equal(amountInBaht(1234.56, "", null), 1234.56);
  assert.equal(amountInBaht(0, null, null), 0);
});

test("a foreign figure converts at the stored rate", () => {
  assert.equal(amountInBaht(100, "MYR", 8.25), 825);
  assert.equal(amountInBaht(12.34, "MYR", 8.25), 101.81);
});

/** Never the unconverted figure — that is a ringgit number in a baht column. */
test("a foreign figure with no usable rate is null, never itself", () => {
  assert.equal(amountInBaht(100, "MYR", null), null);
  assert.equal(amountInBaht(100, "MYR", 0), null);
  assert.equal(amountInBaht(100, "MYR", -1), null);
  assert.equal(amountInBaht(100, "MYR", Number.NaN), null);
});

test("an absent figure converts to null in either currency", () => {
  assert.equal(amountInBaht(null, null, null), null);
  assert.equal(amountInBaht(undefined, "MYR", 8.25), null);
});

test("only a foreign claim shows anything extra", () => {
  assert.equal(showsForeignCurrency(null), false);
  assert.equal(showsForeignCurrency("THB"), false);
  assert.equal(showsForeignCurrency(""), false);
  assert.equal(showsForeignCurrency("MYR"), true);
});
