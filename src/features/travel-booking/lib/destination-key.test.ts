import { test } from "node:test";
import assert from "node:assert/strict";
import { destinationKeyFor } from "./destination-key";

/**
 * Which destinations a request prices against, as one comparable string.
 *
 * It exists to decide when the per-diem country rates are worth re-fetching, and
 * it is derived from the tabs and the brands — **never from the estimates**. The
 * estimates are downstream of the rates the refetch replaces, so keying on them
 * makes "this cannot loop" a property to re-prove after every change to the
 * attribution shape rather than something the code structurally cannot do.
 */

const KSI = {
  brandCode: "KSI",
  currencies: [
    { currencyCode: "THB", countryCode: "TH", isEnabled: true },
    { currencyCode: "GBP", countryCode: "GB", isEnabled: true },
  ],
};
const PCTH = {
  brandCode: "PCTH",
  currencies: [{ currencyCode: "THB", countryCode: "TH", isEnabled: true }],
};

test("a foreign destination is the key", () => {
  assert.equal(destinationKeyFor([{ brandCode: "KSI", countryCode: "GB" }], [KSI]), "GB");
});

/**
 * Thailand is not a per-diem country — the HR allowance answers there — so a
 * domestic form yields the empty string and fires nothing.
 */
test("domestic is empty, and so is nothing at all", () => {
  assert.equal(destinationKeyFor([{ brandCode: "KSI", countryCode: "TH" }], [KSI]), "");
  assert.equal(destinationKeyFor([{ brandCode: "PCTH", countryCode: null }], [PCTH]), "");
  assert.equal(destinationKeyFor([], []), "");
});

/** Several trips, one string: sorted and de-duplicated so order cannot churn it. */
test("every tab contributes, sorted and de-duplicated", () => {
  const tabs = [
    { brandCode: "KSI", countryCode: "GB" },
    { brandCode: "KSI", countryCode: "TH" },
    { brandCode: "KSI", countryCode: "GB" },
  ];
  assert.equal(destinationKeyFor(tabs, [KSI]), "GB");
});

/**
 * **The brand resolves the country, exactly as the chips do.** A tab whose
 * country is unanswered takes the brand's default through `effectiveClaimCountry`
 * — the same rule `TravelBookingTab` marks a chip active with and the submit
 * stores — so the key describes what will actually be priced.
 */
test("an unanswered country resolves through the brand", () => {
  const gbOnly = {
    brandCode: "KSI",
    currencies: [{ currencyCode: "GBP", countryCode: "GB", isEnabled: true, isDefault: true }],
  };
  assert.equal(destinationKeyFor([{ brandCode: "KSI", countryCode: null }], [gbOnly]), "GB");
});

/**
 * **A brand list that has not arrived yields the same string as a domestic
 * form, and that is why the caller must wait for it.** `defaultClaimCountry`
 * answers TH for a null brand, so a resumed foreign draft looks domestic for the
 * first commit and then changes — which would read as a real destination change
 * and fire a refetch for data already in flight.
 */
test("with no brands loaded a foreign draft reads as domestic", () => {
  assert.equal(destinationKeyFor([{ brandCode: "KSI", countryCode: "GB" }], []), "");
});

test("codes are normalised", () => {
  assert.equal(destinationKeyFor([{ brandCode: "KSI", countryCode: " gb " }], [KSI]), "GB");
});

/** A tab with no brand takes its country as given — nothing to resolve against. */
test("a brandless tab uses its own country", () => {
  assert.equal(destinationKeyFor([{ brandCode: null, countryCode: "JP" }], []), "JP");
  assert.equal(destinationKeyFor([{ brandCode: null, countryCode: "TH" }], []), "");
});
