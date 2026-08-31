import { isKnownCountry } from "@/lib/acc/country-currency";

/**
 * Which country an AP-17 trip is filed as.
 *
 * Imports only `isKnownCountry`, from a module that imports nothing at all, so
 * this is unit-testable with no environment and safe in the client bundle.
 *
 * ── Why the constant is redefined rather than imported ──
 *
 * `features/accounting/lib/claim-currency.ts` exports a `DEFAULT_COUNTRY` with
 * the same value, and it is deliberately not reused. AP-1's is the tail of a
 * brand-scoped resolution — which countries a brand's configured currencies
 * admit — while AP-17's is a plain admission test over the whole list, because
 * AP-17's country does not choose a currency at all (the booking desk takes that
 * from the invoice). Sharing the constant would suggest the two rules travel
 * together, and the next person to change AP-1's would change AP-17's without
 * meaning to.
 *
 * ── Why it never throws ──
 *
 * The value is bound to `AccRequest.CountryCode CHAR(2)`, which will happily
 * store `XX`, and per-diem-by-country then looks up a rate for whatever is in
 * there. So an unrecognised code becomes Thailand rather than an error: a trip
 * is priced at the HR allowance it would have had before any of this existed,
 * which is the direction that costs nobody money.
 */

/** ISO-3166-1 alpha-2 for Thailand — where a trip is unless somebody says otherwise. */
export const BOOKING_DEFAULT_COUNTRY = "TH";

export function resolveBookingCountry(posted: string | null | undefined): string {
  const v = (posted ?? "").trim().toUpperCase();
  return isKnownCountry(v) ? v : BOOKING_DEFAULT_COUNTRY;
}
