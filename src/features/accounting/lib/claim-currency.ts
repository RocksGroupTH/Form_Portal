/**
 * The two claim-currency rules AP-1's form and its submit validation must agree
 * on, in one place so they cannot drift.
 *
 * It imports only `@/lib/acc/currency`, which imports nothing at all. That
 * matters twice over: the form is a client component, so anything reaching a
 * pool would drag `next/headers` into the browser bundle (the hazard
 * `api-keys/codes.ts` records), and `@/env` validates the whole environment at
 * import time, so anything reachable from a pool cannot be unit-tested either.
 *
 * In particular it does **not** import `@/lib/acc/fx`. `needsRate(c)` there is
 * `!isBaht(c)`, the same predicate — but `fx.ts` pulls in `bot-fx.ts` and the
 * network with it, and neither the picker nor `validateForSubmit` needs a rate
 * to know a claim is foreign.
 */

import { isBaht, THB } from "@/lib/acc/currency";

/**
 * Whether a rate-based (บาท/กม.) vehicle may be used on a claim in this
 * currency.
 *
 * It may not, and the reason is in the database rather than in taste:
 * `CK_AccVehicle_Rate` refuses `RatePerKm < 1`, and the rate is **one shared
 * row** on `AccVehicle` labelled `บาท/กม.` — there is nowhere to put a second,
 * per-currency rate and no rate below 1 can be expressed at all. So a claim in
 * MYR multiplying kilometres by a baht-per-km figure would be nonsense stated
 * in the wrong unit.
 *
 * Manual-entry vehicles are unaffected: the requester types the fare, in
 * whatever currency the claim is in.
 */
export function rateVehicleAllowed(currency: string | null | undefined): boolean {
  return isBaht(currency);
}

/** Shown under the vehicle picker while a foreign currency is selected. */
export const RATE_VEHICLE_FOREIGN_NOTE =
  "คำขอสกุลเงินต่างประเทศต้องเลือกพาหนะแบบกรอกเอง — พาหนะที่คิดตามระยะทาง (บาท/กม.) ใช้เรทเป็นเงินบาทเท่านั้น";

/** The submit-time refusal, per travel day. A control removed from a page is not a rule. */
export const RATE_VEHICLE_FOREIGN_ERROR =
  "คำขอสกุลเงินต่างประเทศใช้พาหนะที่คิดตามระยะทาง (บาท/กม.) ไม่ได้ — กรุณาเลือกพาหนะแบบกรอกเอง";

/**
 * The currencies a claim against this brand may be entered in, in the order the
 * picker offers them.
 *
 * An empty array means **render nothing**: a brand with no currency configured
 * has to leave the form exactly as it looked before this feature shipped, which
 * a one-option dropdown would not. `brandCurrencyState` in `@/lib/acc/currency`
 * is what decides that, and this defers to it rather than re-deriving the rule.
 *
 * Baht is second, not first, because the brand's own currency is the reason
 * anybody configured it — but baht is the *default*, which is `defaultClaimCurrency`
 * below and deliberately not "the first option".
 */
export function claimCurrencyOptions(
  brand: { currencyCode: string | null; currencyEnabled: boolean } | null | undefined,
): string[] {
  if (!brand) return [];
  if (!brand.currencyEnabled) return [];
  const code = (brand.currencyCode ?? "").trim().toUpperCase();
  if (code === "" || code === THB) return [];
  return [code, THB];
}

/**
 * The currency a claim is actually in, given what the form holds and what the
 * brand offers.
 *
 * **Always baht unless the brand offers exactly this currency.** That is what
 * makes an admin switching `CurrencyEnabled` off recoverable rather than a trap:
 * a draft still holding `MYR` resolves to baht here, the form stops sending the
 * foreign code, and the next save succeeds. Without it the form would post a
 * currency the server refuses, with no control on screen to change it.
 */
export function effectiveClaimCurrency(
  selected: string | null | undefined,
  brand: { currencyCode: string | null; currencyEnabled: boolean } | null | undefined,
): string {
  const options = claimCurrencyOptions(brand);
  const want = (selected ?? "").trim().toUpperCase();
  if (want === "" || options.indexOf(want) === -1) return THB;
  return want;
}
