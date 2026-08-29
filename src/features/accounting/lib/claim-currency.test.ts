import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_COUNTRY,
  claimCountryOptions,
  effectiveClaimCountry,
  effectiveLineCurrency,
  lineCurrencyOptions,
  lineMoney,
  resolveLineCurrency,
  typedLineFigure,
} from "./claim-currency";
import type { BrandCurrencyEntry } from "@/lib/acc/currency";

function entry(code: string, isEnabled: boolean, id = 1): BrandCurrencyEntry {
  return { id, countryCode: null, currencyCode: code, isEnabled };
}

const MYR = { currencies: [entry("MYR", true)] };
const MYR_AND_GBP = { currencies: [entry("MYR", true, 1), entry("GBP", true, 2)] };
const EUR = { currencies: [entry("EUR", true)] };
const STAGED = { currencies: [entry("MYR", false)] };
const NOTHING = { currencies: [] };
const BAHT_BRAND = { currencies: [entry("THB", true)] };

/* ── The country picker ── */

/**
 * A brand with nothing configured must leave the form pixel-identical to before
 * this feature shipped, which one option — Thailand — is what produces: the
 * picker renders only for `length > 1`.
 */
test("Thailand is always offered, first, and alone for an unconfigured brand", () => {
  assert.deepEqual(claimCountryOptions(NOTHING), ["TH"]);
  assert.deepEqual(claimCountryOptions(STAGED), ["TH"]);
  assert.deepEqual(claimCountryOptions(BAHT_BRAND), ["TH"]);
  assert.deepEqual(claimCountryOptions(null), ["TH"]);
  assert.deepEqual(claimCountryOptions(undefined), ["TH"]);
  assert.equal(claimCountryOptions(MYR)[0], DEFAULT_COUNTRY);
});

test("a configured currency brings its country onto the picker", () => {
  assert.deepEqual(claimCountryOptions(MYR), ["TH", "MY"]);
});

/** The whole point of `BrandCurrency` being a list: a brand may carry several. */
test("every enabled currency contributes its country", () => {
  assert.deepEqual(claimCountryOptions(MYR_AND_GBP), ["TH", "MY", "GB"]);
});

/**
 * One currency, several countries. The requester names where they went and the
 * currency follows — which is why the picker is countries rather than codes.
 */
test("a shared currency offers every country that uses it", () => {
  assert.deepEqual(claimCountryOptions(EUR), ["TH", "NL", "FR", "DE", "ES", "IT"]);
});

test("a disabled row is left out while its siblings still appear", () => {
  assert.deepEqual(
    claimCountryOptions({ currencies: [entry("MYR", false, 1), entry("GBP", true, 2)] }),
    ["TH", "GB"],
  );
});

test("Thailand is the default, and anything the brand does not offer resolves to it", () => {
  assert.equal(effectiveClaimCountry(null, MYR), "TH");
  assert.equal(effectiveClaimCountry("", MYR), "TH");
  assert.equal(effectiveClaimCountry("TH", MYR), "TH");
  assert.equal(effectiveClaimCountry("MY", MYR), "MY");
  assert.equal(effectiveClaimCountry(" my ", MYR), "MY");
  // A country that was never on the picker; a forged post, not a choice.
  assert.equal(effectiveClaimCountry("JP", MYR), "TH");
});

/**
 * The recovery path. An admin switching a currency off — or removing it — must
 * not strand a draft that already holds `MY`: the picker disappears, so there
 * would be no control on screen to change it back.
 */
test("a draft naming a country the brand has since withdrawn resolves to Thailand", () => {
  assert.equal(effectiveClaimCountry("MY", STAGED), "TH");
  assert.equal(effectiveClaimCountry("MY", NOTHING), "TH");
  assert.equal(effectiveClaimCountry("MY", null), "TH");
});

/**
 * Thailand short-circuits before the brand is consulted at all, so the server's
 * `resolveClaimCountry` can skip its pool read for the ordinary claim.
 */
test("Thailand resolves without needing a brand", () => {
  assert.equal(effectiveClaimCountry("TH", null), "TH");
  assert.equal(effectiveClaimCountry("th", undefined), "TH");
});

/* ── The line dropdown ── */

/** The load-bearing one: Thailand renders no currency control anywhere. */
test("Thailand offers no line currency choice at all", () => {
  assert.deepEqual(lineCurrencyOptions("TH"), []);
  assert.deepEqual(lineCurrencyOptions(null), []);
  assert.deepEqual(lineCurrencyOptions(undefined), []);
  assert.deepEqual(lineCurrencyOptions(""), []);
  // A country the list does not know is not a licence to invent a currency.
  assert.deepEqual(lineCurrencyOptions("ZZ"), []);
});

test("a foreign country offers its own currency and baht, in that order", () => {
  assert.deepEqual(lineCurrencyOptions("MY"), ["MYR", "THB"]);
  assert.deepEqual(lineCurrencyOptions("jp"), ["JPY", "THB"]);
  assert.deepEqual(lineCurrencyOptions("FR"), ["EUR", "THB"]);
});

