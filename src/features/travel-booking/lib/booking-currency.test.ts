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
 * baht last in the list and always the default selection — two separate
 * questions, answered the way AP-1's `lineCurrencyOptions` answers them.
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

test("the options are the brand's currencies and the destination's, baht last", () => {
  // KSI to Britain: both arms say GBP, and it is listed once.
  assert.deepEqual(bookingCurrencyOptions(KSI, "GB"), ["GBP", "THB"]);
  // KSI at home: the destination arm says nothing, the brand's books say GBP.
  // This is the case the destination-only rule got wrong.
  assert.deepEqual(bookingCurrencyOptions(KSI, "TH"), ["GBP", "THB"]);
  assert.deepEqual(bookingCurrencyOptions(PCMY, "MY"), ["MYR", "THB"]);
  assert.deepEqual(bookingCurrencyOptions(PCMY, "TH"), ["MYR", "THB"]);
});

/**
 * Baht sits **last and is still the default**, which are two separate questions.
 * AP-1's `lineCurrencyOptions` answers them the same way — `[currency, THB]`
 * (`claim-currency.ts:233-237`) — and so does the control the request arrived
 * with, which renders `GBP | THB` with THB selected.
 */
test("baht is last in the list and still what an absent choice resolves to", () => {
  const options = bookingCurrencyOptions(KSI, "GB");
  assert.equal(options[options.length - 1], "THB");
  assert.equal(effectiveBookingCurrency(null, KSI, "GB"), "THB");
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
  assert.deepEqual(bookingCurrencyOptions(PCTH, "GB"), ["GBP", "THB"]);
  assert.deepEqual(bookingCurrencyOptions(null, "JP"), ["JPY", "THB"]);
});

test("a brand's several currencies are all offered, before baht", () => {
  const multi = { currencies: [entry("GBP", true, 1), entry("MYR", true, 2)] };
  assert.deepEqual(bookingCurrencyOptions(multi, "TH"), ["GBP", "MYR", "THB"]);
  // The destination's own leads the foreign ones: it is the likeliest answer for
  // an invoice raised where the trip actually went.
  assert.deepEqual(bookingCurrencyOptions(multi, "MY"), ["MYR", "GBP", "THB"]);
});

test("a disabled brand row is not offered, and a THB row is never listed twice", () => {
  assert.deepEqual(bookingCurrencyOptions({ currencies: [entry("GBP", false)] }, "TH"), []);
  assert.deepEqual(bookingCurrencyOptions(PCMY, "TH"), ["MYR", "THB"]);
});

/**
 * A brand row naming a currency the rate source cannot quote is **droppable and
 * dropped**. `isRateSourceCurrency` gates the settings editor's add path and
 * nothing else — `parseBrandCurrencyToggle` checks only the id and the flag, and
 * migration 127 backfilled `CurrencyCode` from `BrandSetting` with no CHECK — so
 * such a row can exist and be switched back on. Offering it would let the desk
 * pick a currency whose every save throws `BOOKING_FX_UNAVAILABLE_ERROR`, under
 * a message inviting a retry that can never work.
 */
test("a brand currency the rate source cannot quote is not offered", () => {
  const legacy = { currencies: [entry("ZWL", true, 1), entry("GBP", true, 2)] };
  assert.deepEqual(bookingCurrencyOptions(legacy, "TH"), ["GBP", "THB"]);
  assert.deepEqual(bookingCurrencyOptions({ currencies: [entry("ZWL", true)] }, "TH"), []);
  assert.equal(effectiveBookingCurrency("ZWL", legacy, "TH"), "THB");
});

test("codes are normalised", () => {
  assert.deepEqual(
    bookingCurrencyOptions({ currencies: [entry(" gbp ", true)] }, " th "),
    ["GBP", "THB"],
  );
  assert.deepEqual(bookingCurrencyOptions(PCTH, "gb"), ["GBP", "THB"]);
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
