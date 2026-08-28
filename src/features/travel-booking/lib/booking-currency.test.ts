import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bookingCurrencyOptions,
  bookingCurrencyWord,
  effectiveBookingCurrency,
  referenceRateNote,
} from "./booking-currency";
import type { BrandCurrencyEntry } from "@/lib/acc/currency";

function entry(code: string, isEnabled: boolean, id = 1): BrandCurrencyEntry {
  return { id, countryCode: null, currencyCode: code, isEnabled };
}

const MYR = { currencies: [entry("MYR", true)] };
const MYR_AND_GBP = { currencies: [entry("MYR", true, 1), entry("GBP", true, 2)] };
const STAGED = { currencies: [entry("MYR", false)] };
const NOTHING = { currencies: [] };
const BAHT_BRAND = { currencies: [entry("THB", true)] };

/**
 * An unconfigured brand must leave `AdminBookingPanel` exactly as it looked
 * before this shipped, which an empty option list is what produces.
 */
test("only a brand with an enabled foreign currency offers a choice", () => {
  assert.deepEqual(bookingCurrencyOptions(MYR), ["MYR", "THB"]);
  assert.deepEqual(bookingCurrencyOptions(STAGED), []);
  assert.deepEqual(bookingCurrencyOptions(NOTHING), []);
  assert.deepEqual(bookingCurrencyOptions(BAHT_BRAND), []);
  assert.deepEqual(bookingCurrencyOptions(null), []);
  assert.deepEqual(bookingCurrencyOptions(undefined), []);
});

/** A brand may carry several; every enabled one is on the toggle. */
test("every enabled currency is offered, in row order, with baht last", () => {
  assert.deepEqual(bookingCurrencyOptions(MYR_AND_GBP), ["MYR", "GBP", "THB"]);
});

test("a THB row does not produce a second baht option", () => {
  assert.deepEqual(
    bookingCurrencyOptions({ currencies: [entry("THB", true, 1), entry("GBP", true, 2)] }),
    ["GBP", "THB"],
  );
});

test("the brand's code is normalised and offered before baht", () => {
  assert.deepEqual(bookingCurrencyOptions({ currencies: [entry(" myr ", true)] }), ["MYR", "THB"]);
});

/**
 * **The one rule that is the opposite of AP-1's**, and the reason this module
 * exists rather than a second call into `claim-currency.ts`.
 *
 * AP-17's requester never picks a currency — `TravelBookingTab` has no money
 * field — so an absent choice is not "they chose baht", it is "nobody has been
 * asked yet". The answer is derived from the brand.
 */
test("absent means the BRAND's currency, never baht", () => {
  assert.equal(effectiveBookingCurrency(null, MYR), "MYR");
  assert.equal(effectiveBookingCurrency(undefined, MYR), "MYR");
  assert.equal(effectiveBookingCurrency("", MYR), "MYR");
});

test("baht is honoured as the desk's explicit opt-out", () => {
  assert.equal(effectiveBookingCurrency("THB", MYR), "THB");
  assert.equal(effectiveBookingCurrency("thb", MYR), "THB");
});

test("the brand's own currency is admitted, case-insensitively", () => {
  assert.equal(effectiveBookingCurrency("MYR", MYR), "MYR");
  assert.equal(effectiveBookingCurrency(" myr ", MYR), "MYR");
});

/**
 * A currency the brand does not carry was never on the toggle, so it is a
 * forged body or a bug. Resolving it to the brand's first currency is what
 * makes this function unable to widen what a request may be recorded in,
 * whatever is posted.
 */
test("a currency the brand does not offer resolves to the brand's first", () => {
  assert.equal(effectiveBookingCurrency("USD", MYR), "MYR");
  assert.equal(effectiveBookingCurrency("SGD", MYR), "MYR");
  assert.equal(effectiveBookingCurrency("USD", MYR_AND_GBP), "MYR");
});

/** Each configured currency is honoured; the first is the default. */
test("a multi-currency brand honours either code and defaults to the first", () => {
  assert.equal(effectiveBookingCurrency(null, MYR_AND_GBP), "MYR");
  assert.equal(effectiveBookingCurrency("GBP", MYR_AND_GBP), "GBP");
  assert.equal(effectiveBookingCurrency("MYR", MYR_AND_GBP), "MYR");
  assert.equal(effectiveBookingCurrency("THB", MYR_AND_GBP), "THB");
});

/**
 * The recovery path, and the one place the fallback IS baht: with nothing
 * configured there is no brand currency to fall back to, so every answer is
 * baht and the panel renders nothing new.
 */
test("an unconfigured or switched-off brand always answers baht", () => {
  assert.equal(effectiveBookingCurrency("MYR", STAGED), "THB");
  assert.equal(effectiveBookingCurrency("MYR", NOTHING), "THB");
  assert.equal(effectiveBookingCurrency("MYR", BAHT_BRAND), "THB");
  assert.equal(effectiveBookingCurrency("MYR", null), "THB");
  assert.equal(effectiveBookingCurrency(null, null), "THB");
});

test("the word after a figure is บาท for baht and the code otherwise", () => {
  assert.equal(bookingCurrencyWord(null), "บาท");
  assert.equal(bookingCurrencyWord(""), "บาท");
  assert.equal(bookingCurrencyWord("THB"), "บาท");
  assert.equal(bookingCurrencyWord("thb"), "บาท");
  assert.equal(bookingCurrencyWord("MYR"), "MYR");
  assert.equal(bookingCurrencyWord(" myr "), "MYR");
});

/**
 * No screen may caption a rate as a Bank of Thailand rate — every rate here is
 * an ECB mid-market reference rate (spec §9.1).
 */
test("the rate caption says อัตราอ้างอิง and never names the Bank of Thailand", () => {
  const note = referenceRateNote("MYR", 8.25);
  assert.ok(note.indexOf("อัตราอ้างอิง") === 0, `expected an อัตราอ้างอิง caption, got: ${note}`);
  assert.ok(note.indexOf("MYR") > 0);
  assert.equal(/ธนาคารแห่งประเทศไทย|Bank of Thailand|BOT/.test(note), false);
});
