/**
 * AP-17's booking-currency rules, in one import-free place so the panel, the
 * admin save and their tests cannot drift.
 *
 * It imports only `@/lib/acc/currency`, which imports nothing at all — the same
 * constraint `features/accounting/lib/claim-currency.ts` records: the panel is a
 * client component, so anything reaching a pool would drag `next/headers` into
 * the browser bundle, and `@/env` validates the whole environment at import, so
 * anything reachable from a pool cannot be unit-tested either. In particular it
 * does **not** import `@/lib/acc/fx`, which pulls in `bot-fx.ts` and the network.
 *
 * ── Why this is not `claim-currency.ts` with a different name ──
 *
 * AP-1's requester **chooses** a currency on each expense line, and the choice
 * is theirs because they are the one who spent the money. AP-17 has no such
 * field: `TravelBookingTab` carries no money at all, and the amounts are typed
 * weeks later by a booking desk reading an invoice. So the question here is not
 * "what did the requester pick" but "what is this invoice denominated in", and
 * the two are answered differently.
 *
 * ── The currency follows the BRAND *and* the DESTINATION, defaulting to baht ──
 *
 * Each source alone has been the whole answer at some point, and each was wrong:
 *
 * - **The brand alone**, until 2026-09-02, and it defaulted to the brand's own
 *   currency. KSI carries GBP, so a KSI desk booking a Bangkok hotel was offered
 *   GBP already selected and had to correct it on every domestic trip.
 * - **The destination alone**, for one commit on 2026-09-02. That fixed the
 *   default and broke the offer: a KSI trip to Bangkok was given no foreign
 *   option at all, and a KSI trip is commonly booked and billed through a UK
 *   account in pounds whatever the destination — leaving the desk unable to
 *   record the invoice actually in front of it.
 *
 * So the toggle is the **union** of the two. It is safe rather than merely
 * broad, and this is the reason: `AccRequest.CountryCode` is written through
 * `resolveBookingCountry` → `effectiveClaimCountry`, which admits only a country
 * in `claimCountryOptions(brand)` — a list itself derived from the brand's own
 * enabled currencies. For every country a request can actually hold, the
 * destination's currency is therefore **already one of the brand's**, so the
 * union cannot record a booking in money the company does not deal in. A test
 * asserts exactly that, so it fails rather than drifts if the bound is loosened.
 *
 * The destination arm still earns its place: it answers for a brand with no
 * currencies configured at all, and it is what the desk reads as the obvious
 * candidate for an invoice raised where the trip went.
 *
 * **Baht is the default, and it leads the toggle.** Almost every invoice this
 * desk handles is in baht — including on foreign trips booked through a Thai
 * agent — so baht is right by default and a foreign option is the exception.
 * It is also the only answer that needs no rate, which is why every refusal
 * below lands there.
 */

import { enabledForeignCurrencies, THB, type BrandCurrencyEntry } from "@/lib/acc/currency";
import { currencyForCountry } from "@/lib/acc/country-currency";
import { currencyWord, referenceRateNote } from "@/lib/acc/currency-display";

function norm(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase();
}

/** The shape both halves read a brand as — `RegistryBrand` and `AccBrandOption` both satisfy it. */
export interface BookingCurrencyBrand {
  currencies: readonly BrandCurrencyEntry[] | null | undefined;
}

/**
 * The currencies this request's booking figures may be recorded in, in the order
 * the desk's toggle offers them: **baht first**, then the destination's own
 * currency, then the brand's remaining ones.
 *
 * Baht leads because baht is the default, not merely an option — see
 * `effectiveBookingCurrency`. The destination's comes next among the foreign
 * ones because it is the likeliest answer for an invoice raised where the trip
 * went; the brand's others follow in the order an admin configured them.
 * Nothing is listed twice, which is the common case rather than an edge one —
 * a KSI trip to Britain has both arms saying GBP.
 *
 * An empty array means **render no toggle at all**, and it must keep meaning
 * that: a baht-only brand on a Thai trip leaves the booking card exactly as it
 * looked before any of this shipped, booking-number field full width. A brand
 * with nothing configured travelling nowhere in particular is the same answer,
 * and that is not an edge case either — `CountryCode` only arrived on
 * 2026-08-31, and most AP-17 requests that exist have never had one.
 *
 * Only the brand's **enabled** rows count, through `enabledForeignCurrencies`,
 * which also drops a `THB` row so baht cannot be listed a second time. Note that
 * baht is offered even to a brand that has switched Thailand off (migration
 * 131): that row answers "may a claim be *filed from* Thailand", where this
 * toggle answers "is the invoice on this desk denominated in baht" — a fact
 * about a document rather than a permission, and one that must stay recordable.
 */
