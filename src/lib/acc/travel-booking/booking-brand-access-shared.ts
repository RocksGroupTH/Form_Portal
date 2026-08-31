/**
 * Which brands an AP-17 approver may see — the pure half.
 *
 * **Imports nothing at all.** AP-1's counterpart
 * (`approver-interface-access-shared.ts`) imports `ERP_INTERFACE_BRANDS` because
 * its vocabulary is a closed constant; AP-17's vocabulary is `AccFormBrand`
 * rows, which cannot be known without a database read. That difference has one
 * consequence worth stating outright: **`allAccess` is a boolean that
 * short-circuits and must never be expanded into a list of every brand**, and
 * there is deliberately no counterpart to `filterInterfaceBrandCodes`.
 *
 * ── No rows means every brand ──
 *
 * The opposite of `AccBookingApproverTab` and `AccReimburseAccess`, where empty
 * means none. Those hand out something new; this NARROWS a permission the people
 * on the roster already have. Measured 2026-08-31, all four active approvers see
 * every AP-17 request, so "empty = none" would blind all four the day it
 * deployed. Migration 134's header records the same reading, as does 038's for
 * AP-1's equivalent.
 *
 * Scoping is a filter on top of membership, never a substitute for it:
 * `canAccessBookingArea` still decides whether somebody may reach the area at
 * all, and this decides which of its rows they see.
 */

export interface BookingBrandAccess {
  /** true = no rows for this approver, or an admin — every brand. */
  allAccess: boolean;
  /** Uppercase brand codes, when scoped. Meaningless while `allAccess`. */
  allowedCodes: string[];
}

/**
 * `none` is a distinct kind rather than `codes: []`, and that is the point.
 *
 * A caller building SQL from an empty code list emits `IN ()`, which is a syntax
 * error; a caller writing `codes.length === 0 ? allow : filter` turns an empty
 * scope into unrestricted access — an escalation, silently. Making the empty
 * case unrepresentable is what stops both, rather than a comment asking callers
 * to remember.
 */
export type BookingBrandScope =
  | { kind: "all" }
  | { kind: "none" }
  | { kind: "codes"; codes: string[] };

/** What an actor scoped out of a request is told. Deliberately names no brand. */
export const BOOKING_BRAND_SCOPE_ERROR = "ไม่มีสิทธิ์ในแบรนด์ของคำขอนี้";

export function normalizeBrandCode(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase();
}

/** Trim, uppercase, drop blanks, de-duplicate, sort. `Array.from`, never a spread (ES5 target). */
export function normalizeBrandCodes(codes: readonly (string | null | undefined)[]): string[] {
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (const raw of codes) {
    const c = normalizeBrandCode(raw);
    if (!c || seen[c]) continue;
    seen[c] = true;
    out.push(c);
  }
  out.sort();
  return out;
}

export function bookingBrandScope(access: BookingBrandAccess): BookingBrandScope {
  if (access.allAccess) return { kind: "all" };
  const codes = normalizeBrandCodes(access.allowedCodes);
  return codes.length === 0 ? { kind: "none" } : { kind: "codes", codes };
}

/**
 * May this actor act on a request filed under this brand?
 *
 * A request with **no brand** is refused while scoped and allowed while
 * unscoped. That is not theoretical: an AP-17 request saved before the brand
 * became required carries `BrandCode` NULL, and an unbranded request cannot be
 * shown to belong to a scoped actor's brand.
 */
export function canActOnBookingBrand(
  access: BookingBrandAccess,
  brandCode: string | null | undefined,
): boolean {
  if (access.allAccess) return true;
  const code = normalizeBrandCode(brandCode);
  if (!code) return false;
  return normalizeBrandCodes(access.allowedCodes).indexOf(code) >= 0;
}

/**
 * Filter a list of rows to what this actor may see.
 *
 * `{ allAccess: false, allowedCodes: [] }` — what a non-approver resolves to —
 * filters everything out. It must be a refusal rather than a wave-through, which
 * is the same rule AP-1's equivalent records.
 */
export function filterRowsForBookingBrandAccess<T extends { brandCode: string | null }>(
  rows: readonly T[],
  access: BookingBrandAccess,
): T[] {
  if (access.allAccess) return rows.slice();
  const allowed = normalizeBrandCodes(access.allowedCodes);
  const out: T[] = [];
  for (const row of rows) {
    const code = normalizeBrandCode(row.brandCode);
    if (code && allowed.indexOf(code) >= 0) out.push(row);
  }
  return out;
}
