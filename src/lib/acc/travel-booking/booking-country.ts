import { effectiveClaimCountry } from "@/features/accounting/lib/claim-currency";
import type { BrandCurrencyEntry } from "@/lib/acc/currency";

/**
 * Which country an AP-17 trip is filed as.
 *
 * Imports only `isKnownCountry`, from a module that imports nothing at all, so
 * this is unit-testable with no environment and safe in the client bundle.
 *
 * ── It is the brand that decides, and AP-1's rule is the one used ──
 *
 * The form offers the countries the brand's `BrandCurrency` rows imply, through
 * AP-1's `claimCountryOptions`; this resolves the posted value through AP-1's
 * `effectiveClaimCountry`, against the same brand. **One rule, called from two
 * forms** — not a second copy that drifts.
 *
 * That the resolution is brand-scoped is what keeps the screen and the database
 * agreeing. The form seeds no country until somebody clicks one, so a new trip
 * posts `null` while showing the brand's default as selected; resolving `null`
 * against the brand is what makes the stored value the country the requester was
 * looking at. A plain "is this a country we know" test would store Thailand
 * instead, and per-diem-by-country would then price the trip on a country
 * nobody chose.
 *
 * ── Why it never throws ──
 *
 * The value is bound to `AccRequest.CountryCode CHAR(2)`, which will happily
 * store `XX`, and per-diem-by-country then looks up a rate for whatever is in
 * there. `effectiveClaimCountry` answers only a country the brand offers, so an
 * unrecognised code, or one the brand has since stopped offering, resolves to
 * something real rather than raising — and a trip whose brand offers nothing at
 * all is Thailand, the allowance it would have had before any of this existed.
 */

/** ISO-3166-1 alpha-2 for Thailand — where a trip is unless somebody says otherwise. */
export const BOOKING_DEFAULT_COUNTRY = "TH";

export function resolveBookingCountry(
  posted: string | null | undefined,
  brand: { currencies: BrandCurrencyEntry[] } | null | undefined,
): string {
  return effectiveClaimCountry(posted, brand);
}
