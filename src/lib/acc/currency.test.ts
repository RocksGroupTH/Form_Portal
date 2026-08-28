import { test } from "node:test";
import assert from "node:assert/strict";
import { THB, isBaht, toBaht, admitModelCurrency, brandCurrencyState } from "./currency";

test("null, empty and THB all mean baht", () => {
  assert.equal(isBaht(null), true);
  assert.equal(isBaht(undefined), true);
  assert.equal(isBaht(""), true);
  assert.equal(isBaht(THB), true);
  assert.equal(isBaht("thb"), true);
  assert.equal(isBaht("  THB  "), true);
  assert.equal(isBaht("MYR"), false);
});

test("converting applies the rate and rounds to satang", () => {
  assert.equal(toBaht(100, 8.25), 825);
  assert.equal(toBaht(12.34, 8.25), 101.81);
});

/**
 * A foreign amount with no usable rate is not zero and not itself — it is
 * unknown. Returning the unconverted figure would put a foreign number into a
 * baht column, which is the one failure this feature exists to prevent, and it
 * would be invisible.
 */
test("a foreign amount with no usable rate converts to null, never to itself", () => {
  assert.equal(toBaht(100, null), null);
  assert.equal(toBaht(100, 0), null);
  assert.equal(toBaht(100, -1), null);
  assert.equal(toBaht(100, Number.NaN), null);
  assert.equal(toBaht(100, Number.POSITIVE_INFINITY), null);
});

test("a non-finite amount converts to null", () => {
  assert.equal(toBaht(Number.NaN, 8.25), null);
  assert.equal(toBaht(Number.POSITIVE_INFINITY, 8.25), null);
});

/** Zero is a real figure — a nil claim line converts to a nil baht line. */
test("zero converts to zero, not to null", () => {
  assert.equal(toBaht(0, 8.25), 0);
});

/**
 * The admission rule. The model may answer only with the brand's currency or
 * baht; anything else means the user picks, which is what null signals.
 */
test("the model's answer is admitted only if it is the brand's currency or baht", () => {
  assert.equal(admitModelCurrency("MYR", "MYR"), "MYR");
  assert.equal(admitModelCurrency("myr", "MYR"), "MYR");
  assert.equal(admitModelCurrency(" MYR ", "MYR"), "MYR");
  assert.equal(admitModelCurrency("THB", "MYR"), THB);
  assert.equal(admitModelCurrency("USD", "MYR"), null);
  assert.equal(admitModelCurrency("", "MYR"), null);
  assert.equal(admitModelCurrency(null, "MYR"), null);
  assert.equal(admitModelCurrency(undefined, "MYR"), null);
});

/** With no brand currency the only admissible answer is baht. */
test("an unconfigured brand admits baht alone", () => {
  assert.equal(admitModelCurrency("THB", null), THB);
  assert.equal(admitModelCurrency("MYR", null), null);
  assert.equal(admitModelCurrency("MYR", ""), null);
});

/** A brand whose currency IS baht offers no choice, so it admits baht only. */
test("a brand configured as THB admits baht and nothing else", () => {
  assert.equal(admitModelCurrency("THB", "THB"), THB);
  assert.equal(admitModelCurrency("MYR", "THB"), null);
});

test("a brand is configured only when it has a foreign currency AND the flag is on", () => {
  assert.equal(brandCurrencyState({ currencyCode: "MYR", currencyEnabled: true }), "configured");
  assert.equal(brandCurrencyState({ currencyCode: "MYR", currencyEnabled: false }), "none");
  assert.equal(brandCurrencyState({ currencyCode: null, currencyEnabled: true }), "none");
  assert.equal(brandCurrencyState({ currencyCode: "", currencyEnabled: true }), "none");
  assert.equal(brandCurrencyState({ currencyCode: "THB", currencyEnabled: true }), "none");
});
