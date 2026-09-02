import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bookingCurrencyOptions,
  bookingCurrencyWord,
  effectiveBookingCurrency,
  referenceRateNote,
} from "./booking-currency";
import { COUNTRIES, isRateSourceCurrency } from "@/lib/acc/country-currency";
import { claimCountryOptions } from "@/features/accounting/lib/claim-currency";
import type { BrandCurrencyEntry } from "@/lib/acc/currency";

/**
 * The toggle offers **the brand's own currencies AND the destination's**, with
 * baht always first and always the default.
 *
 * Both arms have been the whole answer at some point and each was wrong alone:
 *
 * - **Brand alone** (until 2026-09-02) defaulted to the brand's currency, so a
 *   KSI desk booking a Bangkok hotel was offered GBP first and had to correct it
 *   on every domestic trip.
 * - **Destination alone** (2026-09-02, for one commit) offered a KSI trip to
 *   Bangkok nothing at all — but a KSI trip is commonly booked and billed
 *   through a UK account in pounds whatever the destination, and the desk was
 *   left unable to record the invoice in front of it.
 *
 * The union answers both, and it is safe rather than merely broad — see
 * "the destination arm never widens beyond what the brand already carries".
 */

function entry(code: string, isEnabled: boolean, id = 1): BrandCurrencyEntry {
  return { id, countryCode: null, currencyCode: code, isEnabled };
}

/** The three brands AP-17 is actually granted, as configured, measured 2026-09-02. */
const KSI = { currencies: [entry("THB", true, 11), entry("GBP", true, 15)] };
const PCMY = { currencies: [entry("MYR", true, 4), entry("THB", false, 8)] };
const PCTH = { currencies: [entry("THB", true, 10)] };

test("the options are the brand's currencies and the destination's, baht first", () => {
  // KSI to Britain: both arms say GBP, and it is listed once.
  assert.deepEqual(bookingCurrencyOptions(KSI, "GB"), ["THB", "GBP"]);
  // KSI at home: the destination arm says nothing, the brand's books say GBP.
  // This is the case the destination-only rule got wrong.
  assert.deepEqual(bookingCurrencyOptions(KSI, "TH"), ["THB", "GBP"]);
  assert.deepEqual(bookingCurrencyOptions(PCMY, "MY"), ["THB", "MYR"]);
  assert.deepEqual(bookingCurrencyOptions(PCMY, "TH"), ["THB", "MYR"]);
});

/**
 * Empty means **render no toggle at all**, and it has to keep meaning that: a
 * baht-only brand on a Thai trip must leave the booking card exactly as it
 * looked before any of this shipped, with the booking-number field full width.
 */
test("a baht-only brand on a Thai trip offers nothing", () => {
  assert.deepEqual(bookingCurrencyOptions(PCTH, "TH"), []);
  assert.deepEqual(bookingCurrencyOptions(PCTH, null), []);
  assert.deepEqual(bookingCurrencyOptions(null, "TH"), []);
  assert.deepEqual(bookingCurrencyOptions(null, null), []);
  assert.deepEqual(bookingCurrencyOptions(undefined, undefined), []);
  assert.deepEqual(bookingCurrencyOptions({ currencies: [] }, ""), []);
});

/** A brand with nothing configured still records a foreign trip's own money. */
test("the destination arm answers for a brand with no currencies configured", () => {
  assert.deepEqual(bookingCurrencyOptions(PCTH, "GB"), ["THB", "GBP"]);
  assert.deepEqual(bookingCurrencyOptions(null, "JP"), ["THB", "JPY"]);
});

test("a brand's several currencies are all offered, after baht", () => {
  const multi = { currencies: [entry("GBP", true, 1), entry("MYR", true, 2)] };
  assert.deepEqual(bookingCurrencyOptions(multi, "TH"), ["THB", "GBP", "MYR"]);
  // The destination's own leads the foreign ones: it is the likeliest answer for
  // an invoice raised where the trip actually went.
  assert.deepEqual(bookingCurrencyOptions(multi, "MY"), ["THB", "MYR", "GBP"]);
});

test("a disabled brand row is not offered, and a THB row is never listed twice", () => {
  assert.deepEqual(bookingCurrencyOptions({ currencies: [entry("GBP", false)] }, "TH"), []);
  assert.deepEqual(bookingCurrencyOptions(PCMY, "TH"), ["THB", "MYR"]);
});

