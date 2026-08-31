import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOKING_DEFAULT_COUNTRY, resolveBookingCountry } from "./booking-country";
import type { BrandCurrencyEntry } from "@/lib/acc/currency";

/**
 * Which country an AP-17 trip is stored as.
 *
 * Since 2026-08-31 this is **brand-scoped, using AP-1's own rule** — the form
 * offers the countries the brand's `BrandCurrency` rows imply, and this resolves
 * the posted value against the same brand. The tests below are therefore about
 * the two things that rule has to get right for AP-17 specifically: that the
 * stored value matches the chip the requester was looking at, and that a country
 * the brand does not offer never reaches `CHAR(2)` — because
 * per-diem-by-country then prices the trip on whatever is in there.
 */

const cur = (
  currencyCode: string,
  countryCode: string | null,
  isEnabled = true,
  isDefault = false,
): BrandCurrencyEntry =>
  ({ currencyCode, countryCode, isEnabled, isDefault }) as BrandCurrencyEntry;

/** Thailand and England, baht marked default — KSI's real shape. */
const TH_GB = { currencies: [cur("THB", "TH", true, true), cur("GBP", "GB")] };
/** Foreign only: a brand that claims in ringgit and not in baht. */
const MY_ONLY = { currencies: [cur("MYR", "MY", true, true)] };
/** Configured for nothing — the state both AP-17 brands are in today. */
const NONE = { currencies: [] as BrandCurrencyEntry[] };

test("a country the brand offers is stored as chosen", () => {
  assert.equal(resolveBookingCountry("GB", TH_GB), "GB");
  assert.equal(resolveBookingCountry("TH", TH_GB), "TH");
  assert.equal(resolveBookingCountry("MY", MY_ONLY), "MY");
});

/**
 * THE ONE THAT KEEPS THE SCREEN AND THE DATABASE AGREEING. The form seeds no
 * country until somebody clicks a chip, so a new trip posts null while showing
 * the brand's default as selected. Resolving null against the brand is what
 * stores the country the requester was actually looking at; a plain
 * "is this a country we know" test would store Thailand instead, and a
 * ringgit-only brand's trip would then be priced as a domestic one.
 */
test("nothing posted takes the brand's default, not Thailand", () => {
  assert.equal(resolveBookingCountry(null, MY_ONLY), "MY");
  assert.equal(resolveBookingCountry(undefined, MY_ONLY), "MY");
  assert.equal(resolveBookingCountry("", MY_ONLY), "MY");
  assert.equal(resolveBookingCountry("   ", MY_ONLY), "MY");
});

test("nothing posted against a baht brand is still Thailand", () => {
  assert.equal(resolveBookingCountry(null, TH_GB), "TH");
});

/**
 * An admin switching a BrandCurrency row off must not strand a draft. The stored
 * country resolves to one the brand does offer, so the form has a chip to show
 * and the next save succeeds — the same recoverability AP-1 relies on.
 */
test("a country the brand no longer offers falls back to one it does", () => {
  assert.equal(resolveBookingCountry("GB", MY_ONLY), "MY");
  assert.equal(resolveBookingCountry("JP", TH_GB), "TH");
});

/**
 * A brand nobody has configured offers nothing, the band does not render, and
 * every trip against it is Thailand. That is the configuration speaking, not a
 * failure — and it is the state both live AP-17 brands are in today.
 */
test("a brand configured for nothing travels only to Thailand", () => {
  for (const posted of [null, "", "GB", "MY", "XX"]) {
    assert.equal(resolveBookingCountry(posted, NONE), BOOKING_DEFAULT_COUNTRY);
    assert.equal(resolveBookingCountry(posted, null), BOOKING_DEFAULT_COUNTRY);
  }
});

/** Nothing unrecognised may reach CHAR(2): per diem is priced on what is stored. */
test("junk never reaches the column", () => {
  for (const bad of ["XX", "ZZ", "THA", "T", "12", "T H", "MY,JP", "--", "<x>", "null"]) {
    const stored = resolveBookingCountry(bad, TH_GB);
    assert.match(stored, /^[A-Z]{2}$/, `not storable: ${bad}`);
    assert.ok(["TH", "GB"].indexOf(stored) >= 0, `${bad} resolved outside the brand: ${stored}`);
  }
});

test("the answer is always a storable two-letter code", () => {
  for (const brand of [TH_GB, MY_ONLY, NONE, null]) {
    for (const posted of [null, "", "xx", "gb", " my "]) {
      assert.match(resolveBookingCountry(posted, brand), /^[A-Z]{2}$/);
    }
  }
});

test("it never throws, whatever it is handed", () => {
  for (const brand of [TH_GB, NONE, null, undefined]) {
    for (const v of [null, undefined, "", "  ", "XX", "MY"]) {
      assert.doesNotThrow(() => resolveBookingCountry(v, brand));
    }
  }
});

test("the default is Thailand", () => {
  assert.equal(BOOKING_DEFAULT_COUNTRY, "TH");
});
