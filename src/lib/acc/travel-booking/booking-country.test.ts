import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOKING_DEFAULT_COUNTRY, resolveBookingCountry } from "./booking-country";

/**
 * The country arrives from the client and is stored in a `CHAR(2)` that will
 * happily hold `XX`. Per-diem-by-country then resolves a rate for whatever is
 * in there, so an unrecognised code must never be stored — it must become
 * Thailand, which is where a trip is unless somebody said otherwise.
 */

test("a known country is accepted, trimmed and upper-cased", () => {
  assert.equal(resolveBookingCountry("MY"), "MY");
  assert.equal(resolveBookingCountry("my"), "MY");
  assert.equal(resolveBookingCountry("  jp  "), "JP");
  assert.equal(resolveBookingCountry("GB"), "GB");
});

test("nothing posted means Thailand", () => {
  assert.equal(resolveBookingCountry(null), BOOKING_DEFAULT_COUNTRY);
  assert.equal(resolveBookingCountry(undefined), BOOKING_DEFAULT_COUNTRY);
  assert.equal(resolveBookingCountry(""), BOOKING_DEFAULT_COUNTRY);
  assert.equal(resolveBookingCountry("   "), BOOKING_DEFAULT_COUNTRY);
});

/**
 * Every one of these would otherwise reach a CHAR(2) column and, later, a rate
 * lookup. Falling back to Thailand is the safe direction: a trip is priced at
 * the HR allowance it would have had before this feature existed.
 */
test("an unknown code becomes Thailand rather than being stored", () => {
  for (const bad of ["XX", "ZZ", "THA", "T", "12", "T H", "MY,JP", "--", "<x>", "null"]) {
    assert.equal(resolveBookingCountry(bad), BOOKING_DEFAULT_COUNTRY, `should have fallen back: ${bad}`);
  }
});

test("it never throws, whatever it is handed", () => {
  for (const v of [null, undefined, "", "  ", "XX", "MY"]) {
    assert.doesNotThrow(() => resolveBookingCountry(v));
  }
});

test("the default is Thailand, and it is a country the list knows", () => {
  assert.equal(BOOKING_DEFAULT_COUNTRY, "TH");
  assert.equal(resolveBookingCountry(BOOKING_DEFAULT_COUNTRY), BOOKING_DEFAULT_COUNTRY);
});

/**
 * The result is always storable: two upper-case letters, never blank. A caller
 * binding this to CHAR(2) NOT NULL must not have to check.
 */
test("the answer is always a storable two-letter code", () => {
  for (const v of [null, "", "xx", "my", " gb ", "THAILAND"]) {
    assert.match(resolveBookingCountry(v), /^[A-Z]{2}$/);
  }
});
