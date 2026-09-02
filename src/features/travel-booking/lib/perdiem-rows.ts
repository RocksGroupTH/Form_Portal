import { PER_DIEM_HOME_COUNTRY } from "@/lib/acc/travel-booking/perdiem-country";

/**
 * Which countries the เบี้ยเลี้ยงต่างประเทศ tab lists, and what each row starts
 * from.
 *
 * The tab used to be an empty grid behind an "เพิ่มเรท" button: an admin pressed
 * it, chose a country from a dialog, and saved. It now lists the countries up
 * front and each is saved on its own, which turns "which countries get a row"
 * into a rule worth writing down and testing rather than a rendering detail.
 *
 * Two sources, pulling opposite ways. The **reachable** countries are what a
 * trip can be filed against today, derived from the brands' own `BrandCurrency`
 * rows; the **stored** ones are wherever a rate already exists. Listing only the
 * first would hide a live rate the moment a brand dropped a currency — nothing
 * unprices the trips already filed against it — and listing only the second
 * leaves the tab as empty as the screen this replaced.
 *
 * Imports one constant and nothing else, so it is unit-testable: anything
 * reachable from a pool drags `@/env` in, which validates the whole environment
 * at import.
 */

export interface PerDiemRateLike {
  id: number;
  countryCode: string;
  /** `YYYY-MM-DD`. */
  effectiveDate: string;
  amount: number;
  note: string | null;
  isActive: boolean;
}

export interface PerDiemCountryRow {
  countryCode: string;
  /** False for a country that only appears because a rate already exists for it. */
  reachable: boolean;
  /**
   * The rate in force — the newest **active** one, or null.
   *
   * Active, because pricing only ever sees active rates
   * (`listPerDiemCountryRates` filters `IsActive = 1`), so a newer deactivated
   * rate is not what any trip is priced at and must not be what the row offers
   * for editing.
   */
  latest: PerDiemRateLike | null;
  /** Every rate for this country, newest first — the current one before the ones it replaced. */
  history: PerDiemRateLike[];
}

function norm(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase();
}

export function perDiemCountryRows(
  reachable: readonly string[],
  rates: readonly PerDiemRateLike[],
): PerDiemCountryRow[] {
  const byCountry: Record<string, PerDiemRateLike[]> = {};
  for (const r of rates) {
    const code = norm(r.countryCode);
    // Thailand never gets a row: the HR allowance answers there and
    // `upsertPerDiemCountryRate` refuses a TH row, so the control's every save
    // would fail. A stored TH row could only come from a direct SQL edit.
    if (code === "" || code === PER_DIEM_HOME_COUNTRY) continue;
    if (!byCountry[code]) byCountry[code] = [];
    byCountry[code].push({ ...r, countryCode: code });
  }

  const offered: string[] = [];
  const seen: Record<string, true> = {};
  for (const raw of reachable) {
    const code = norm(raw);
    if (code === "" || code === PER_DIEM_HOME_COUNTRY || seen[code]) continue;
    seen[code] = true;
    offered.push(code);
  }
  offered.sort();

  // Whatever has a rate but is no longer offered, after the offered ones — so
  // the list reads as the form's own countries first, with the leftovers plain
  // to see rather than mixed in.
  const stranded = Object.keys(byCountry).filter((c) => !seen[c]);
  stranded.sort();

  const out: PerDiemCountryRow[] = [];
  for (const code of offered.concat(stranded)) {
    const history = (byCountry[code] ?? []).slice();
    history.sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : a.effectiveDate > b.effectiveDate ? -1 : 0));
    let latest: PerDiemRateLike | null = null;
    for (const h of history) {
      if (h.isActive) { latest = h; break; }
    }
    out.push({ countryCode: code, reachable: !!seen[code], latest, history });
  }
  return out;
}