export function bookingCurrencyOptions(
  brand: BookingCurrencyBrand | null | undefined,
  country: string | null | undefined,
): string[] {
  const out: string[] = [];
  const destination = currencyForCountry(country);
  if (destination !== null && destination !== THB) out.push(destination);
  const fromBrand = enabledForeignCurrencies(brand?.currencies);
  for (let i = 0; i < fromBrand.length; i++) {
    if (out.indexOf(fromBrand[i]) === -1) out.push(fromBrand[i]);
  }
  // Baht is prepended rather than appended, and only where there is something
  // to choose between: a lone THB pill is a control that cannot be operated.
  if (out.length === 0) return [];
  return [THB].concat(out);
}

/**
 * The currency a request's booking figures are actually recorded in.
 *
 * **Absent means baht** — the opposite of what this answered until 2026-09-02,
 * when it derived the answer from the brand. The booking desk types figures off
 * an invoice weeks after the request was filed, and almost every one of those
 * invoices is in baht, foreign trips included: they are commonly booked through
 * a Thai agent who bills in baht.
 *
 * Anything on neither arm — a code from another country, a currency the brand
 * does not carry, a typo, a stale page, a forged body — resolves to baht rather
 * than being accepted or throwing. Two properties follow, and both matter: a
 * request can never be recorded in money neither its books nor its destination
 * use, and every refusal lands on the one answer that needs no exchange rate, so
 * an FX outage can never turn a bad input into a save that cannot succeed.
 */
export function effectiveBookingCurrency(
  selected: string | null | undefined,
  brand: BookingCurrencyBrand | null | undefined,
  country: string | null | undefined,
): string {
  const options = bookingCurrencyOptions(brand, country);
  const want = norm(selected);
  if (want === THB || options.indexOf(want) === -1) return THB;
  return want;
}

/**
 * The word to put after a figure — `บาท`, or the currency code — and the
 * reference-rate caption.
 *
 * **Neither is defined here any more.** Task 12 needed both on AP-1's detail,
 * on the ERP prep queue and in both Excel exports, and the sentence saying the
 * rate is *not* a Bank of Thailand rate is the one thing that must never exist
 * twice — so the definitions moved to `@/lib/acc/currency-display`, which has no
 * feature in its import path. This file keeps the AP-17 name its eleven call
 * sites already read by.
 */
export { referenceRateNote };

export function bookingCurrencyWord(currency: string | null | undefined): string {
  return currencyWord(currency);
}

/**
 * Under the toggle: what the choice applies to, and when it is written.
 *
 * Kept to one short line because the toggle sits on every booking row of the
 * request — the control is per row, the value is per request, and saying so is
 * the whole job of this sentence. It deliberately does NOT explain where the
 * options came from: the desk's question is which currency this invoice is in,
 * and naming the brand and the country would answer a question nobody on this
 * screen is asking.
 */
export const BOOKING_CURRENCY_NOTE =
  "สกุลเงินนี้ใช้กับทุกรายการจองในคำขอนี้ และบันทึกเมื่อกด “บันทึกข้อมูลการจอง”";

/**
 * The save refusal when no rate can be had for a foreign request.
 *
 * Fail-closed, and only a foreign save ever reaches it: `needsRate` is false for
 * baht, so an FX outage cannot stop the ordinary Thai bookings that are almost
 * all of them.
 */
export const BOOKING_FX_UNAVAILABLE_ERROR =
  "ไม่สามารถดึงอัตราแลกเปลี่ยนได้ในขณะนี้ — กรุณาลองใหม่อีกครั้ง หรือเปลี่ยนสกุลเงินเป็นบาท";
