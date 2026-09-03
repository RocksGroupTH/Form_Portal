import { effectiveClaimCountry } from "@/features/accounting/lib/claim-currency";
import { isPerDiemCountry } from "@/lib/acc/travel-booking/perdiem-country";

/**
 * The set of per-diem-priced destinations across a request's tabs, as one
 * comparable string.
 *
 * It decides when the country rates are worth re-fetching, and it is built from
 * **`tabs` and `brands` alone — never from the estimates**. The estimates are
 * downstream of `countryRates`, which is exactly what the refetch this key
 * drives replaces; keying on them made "this cannot loop" a property that had to
 * be re-proved after every change to the attribution shape, and a later kind
 * that depended on the CONTENT of the rate list rather than only the country
 * would have reopened the cycle silently, as a refetch loop in production.
 * Keyed here, no such cycle can be written.
 *
 * The country resolves through `effectiveClaimCountry`, the same rule
 * `TravelBookingTab` marks a chip active with and the submit stores, so the key
 * describes what will actually be priced rather than what was typed.
 *
 * Thailand contributes nothing: `isPerDiemCountry` is false for it, so a
 * domestic form yields `""` and its caller fires no request.
 */

export interface DestinationTab {
  brandCode?: string | null;
  countryCode?: string | null;
}

/** The brand shape `effectiveClaimCountry` reads — `AccBrandOption` satisfies it. */
export interface DestinationBrand {
  brandCode: string;
  currencies?:
    | readonly {
        currencyCode: string;
        countryCode?: string | null;
        isEnabled: boolean;
        isDefault?: boolean;
      }[]
    | null;
}

export function destinationKeyFor(
  tabs: readonly DestinationTab[],
  brands: readonly DestinationBrand[],
): string {
  const codes: string[] = [];
  for (let i = 0; i < tabs.length; i++) {
    const t = tabs[i];
    let brand: DestinationBrand | null = null;
    if (t.brandCode) {
      for (let j = 0; j < brands.length; j++) {
        if (brands[j].brandCode === t.brandCode) {
          brand = brands[j];
          break;
        }
      }
    }
    const raw = t.brandCode
      ? effectiveClaimCountry(t.countryCode, brand as never)
      : t.countryCode ?? "";
    const c = (raw ?? "").trim().toUpperCase();
    if (isPerDiemCountry(c) && codes.indexOf(c) === -1) codes.push(c);
  }
  codes.sort();
  return codes.join(",");
}
