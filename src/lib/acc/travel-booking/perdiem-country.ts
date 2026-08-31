import type { AllowanceLogEntry } from "./perdiem";

/**
 * Which effective-dated log prices a trip: the country's, or the employee's.
 *
 * Pure. Its only import is a type, which is erased, so this is unit-testable
 * with no environment and safe in the client bundle — the live estimate on the
 * form calls it as well as the submit, the recompute and the report.
 *
 * ── The rule ──
 *
 * A country with at least one active rate prices every day of a trip that goes
 * there. A country with none — which is every country on the day this ships —
 * falls back to `Rocks_Portal_HR.EmployeeAllowanceLog`, the per-employee
 * allowance AP-17 has always used. Thailand is never a per-diem country: it is
 * where the HR log applies by definition, and a `TH` row would be a second
 * answer to a question that already has one.
 *
 * ── Why null and not an empty array ──
 *
 * `rateForDay` returns **0** for a day it cannot match (`perdiem.ts:24-33`). So
 * an empty log does not mean "no rate configured", it means "this day is worth
 * nothing" — and the two must never be confused on a path that writes
 * `AccRequest.TotalAmount`. `perDiemCountryLog` therefore answers `null` for a
 * country nobody has configured, and `perDiemLogFor` reads that as "use the
 * employee's". It never returns `[]` to mean the same thing.
 *
 * ── Why `source` is returned ──
 *
 * Not decoration. The form's note, the report's rate column and the recompute's
 * audit row all have to state which rate applied, and each of them deriving it
 * again from the country code is three chances to disagree with the figure that
 * was actually stored.
 */

export interface PerDiemCountryRate {
  countryCode: string;
  /** 'YYYY-MM-DD', inclusive. */
  effectiveDate: string;
  /** Thai baht per day. Always > 0 — the table's CHECK, and see the header. */
  amount: number;
}

/** Where the employee's own HR allowance applies, and no country rate ever does. */
export const PER_DIEM_HOME_COUNTRY = "TH";

function code(raw: string | null | undefined): string {
  return (raw ?? "").trim().toUpperCase();
}

/**
 * Whether a country can carry a per-diem rate at all.
 *
 * False for blank, for anything that is not two letters, and for Thailand.
 */
export function isPerDiemCountry(raw: string | null | undefined): boolean {
  const c = code(raw);
  return /^[A-Z]{2}$/.test(c) && c !== PER_DIEM_HOME_COUNTRY;
}

/**
 * This country's effective-dated log, or `null` meaning "fall back to the
 * employee's". Never an empty array — see the header.
 *
 * The caller supplies active rows only; nothing is filtered here but the
 * country. The result is a fresh array, because the recompute path hands one
 * rate list to several trips in a group and sorting in place would reorder
 * somebody else's.
 */
export function perDiemCountryLog(
  countryCode: string | null | undefined,
  rates: readonly PerDiemCountryRate[],
): AllowanceLogEntry[] | null {
  if (!isPerDiemCountry(countryCode)) return null;
  const c = code(countryCode);

  const mine: AllowanceLogEntry[] = [];
  for (const r of rates) {
    if (code(r.countryCode) !== c) continue;
    mine.push({ effectiveDate: r.effectiveDate, amount: r.amount });
  }
  if (mine.length === 0) return null;

  mine.sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : a.effectiveDate > b.effectiveDate ? 1 : 0));
  return mine;
}

/**
 * The one decision. Every consumer of `computePerDiem` / `rateForDay` goes
 * through here, so the estimate on the form, the figure written at submit, the
 * figure a cancellation recomputes and the rate the report prints cannot
 * disagree about which log applied.
 */
export function perDiemLogFor(
  countryCode: string | null | undefined,
  employeeLog: readonly AllowanceLogEntry[],
  rates: readonly PerDiemCountryRate[],
): { log: AllowanceLogEntry[]; source: "country" | "employee"; countryCode: string | null } {
  const country = perDiemCountryLog(countryCode, rates);
  if (country) return { log: country, source: "country", countryCode: code(countryCode) };
  // The employee's log is handed back as it came: it is the caller's, nothing
  // here reorders it, and copying it per trip in a group would be waste.
  return { log: employeeLog as AllowanceLogEntry[], source: "employee", countryCode: null };
}
