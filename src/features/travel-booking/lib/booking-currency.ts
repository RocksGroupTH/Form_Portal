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
 * ── The currency follows the DESTINATION, and defaults to baht ──
 *
 * Until 2026-09-02 it followed the request's **brand** and defaulted to that
 * brand's own currency. Both were wrong, and for one reason: a brand is a set
 * of books, not a place. KSI carries GBP, so a KSI desk booking a Bangkok hotel
 * was offered GBP first and had to correct it on every domestic trip; and a
 * PCTH trip to London was offered no foreign currency at all, because PCTH
 * carries only THB. The destination answers both cases correctly with no
 * configuration at all.
 *
 * **Baht is the default, and it leads the toggle.** Almost every invoice this
 * desk handles is in baht — including on foreign trips booked through a Thai
 * agent — so baht is right by default and the foreign option is the exception.
 * It is also the only answer that needs no rate, which is why every refusal
 * below lands there.
 */

import { THB } from "@/lib/acc/currency";
import { currencyForCountry } from "@/lib/acc/country-currency";
import { currencyWord, referenceRateNote } from "@/lib/acc/currency-display";

function norm(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase();
}

/**
 * The currencies this request's booking figures may be recorded in, in the
 * order the desk's toggle offers them: **baht first**, the destination's
 * currency second.
 *
 * An empty array means **render nothing**, and that is the domestic case — a
 * Thai trip has one possible currency, and a one-option toggle would be a
 * control that cannot be operated. It is also what an **unset** country gives,
 * which is not an edge case: `AccRequest.CountryCode` only arrived on
 * 2026-08-31, and five of the six AP-17 requests that exist have never had one.
 * Those keep the panel exactly as it looked before any of this shipped.
 *
 * Baht leads because baht is the default, not merely an option — see
 * `effectiveBookingCurrency`. The order here and the fallback there are the
 * same decision written twice, so the tests assert them against each other.
 *
 * **No brand is consulted, and that is the point.** The old version read the
 * brand's `BrandCurrency` rows, which meant a KSI desk was offered GBP on a
 * Bangkok hotel and a PCTH desk was offered nothing at all on a London one. A
 * destination needs no configuration to answer both correctly.
 */
export function bookingCurrencyOptions(country: string | null | undefined): string[] {
  const currency = currencyForCountry(country);
  if (currency === null || currency === THB) return [];
  return [THB, currency];
}

/**
 * The currency a request's booking figures are actually recorded in.
 *
 * **Absent means baht** — the opposite of what this answered until 2026-09-02,
 * and the opposite of AP-17's original design, which derived it from the brand.
 * The booking desk types figures off an invoice weeks after the request was
 * filed, and almost every one of those invoices is in baht, foreign trips
 * included: they are commonly booked through a Thai agent who bills in baht.
 *
 * Anything that is not this destination's currency — a code from another
 * country, a typo, a stale page, a forged body — resolves to baht rather than
 * being accepted or throwing. Two properties follow, and both matter: a request
 * can never be recorded in a currency its destination does not use, and every
 * refusal lands on the one answer that needs no exchange rate, so an FX outage
 * can never turn a bad input into a save that cannot succeed.
 */
export function effectiveBookingCurrency(
  selected: string | null | undefined,
  country: string | null | undefined,
): string {
  const options = bookingCurrencyOptions(country);
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
 * the whole job of this sentence.
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