test("codes are normalised", () => {
  assert.deepEqual(
    bookingCurrencyOptions({ currencies: [entry(" gbp ", true)] }, " th "),
    ["THB", "GBP"],
  );
  assert.deepEqual(bookingCurrencyOptions(PCTH, "gb"), ["THB", "GBP"]);
});

/**
 * **Baht, always.** The booking desk types figures off an invoice weeks after
 * the request was filed, and almost every one of those invoices is in baht,
 * foreign trips included: they are commonly booked through a Thai agent.
 */
test("absent means baht, whatever the brand or the destination", () => {
  assert.equal(effectiveBookingCurrency(null, KSI, "GB"), "THB");
  assert.equal(effectiveBookingCurrency(undefined, KSI, "GB"), "THB");
  assert.equal(effectiveBookingCurrency("", PCMY, "MY"), "THB");
});

test("either arm's currency is admitted, case-insensitively", () => {
  assert.equal(effectiveBookingCurrency("GBP", KSI, "TH"), "GBP");
  assert.equal(effectiveBookingCurrency(" gbp ", KSI, "TH"), "GBP");
  assert.equal(effectiveBookingCurrency("GBP", PCTH, "GB"), "GBP");
  assert.equal(effectiveBookingCurrency("MYR", PCMY, "MY"), "MYR");
});

test("baht is honoured whatever is offered", () => {
  assert.equal(effectiveBookingCurrency("THB", KSI, "GB"), "THB");
  assert.equal(effectiveBookingCurrency("thb", KSI, "GB"), "THB");
  assert.equal(effectiveBookingCurrency("THB", null, null), "THB");
});

/**
 * A currency on neither arm was never on the toggle, so it is a stale page or a
 * forged body. It resolves to **baht**, which is what makes this unable to
 * record a request in money neither its books nor its destination use — and baht
 * is the safe direction, because it is the one answer that needs no rate and can
 * never be converted twice.
 */
test("a currency on neither arm resolves to baht", () => {
  assert.equal(effectiveBookingCurrency("USD", KSI, "GB"), "THB");
  assert.equal(effectiveBookingCurrency("MYR", KSI, "GB"), "THB");
  assert.equal(effectiveBookingCurrency("GBP", PCMY, "MY"), "THB");
  assert.equal(effectiveBookingCurrency("GBP", PCTH, "TH"), "THB");
  assert.equal(effectiveBookingCurrency("GBP", null, null), "THB");
  assert.equal(effectiveBookingCurrency("GBP", PCTH, "ZZ"), "THB");
});

/**
 * **The union is provably no wider than the brand's own books**, which is why
 * adding the destination arm cannot let a request be recorded in money the
 * company does not deal in.
 *
 * `AccRequest.CountryCode` is written through `resolveBookingCountry` →
 * `effectiveClaimCountry`, which admits only a country in
 * `claimCountryOptions(brand)` — and that list is itself derived from the
 * brand's enabled currencies. So for every country a request can actually hold,
 * the destination's currency is already one of the brand's.
 *
 * The arm is not therefore pointless: it answers for a brand with nothing
 * configured, and it survives the day somebody loosens that bound. But it cannot
 * widen the set, and this test is what says so if that ever stops being true.
 */
test("the destination arm never widens beyond what the brand already carries", () => {
  const brands = [
    KSI,
    PCMY,
    PCTH,
    { currencies: [entry("GBP", true, 1), entry("MYR", true, 2)] },
  ];
  for (const brand of brands) {
    const brandOnly = bookingCurrencyOptions(brand, null);
    for (const country of claimCountryOptions(brand)) {
      for (const code of bookingCurrencyOptions(brand, country)) {
        assert.ok(
          code === "THB" || brandOnly.indexOf(code) !== -1,
          `${country} contributes ${code}, which this brand does not carry`,
        );
      }
    }
  }
});

/**
 * Every currency the toggle can offer must be convertible, or the desk could
 * pick one whose save then fails with `BOOKING_FX_UNAVAILABLE_ERROR` forever and
 * no amount of retrying would help. The destination arm is bounded by the
 * 25-country list; this asserts every one of them.
 */
test("every offerable country's currency can actually be quoted", () => {
  for (const c of COUNTRIES) {
    for (const code of bookingCurrencyOptions(null, c.code)) {
      if (code === "THB") continue;
      assert.ok(isRateSourceCurrency(code), `${c.code} offers ${code}, which cannot be quoted`);
    }
  }
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
