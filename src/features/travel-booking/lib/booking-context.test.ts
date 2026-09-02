import { test } from "node:test";
import assert from "node:assert/strict";
import { bookingBrandLabel, bookingCountryCode } from "./booking-context";
import { BOOKING_DEFAULT_COUNTRY } from "@/lib/acc/travel-booking/booking-country";

/**
 * The two facts the Admin booking desk states to a supplier before anything
 * else: which company the booking is billed to, and where the trip goes.
 *
 * Both are one ternary's worth of logic and both are here rather than inline
 * because of what they have to agree with. The brand label must degrade
 * gracefully through a fetch that can fail permanently; the country must resolve
 * a null exactly the way `resolveBookingCountry` and the detail page resolve it,
 * or a reader sees two screens disagree about where a trip is going.
 */

test("the brand reads name and code together when the name is known", () => {
  assert.equal(bookingBrandLabel("KSI", "KHAO-SŌ-i"), "KHAO-SŌ-i (KSI)");
  assert.equal(bookingBrandLabel("PCTH", "Potato Corner TH"), "Potato Corner TH (PCTH)");
});

/**
 * The name arrives asynchronously — the codes are on the request, the names are
 * in the brand registry — and the fetch that carries it can fail permanently.
 * Every one of those states falls back to the bare code, which is what the
 * detail page shows anyway, so the row never waits and never renders blank.
 */
test("an unknown name falls back to the bare code", () => {
  assert.equal(bookingBrandLabel("KSI", null), "KSI");
  assert.equal(bookingBrandLabel("KSI", undefined), "KSI");
  assert.equal(bookingBrandLabel("KSI", ""), "KSI");
  assert.equal(bookingBrandLabel("KSI", "   "), "KSI");
});

/** No brand at all is a dash, not an empty parenthesis or a bare name. */
test("no brand code reads as a dash, whatever the name says", () => {
  assert.equal(bookingBrandLabel(null, "KHAO-SŌ-i"), "—");
  assert.equal(bookingBrandLabel("", "KHAO-SŌ-i"), "—");
  assert.equal(bookingBrandLabel("  ", null), "—");
  assert.equal(bookingBrandLabel(undefined, undefined), "—");
});

test("both are trimmed and the code keeps its case", () => {
  assert.equal(bookingBrandLabel(" ksi ", " KHAO-SŌ-i "), "KHAO-SŌ-i (KSI)");
});

/**
 * **A null country is Thailand, not "unknown".**
 *
 * That is what `resolveBookingCountry` stores for it, and most AP-17 requests
 * predate `AccRequest.CountryCode` (2026-08-31) — every one of those is a Thai
 * trip. The detail page applies the same rule; a reader must not find the two
 * screens disagreeing about where a request is going.
 */
test("an absent country resolves to Thailand", () => {
  assert.equal(bookingCountryCode(null), BOOKING_DEFAULT_COUNTRY);
  assert.equal(bookingCountryCode(undefined), BOOKING_DEFAULT_COUNTRY);
  assert.equal(bookingCountryCode(""), BOOKING_DEFAULT_COUNTRY);
  assert.equal(bookingCountryCode("   "), BOOKING_DEFAULT_COUNTRY);
});

test("a stored country is honoured, normalised", () => {
  assert.equal(bookingCountryCode("GB"), "GB");
  assert.equal(bookingCountryCode(" gb "), "GB");
  assert.equal(bookingCountryCode("my"), "MY");
});

/**
 * A code the 25-entry list has never heard of is returned as it stands rather
 * than corrected to Thailand. `AccRequest.CountryCode` is `CHAR(2)` with no
 * CHECK, so a direct SQL edit can put anything there, and showing what is
 * actually stored is what lets somebody find it — silently displaying "ไทย" for
 * a row that says `XX` hides the fault on the one screen that could report it.
 */
test("an unrecognised code is shown as stored, not corrected", () => {
  assert.equal(bookingCountryCode("XX"), "XX");
  assert.equal(bookingCountryCode("zz"), "ZZ");
});

/**
 * **A name equal to its own code is not printed twice.**
 *
 * `ROCKS (ROCKS)` is reachable two ways and neither is exotic:
 * `brand-registry.ts:228` falls back to `name: b.Name ?? b.Code` for a brand the
 * Codex master has no name for, and `brand-options.ts:49` falls back again to
 * `brandName: b?.brandName ?? row.BrandCode` for one the registry does not carry
 * at all. So the duplicate appears exactly for the brands nobody has finished
 * configuring — the ones a reader is most likely to be checking.
 *
 * Compared case-insensitively, because the code is uppercased on the way in and
 * the name is not. `countryNameBoth` drops its English half for the same reason.
 */
test("a name that is just the code is not printed twice", () => {
  assert.equal(bookingBrandLabel("ROCKS", "ROCKS"), "ROCKS");
  assert.equal(bookingBrandLabel("PCTH", "pcth"), "PCTH");
  assert.equal(bookingBrandLabel("PCTH", " Pcth "), "PCTH");
  assert.equal(bookingBrandLabel(" ksi ", "KSI"), "KSI");
  // A name that merely contains the code is still a name.
  assert.equal(bookingBrandLabel("PCTH", "Potato Corner TH"), "Potato Corner TH (PCTH)");
});
