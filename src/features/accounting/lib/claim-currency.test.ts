import { test } from "node:test";
import assert from "node:assert/strict";
import {
  claimCurrencyOptions,
  effectiveClaimCurrency,
  rateVehicleAllowed,
} from "./claim-currency";
import type { BrandCurrencyEntry } from "@/lib/acc/currency";

function entry(code: string, isEnabled: boolean, id = 1): BrandCurrencyEntry {
  return { id, countryCode: null, currencyCode: code, isEnabled };
}

const MYR = { currencies: [entry("MYR", true)] };
const MYR_AND_GBP = { currencies: [entry("MYR", true, 1), entry("GBP", true, 2)] };
const STAGED = { currencies: [entry("MYR", false)] };
const NOTHING = { currencies: [] };
const BAHT_BRAND = { currencies: [entry("THB", true)] };

test("a rate-based vehicle is allowed on a baht claim and refused on a foreign one", () => {
  assert.equal(rateVehicleAllowed(null), true);
  assert.equal(rateVehicleAllowed(undefined), true);
  assert.equal(rateVehicleAllowed(""), true);
  assert.equal(rateVehicleAllowed("THB"), true);
  assert.equal(rateVehicleAllowed("thb"), true);
  assert.equal(rateVehicleAllowed("MYR"), false);
});

/**
 * An unconfigured brand must leave the form pixel-identical to before this
 * feature shipped, which an empty option list is what produces.
 */
test("only a brand with an enabled foreign currency offers a choice", () => {
  assert.deepEqual(claimCurrencyOptions(MYR), ["MYR", "THB"]);
  assert.deepEqual(claimCurrencyOptions(STAGED), []);
  assert.deepEqual(claimCurrencyOptions(NOTHING), []);
  assert.deepEqual(claimCurrencyOptions(BAHT_BRAND), []);
  assert.deepEqual(claimCurrencyOptions(null), []);
  assert.deepEqual(claimCurrencyOptions(undefined), []);
});

/** The whole point of the change: a brand may carry more than one. */
test("every enabled currency is offered, in row order, with baht last", () => {
  assert.deepEqual(claimCurrencyOptions(MYR_AND_GBP), ["MYR", "GBP", "THB"]);
});

/** A brand carrying THB alongside a foreign currency must not list baht twice. */
test("a THB row does not produce a second baht option", () => {
  assert.deepEqual(
    claimCurrencyOptions({ currencies: [entry("THB", true, 1), entry("GBP", true, 2)] }),
    ["GBP", "THB"],
  );
});

test("a disabled row is left out while its siblings are still offered", () => {
  assert.deepEqual(
    claimCurrencyOptions({ currencies: [entry("MYR", false, 1), entry("GBP", true, 2)] }),
    ["GBP", "THB"],
  );
});

test("the brand's code is normalised and offered before baht", () => {
  assert.deepEqual(claimCurrencyOptions({ currencies: [entry(" myr ", true)] }), ["MYR", "THB"]);
});

test("baht is the default, and anything the brand does not offer resolves to baht", () => {
  assert.equal(effectiveClaimCurrency(null, MYR), "THB");
  assert.equal(effectiveClaimCurrency("", MYR), "THB");
  assert.equal(effectiveClaimCurrency("THB", MYR), "THB");
  assert.equal(effectiveClaimCurrency("MYR", MYR), "MYR");
  assert.equal(effectiveClaimCurrency("myr", MYR), "MYR");
  // A currency that was never on the picker; a forged post, not a choice.
  assert.equal(effectiveClaimCurrency("USD", MYR), "THB");
});

/** Baht stays the default even where the brand carries several currencies. */
test("a multi-currency brand still defaults to baht and honours either code", () => {
  assert.equal(effectiveClaimCurrency(null, MYR_AND_GBP), "THB");
  assert.equal(effectiveClaimCurrency("MYR", MYR_AND_GBP), "MYR");
  assert.equal(effectiveClaimCurrency("GBP", MYR_AND_GBP), "GBP");
  assert.equal(effectiveClaimCurrency("USD", MYR_AND_GBP), "THB");
});

/**
 * The recovery path. An admin switching a currency off — or removing it — must
 * not strand a draft that already holds `MYR`: the dropdown disappears, so
 * there would be no control on screen to change it back.
 */
test("a draft holding a currency the brand has since withdrawn resolves to baht", () => {
  assert.equal(effectiveClaimCurrency("MYR", STAGED), "THB");
  assert.equal(effectiveClaimCurrency("MYR", NOTHING), "THB");
  assert.equal(effectiveClaimCurrency("MYR", null), "THB");
});
