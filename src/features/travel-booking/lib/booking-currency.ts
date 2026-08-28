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
 * AP-1's requester **chooses** a currency, so an absent or unrecognised choice
 * there resolves to baht. AP-17 has no such choice to make: `TravelBookingTab`
 * carries no money field at all, the amounts are typed weeks later by the
 * booking desk, and the currency is therefore **derived from the request's
 * brand**. So `effectiveBookingCurrency` falls back to the brand's currency,
 * not to baht — the opposite of its AP-1 twin, and deliberately.
 *
 * Only an explicit `"THB"` opts out, which is what the desk's toggle posts when
 * the invoice in front of them is in baht despite the brand.
 */

import { enabledForeignCurrencies, isBaht, THB, type BrandCurrencyEntry } from "@/lib/acc/currency";

function norm(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase();
}

/** The shape both halves read a brand as — `RegistryBrand` and `AccBrandOption` both satisfy it. */
export interface BookingCurrencyBrand {
  currencies: readonly BrandCurrencyEntry[] | null | undefined;
}

/**
 * The currencies this request's booking figures may be recorded in, in the
 * order the desk's toggle offers them: the brand's own first, baht last.
 *
 * A brand may carry several (`BrandCurrency`, migration 127) and every enabled
 * one is offered. Baht is appended once, whether or not the brand also carries a
 * THB row — `enabledForeignCurrencies` drops that row precisely so it cannot be
 * listed twice.
 *
 * An empty array means **render nothing**. A brand with no currency configured
 * has to leave `AdminBookingPanel` pixel-identical to the day before this
 * shipped, which a one-option toggle would not. `enabledForeignCurrencies` in
 * `@/lib/acc/currency` owns that decision and this defers to it rather than
 * re-deriving the rule.
 *
 * The brand's first currency leads the list **and** is the default — unlike
 * AP-1, where baht is the default and the brand's currencies merely lead.
 */
export function bookingCurrencyOptions(
  brand: BookingCurrencyBrand | null | undefined,
): string[] {
  const foreign = enabledForeignCurrencies(brand?.currencies);
  if (foreign.length === 0) return [];
  return foreign.concat([THB]);
}

/**
 * The currency a request's booking figures are actually recorded in.
 *
 * **Absent means the brand's currency, not baht.** That is the whole difference
 * from `effectiveClaimCurrency`, and it is what lets the panel post nothing at
 * all while its brand list is still in flight and still have the server derive
 * the right answer — the case AP-1 had to guard against with `brandsKnown`,
 * because there an absent choice would silently re-price the claim as baht.
 *
 * `"THB"` is honoured whatever the brand says: it is the desk's deliberate
 * opt-out for an invoice that really is in baht.
 *
 * Anything else — a currency the brand does not carry, a typo, a forged body —
 * resolves to the brand's **first** currency rather than being accepted or
 * throwing. It can therefore never widen what a request may be recorded in
 * beyond the currencies its brand is configured for.
 *
 * A brand with nothing configured always answers baht, so an unconfigured brand
 * writes exactly the rows it wrote before this feature existed.
 */
export function effectiveBookingCurrency(
  selected: string | null | undefined,
  brand: BookingCurrencyBrand | null | undefined,
): string {
  const options = bookingCurrencyOptions(brand);
  if (options.length === 0) return THB;
  const want = norm(selected);
  if (want === THB) return THB;
  if (options.indexOf(want) !== -1) return want;
  return options[0];
}

/**
 * The word to put after a figure — `บาท`, or the currency code.
 *
 * Display only. Used for the four amount captions, the computed-total line and
 * the out-of-range toast, all of which said `บาท` unconditionally and would
 * otherwise caption a ringgit figure as baht on the one screen where the
 * distinction is being decided.
 */
export function bookingCurrencyWord(currency: string | null | undefined): string {
  return isBaht(currency) ? "บาท" : norm(currency);
}

/**
 * The reference-rate caption. **Never "อัตราแลกเปลี่ยนธนาคารแห่งประเทศไทย".**
 *
 * `BOT_API_CLIENT_ID` is deliberately unprovisioned (spec §9.1), so every rate
 * this app records comes from `bot-fx`'s keyless ECB fallback — a mid-market
 * reference rate, which is not what a bank settles at. Captioning it as a Bank
 * of Thailand rate would state something false on a screen accounting signs
 * off against.
 */
export function referenceRateNote(currency: string, rate: number): string {
  return `อัตราอ้างอิง 1 ${norm(currency)} = ${rate.toLocaleString("th-TH", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  })} บาท`;
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
