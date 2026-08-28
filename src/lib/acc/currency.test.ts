import { test } from "node:test";
import assert from "node:assert/strict";
import {
  THB,
  isBaht,
  toBaht,
  admitModelCurrency,
  brandCurrencyState,
  enabledForeignCurrencies,
  sameCurrency,
} from "./currency";

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
 * The admission rule. The model may answer only with one of the brand's own
 * currencies or baht; anything else means the user picks, which is what null
 * signals.
 */
test("the model's answer is admitted only if it is one of the brand's currencies or baht", () => {
  assert.equal(admitModelCurrency("MYR", ["MYR"]), "MYR");
  assert.equal(admitModelCurrency("myr", ["MYR"]), "MYR");
  assert.equal(admitModelCurrency(" MYR ", ["MYR"]), "MYR");
  assert.equal(admitModelCurrency("THB", ["MYR"]), THB);
  assert.equal(admitModelCurrency("USD", ["MYR"]), null);
  assert.equal(admitModelCurrency("", ["MYR"]), null);
  assert.equal(admitModelCurrency(null, ["MYR"]), null);
  assert.equal(admitModelCurrency(undefined, ["MYR"]), null);
});

/**
 * The reason this takes a list. A brand carrying THB and GBP must admit a GBP
 * receipt: with a single-code parameter the second currency was a misread
 * invented by the shape of the argument.
 */
test("every currency the brand carries is admitted, not only the first", () => {
  const brand = ["GBP", "MYR"];
  assert.equal(admitModelCurrency("GBP", brand), "GBP");
  assert.equal(admitModelCurrency("MYR", brand), "MYR");
  assert.equal(admitModelCurrency("THB", brand), THB);
  assert.equal(admitModelCurrency("USD", brand), null);
});

/** With no brand currency the only admissible answer is baht. */
test("an unconfigured brand admits baht alone", () => {
  assert.equal(admitModelCurrency("THB", []), THB);
  assert.equal(admitModelCurrency("MYR", []), null);
  assert.equal(admitModelCurrency("THB", null), THB);
  assert.equal(admitModelCurrency("MYR", null), null);
  assert.equal(admitModelCurrency("MYR", undefined), null);
});

/** A THB entry is not a choice — baht is admitted anyway, and nothing else is. */
test("a list holding only THB admits baht and nothing else", () => {
  assert.equal(admitModelCurrency("THB", ["THB"]), THB);
  assert.equal(admitModelCurrency("MYR", ["THB"]), null);
});

function entry(
  code: string,
  isEnabled: boolean,
  id = 1,
): { id: number; countryCode: string | null; currencyCode: string; isEnabled: boolean } {
  return { id, countryCode: null, currencyCode: code, isEnabled };
}

test("the currencies on offer are the enabled, non-baht ones, deduplicated", () => {
  assert.deepEqual(
    enabledForeignCurrencies([entry("GBP", true, 1), entry("MYR", true, 2)]),
    ["GBP", "MYR"],
  );
  assert.deepEqual(enabledForeignCurrencies([entry("MYR", false)]), []);
  assert.deepEqual(enabledForeignCurrencies([entry("THB", true)]), []);
  assert.deepEqual(enabledForeignCurrencies([entry(" myr ", true)]), ["MYR"]);
  assert.deepEqual(enabledForeignCurrencies([entry("", true)]), []);
  assert.deepEqual(enabledForeignCurrencies([]), []);
  assert.deepEqual(enabledForeignCurrencies(null), []);
  assert.deepEqual(enabledForeignCurrencies(undefined), []);
});

/** Belt and braces over UQ_BrandCurrency_Brand_Currency — a picker must not list one twice. */
test("a duplicate code is offered once", () => {
  assert.deepEqual(
    enabledForeignCurrencies([entry("MYR", true, 1), entry("myr", true, 2)]),
    ["MYR"],
  );
});

test("a brand is configured only while at least one foreign currency is switched on", () => {
  assert.equal(brandCurrencyState({ currencies: [entry("MYR", true)] }), "configured");
  assert.equal(
    brandCurrencyState({ currencies: [entry("THB", true, 1), entry("GBP", true, 2)] }),
    "configured",
  );
  assert.equal(brandCurrencyState({ currencies: [entry("MYR", false)] }), "none");
  assert.equal(brandCurrencyState({ currencies: [entry("THB", true)] }), "none");
  assert.equal(brandCurrencyState({ currencies: [] }), "none");
  assert.equal(brandCurrencyState({ currencies: null }), "none");
  assert.equal(brandCurrencyState(null), "none");
  assert.equal(brandCurrencyState(undefined), "none");
});

/**
 * The three spellings of baht are why this exists: a bare `===` on the codes
 * would call a null claim currency different from a `"THB"` read and blank a
 * field that was perfectly fillable.
 */
test("sameCurrency treats null, empty and THB as one currency", () => {
  assert.equal(sameCurrency(null, THB), true);
  assert.equal(sameCurrency("", null), true);
  assert.equal(sameCurrency(undefined, "thb"), true);
  assert.equal(sameCurrency("MYR", "myr"), true);
  assert.equal(sameCurrency("MYR", THB), false);
  assert.equal(sameCurrency("MYR", null), false);
  assert.equal(sameCurrency("MYR", "USD"), false);
});
