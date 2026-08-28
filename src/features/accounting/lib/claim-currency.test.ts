import { test } from "node:test";
import assert from "node:assert/strict";
import {
  claimCurrencyOptions,
  effectiveClaimCurrency,
  rateVehicleAllowed,
} from "./claim-currency";

const MYR = { currencyCode: "MYR", currencyEnabled: true };
const STAGED = { currencyCode: "MYR", currencyEnabled: false };
const NOTHING = { currencyCode: null, currencyEnabled: false };
const BAHT_BRAND = { currencyCode: "THB", currencyEnabled: true };

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
test("only a brand with a currency AND the flag on offers a choice", () => {
  assert.deepEqual(claimCurrencyOptions(MYR), ["MYR", "THB"]);
  assert.deepEqual(claimCurrencyOptions(STAGED), []);
  assert.deepEqual(claimCurrencyOptions(NOTHING), []);
  assert.deepEqual(claimCurrencyOptions(BAHT_BRAND), []);
  assert.deepEqual(claimCurrencyOptions(null), []);
  assert.deepEqual(claimCurrencyOptions(undefined), []);
});

test("the brand's code is normalised and offered before baht", () => {
  assert.deepEqual(claimCurrencyOptions({ currencyCode: " myr ", currencyEnabled: true }), [
    "MYR",
    "THB",
  ]);
});

test("baht is the default, and anything the brand does not offer resolves to baht", () => {
  assert.equal(effectiveClaimCurrency(null, MYR), "THB");
  assert.equal(effectiveClaimCurrency("", MYR), "THB");
  assert.equal(effectiveClaimCurrency("THB", MYR), "THB");
  assert.equal(effectiveClaimCurrency("MYR", MYR), "MYR");
  assert.equal(effectiveClaimCurrency("myr", MYR), "MYR");
  // A third currency was never on the picker; it is a forged post, not a choice.
  assert.equal(effectiveClaimCurrency("USD", MYR), "THB");
});

/**
 * The recovery path. An admin switching `CurrencyEnabled` off must not strand a
 * draft that already holds `MYR` — the dropdown disappears, so there would be no
 * control on screen to change it back.
 */
test("a draft holding a currency the brand has since withdrawn resolves to baht", () => {
  assert.equal(effectiveClaimCurrency("MYR", STAGED), "THB");
  assert.equal(effectiveClaimCurrency("MYR", NOTHING), "THB");
  assert.equal(effectiveClaimCurrency("MYR", null), "THB");
});