test("a Thai claim's every line is baht, whatever the line says", () => {
  assert.equal(effectiveLineCurrency(null, "TH"), "THB");
  assert.equal(effectiveLineCurrency("MYR", "TH"), "THB");
  assert.equal(effectiveLineCurrency("MYR", null), "THB");
});

/**
 * A line with no recorded currency is in the **country's** currency, not baht.
 * Somebody who names Malaysia did so because they spent ringgit; the example
 * this feature was asked for is a 20 MYR ride beside a 20 THB one, and the
 * second is the one that gets switched.
 */
test("a line with no currency takes the country's, and baht must be chosen", () => {
  assert.equal(effectiveLineCurrency(null, "MY"), "MYR");
  assert.equal(effectiveLineCurrency("", "MY"), "MYR");
  assert.equal(effectiveLineCurrency("MYR", "MY"), "MYR");
  assert.equal(effectiveLineCurrency("myr", "MY"), "MYR");
  assert.equal(effectiveLineCurrency("THB", "MY"), "THB");
});

/**
 * A currency the country does not offer — a draft whose country was changed, or
 * a hand-shaped request — falls back to the country's currency rather than to
 * baht. Calling a foreign figure baht converts nothing and shows nothing, which
 * is the silent failure the feature exists to prevent.
 */
test("a currency the country does not offer falls back to the country's own", () => {
  assert.equal(effectiveLineCurrency("GBP", "MY"), "MYR");
  assert.equal(effectiveLineCurrency("USD", "JP"), "JPY");
});

test("resolveLineCurrency is the same rule against a ready-made option list", () => {
  assert.equal(resolveLineCurrency("THB", ["MYR", "THB"]), "THB");
  assert.equal(resolveLineCurrency("GBP", ["MYR", "THB"]), "MYR");
  assert.equal(resolveLineCurrency(null, ["MYR", "THB"]), "MYR");
  assert.equal(resolveLineCurrency("MYR", []), "THB");
});

/* ── The line's four fields ── */

/**
 * The identity branch. A Thai line consults no rate and applies no rounding, so
 * its arithmetic is bit-identical to what it was before migration 129.
 */
test("a baht line passes the figure straight through and records no currency", () => {
  assert.deepEqual(lineMoney(20, "THB", 8.25), {
    amount: 20,
    currency: null,
    exchangeRate: null,
    foreignAmount: null,
  });
  // Even a rate of null cannot disturb it — that is what keeps an FX outage
  // from touching the Thai claims that are almost all of them.
  assert.deepEqual(lineMoney(1234.56, "THB", null), {
    amount: 1234.56,
    currency: null,
    exchangeRate: null,
    foreignAmount: null,
  });
});

test("a foreign line keeps the typed figure and previews the baht", () => {
  assert.deepEqual(lineMoney(20, "MYR", 8.2235), {
    amount: 164.47,
    currency: "MYR",
    exchangeRate: 8.2235,
    foreignAmount: 20,
  });
});

/**
 * **Never the unconverted figure.** Returning 20 there would put a ringgit
 * number under a baht total with nothing on screen to reveal it. Zero is
 * visibly wrong beside the `—` the row then shows, and the server's own
 * conversion corrects it on the next save.
 */
test("a foreign line with no rate previews zero, not the foreign figure", () => {
  assert.deepEqual(lineMoney(20, "MYR", null), {
    amount: 0,
    currency: "MYR",
    exchangeRate: null,
    foreignAmount: 20,
  });
  assert.equal(lineMoney(20, "MYR", 0).amount, 0);
  assert.equal(lineMoney(20, "MYR", -1).amount, 0);
});

test("a non-finite figure is zero rather than NaN", () => {
  assert.equal(lineMoney(Number.NaN, "THB", null).amount, 0);
  assert.equal(lineMoney(Number.NaN, "MYR", 8.25).foreignAmount, 0);
});

test("zero converts to zero — a nil line is a real figure, not an absent one", () => {
  assert.deepEqual(lineMoney(0, "MYR", 8.25), {
    amount: 0,
    currency: "MYR",
    exchangeRate: 8.25,
    foreignAmount: 0,
  });
});

/** Which field the input reads from, so a foreign row never shows the baht. */
test("the input shows what was typed, from whichever field holds it", () => {
  const opts = ["MYR", "THB"];
  assert.equal(typedLineFigure({ amount: 164.47, currency: "MYR", foreignAmount: 20 }, opts), 20);
  assert.equal(typedLineFigure({ amount: 55, currency: "THB", foreignAmount: null }, opts), 55);
  // No options at all — the Thailand case, where `amount` is the typed figure.
  assert.equal(typedLineFigure({ amount: 55, currency: "MYR", foreignAmount: 20 }, []), 55);
  // A legacy row on a foreign claim: no currency recorded, so it resolves to
  // the country's and reads its (absent) foreign figure as 0.
  assert.equal(typedLineFigure({ amount: 55 }, opts), 0);
});
