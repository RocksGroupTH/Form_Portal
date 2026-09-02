import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bookingCurrencyOptions,
  bookingCurrencyWord,
  effectiveBookingCurrency,
  referenceRateNote,
} from "./booking-currency";
import { COUNTRIES, isRateSourceCurrency } from "@/lib/acc/country-currency";

/**
 * The currency follows **where the trip goes**, and baht is always the default.
 *
 * Until 2026-09-02 it followed the request's *brand* and defaulted to that
 * brand's own currency. Both were wrong for the same reason: a brand is a set of
 * books, not a destination. KSI carries GBP, so a KSI desk booking a hotel in
 * Bangkok was offered GBP first and had to switch back to baht on every single
 * domestic trip — and a PCTH trip to London was offered no foreign currency at
 * all, because PCTH carries only THB.
 */


/**
 * A domestic trip, an unset country and an unknown code all render **no toggle
 * at all** — the panel stays exactly as it looked before any of this existed.
 *
 * An unset country is the common case, not an edge one: `AccRequest.CountryCode`
 * arrived on 2026-08-31 and five of the six AP-17 requests that exist have never
 * had one.
 */
test("only a foreign country offers a choice", () => {
  assert.deepEqual(bookingCurrencyOptions("GB"), ["THB", "GBP"]);
  assert.deepEqual(bookingCurrencyOptions("MY"), ["THB", "MYR"]);
  assert.deepEqual(bookingCurrencyOptions("TH"), []);
  assert.deepEqual(bookingCurrencyOptions(null), []);
  assert.deepEqual(bookingCurrencyOptions(undefined), []);
  assert.deepEqual(bookingCurrencyOptions(""), []);
  assert.deepEqual(bookingCurrencyOptions("ZZ"), []);
});

/** Baht leads, because baht is the default the desk starts on. */
test("baht is first, the destination's currency second", () => {
  assert.deepEqual(bookingCurrencyOptions("gb"), ["THB", "GBP"]);
  assert.deepEqual(bookingCurrencyOptions(" jp "), ["THB", "JPY"]);
});

/**
 * Two countries can share a currency and several of the 25 do — every euro
 * member resolves to EUR. Nothing here dedupes because nothing needs to: one
 * request has one destination.
 */
test("euro-area countries all resolve to EUR", () => {
  assert.deepEqual(bookingCurrencyOptions("DE"), ["THB", "EUR"]);
  assert.deepEqual(bookingCurrencyOptions("FR"), ["THB", "EUR"]);
});

/**
 * **Baht, always** — the opposite of what this answered until 2026-09-02, and
 * of AP-17's own first design.
 *
 * The booking desk types figures off an invoice weeks after the request was
 * filed. Almost every one of those invoices is in baht, including on foreign
 * trips booked through a Thai agent, so baht is the answer that is right by
 * default and the toggle is the exception.
 */
test("absent means baht, never the destination's currency", () => {
  assert.equal(effectiveBookingCurrency(null, "GB"), "THB");
  assert.equal(effectiveBookingCurrency(undefined, "GB"), "THB");
  assert.equal(effectiveBookingCurrency("", "GB"), "THB");
});

test("the destination's currency is admitted, case-insensitively", () => {
  assert.equal(effectiveBookingCurrency("GBP", "GB"), "GBP");
  assert.equal(effectiveBookingCurrency(" gbp ", "GB"), "GBP");
  assert.equal(effectiveBookingCurrency("JPY", "JP"), "JPY");
});

test("baht is honoured whatever the destination", () => {
  assert.equal(effectiveBookingCurrency("THB", "GB"), "THB");
  assert.equal(effectiveBookingCurrency("thb", "GB"), "THB");
  assert.equal(effectiveBookingCurrency("THB", null), "THB");
});

/**
 * A currency that is not this destination's was never on the toggle, so it is a
 * forged body or a stale page. It resolves to **baht**, which is what makes this
 * function unable to record a request in a currency its destination does not
 * use, whatever is posted — and baht is the safe direction, because it is the
 * only answer that needs no rate and can never be converted twice.
 */
test("a currency the destination does not use resolves to baht", () => {
  assert.equal(effectiveBookingCurrency("USD", "GB"), "THB");
  assert.equal(effectiveBookingCurrency("MYR", "GB"), "THB");
  assert.equal(effectiveBookingCurrency("GBP", "TH"), "THB");
  assert.equal(effectiveBookingCurrency("GBP", null), "THB");
  assert.equal(effectiveBookingCurrency("GBP", "ZZ"), "THB");
});

/**
 * Every country the picker offers must be convertible, or the desk could select
 * a currency whose save then fails with `BOOKING_FX_UNAVAILABLE_ERROR` forever
 * and no amount of retrying would help. Measured clean over all 25 on
 * 2026-09-02; this is here so a 26th added without a rate is caught at `npm
 * test` rather than by whoever is holding the invoice.
 */
test("every offerable country's currency can actually be quoted", () => {
  for (const c of COUNTRIES) {
    const options = bookingCurrencyOptions(c.code);
    for (const code of options) {
      if (code === "THB") continue;
      assert.ok(
        isRateSourceCurrency(code),
        `${c.code} offers ${code}, which the rate source cannot quote`,
      );
    }
  }
});

/**
 * The brand decides nothing here any more, and the signature is what enforces
 * it — a brand-shaped argument is a compile error, checked by `npm run
 * typecheck` rather than asserted at runtime. There is deliberately no runtime
 * assertion for it: passing one throws inside `currencyForCountry` rather than
 * returning `[]`, and a test that pinned that would be pinning the behaviour of
 * a call TypeScript already forbids.
 */

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
