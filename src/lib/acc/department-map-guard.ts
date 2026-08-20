/**
 * What a department-mapping save is allowed to delete.
 *
 * `saveDepartmentMappings` accepts a `legacyClaimCodes` list and, once the
 * upserts are done, runs `DELETE FROM [dbo].[DepartmentErpMap] WHERE BrandCode
 * = @brand` once per entry. The list is how the mapping dialog says "these
 * claim brands used to keep their own rows; the target brand owns them now" —
 * and it arrives in the request body, unvalidated. Nothing bounded it, so one
 * `PUT` naming every brand code emptied the table for *every* brand.
 *
 * That table is not this app's alone: `DepartmentErpMap` lives in the shared
 * configuration database, and both the Rocks Fast and ACC Portal siblings read
 * it from their own `erp-prep-service.ts` — the path that prepares financial
 * journal postings. Parameterized SQL made it not an injection; it was an
 * unbounded delete against targets the caller was never authorized for. This
 * module is the bound, and it applies to an admin too: nobody should be able to
 * wipe three applications' department mappings by sending the wrong array.
 *
 * **The bound is the target's own claim brands, not the AP-1 allowlist.** It
 * was the allowlist for one round, which bounded nothing that matters: every
 * claim brand is in it, so a single `PUT` naming all of them still purged every
 * brand but the target — the exact shape the paragraph above says is fixed. The
 * list a save may clear is the claim brands whose ERP interface target *is*
 * this target, which is also precisely what the dialog sends
 * (`DepartmentMappingDialog.tsx`, from `AccBrandErpInterface`). Anything else
 * names rows this save has no claim on.
 *
 * Import-free on purpose. `department-map-service` opens a pool, and anything
 * that can reach a pool drags `@/env` into the test run, which validates the
 * whole environment at import time. `claimCodesForInterfaceTarget` therefore
 * takes the rows rather than fetching them.
 */

/**
 * The payload named a brand this save may not write or clear. → 400.
 *
 * Its own class rather than a bare `Error` so the route can answer 400 without
 * matching on the message, and so a driver failure — which is a 500 — stays
 * distinguishable from a rejected body.
 */
export class DepartmentMapBoundsError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = "DepartmentMapBoundsError";
  }
}

/** The shape of one `AccBrandErpInterface` row, structurally. */
export interface ClaimToInterfaceTarget {
  brandCode: string;
  interfaceBrandCode: string;
}

/**
 * The claim brands whose ERP interface target is `targetBrandCode` — the only
 * brands a save against that target may clear.
 *
 * Uppercased and de-duplicated, in row order. The target itself is kept when a
 * row maps it to itself (a brand may be its own interface target); it is
 * `boundLegacyClaimCodes` that skips the target, and it does so whether or not
 * such a row exists.
 */
export function claimCodesForInterfaceTarget(
  maps: ClaimToInterfaceTarget[],
  targetBrandCode: string,
): string[] {
  const target = String(targetBrandCode ?? "").trim().toUpperCase();
  const out: string[] = [];
  if (!target) return out;

  for (const m of maps) {
    const claim = String(m?.brandCode ?? "").trim().toUpperCase();
    const to = String(m?.interfaceBrandCode ?? "").trim().toUpperCase();
    if (!claim || to !== target) continue;
    if (out.indexOf(claim) === -1) out.push(claim);
  }
  return out;
}

export interface LegacyClaimPurgeBounds {
  /**
   * The codes the purge may delete: uppercased, de-duplicated, in the caller's
   * order, with the target brand and any blank entry dropped.
   */
  codes: string[];
  /**
   * Entries refused because no claim brand of that code points at this target,
   * echoed back as they were sent so the error can name them.
   */
  rejected: string[];
}

/**
 * Narrow a client-supplied `legacyClaimCodes` list to the brands the caller may
 * actually clear.
 *
 * - a non-array (absent, a bare string, an object) purges nothing — a malformed
 *   field must never be iterated, least of all a string, which `for…of` would
 *   walk one character at a time and turn into a delete per letter;
 * - a blank entry, or the target brand itself, is skipped rather than refused:
 *   the old loop already ignored both, and the target's own rows are what the
 *   save just wrote;
 * - anything else must be a claim brand of *this* target — the
 *   `claimCodesForInterfaceTarget` list, which is the same set the mapping
 *   dialog built its group from. Everything else lands in `rejected`, and the
 *   caller is expected to refuse the whole request rather than delete the
 *   subset it recognised.
 */
export function boundLegacyClaimCodes(
  legacyClaimCodes: unknown,
  targetBrandCode: string,
  purgeableClaimCodes: string[],
): LegacyClaimPurgeBounds {
  const codes: string[] = [];
  const rejected: string[] = [];
  if (!Array.isArray(legacyClaimCodes)) return { codes, rejected };

  const target = String(targetBrandCode ?? "").trim().toUpperCase();
  const purgeable: string[] = [];
  for (const raw of purgeableClaimCodes) {
    const code = String(raw ?? "").trim().toUpperCase();
    if (code && purgeable.indexOf(code) === -1) purgeable.push(code);
  }

  for (const raw of legacyClaimCodes) {
    if (typeof raw !== "string") {
      rejected.push(String(raw));
      continue;
    }
    const code = raw.trim().toUpperCase();
    if (!code || code === target) continue;
    if (purgeable.indexOf(code) === -1) {
      rejected.push(raw);
      continue;
    }
    if (codes.indexOf(code) === -1) codes.push(code);
  }

  return { codes, rejected };
}

/**
 * What the caller is told when the list names a brand it may not clear.
 *
 * It names the brands and the remedy: the honest cause is a claim → target
 * mapping that changed after the dialog loaded its groups, and reloading is the
 * whole fix.
 */
export function legacyClaimPurgeError(rejected: string[]): string {
  const named = rejected.slice(0, 10).join(", ");
  const more = rejected.length > 10 ? ` (+${rejected.length - 10})` : "";
  return `ล้าง mapping ของแบรนด์ที่ไม่ได้ผูกกับแบรนด์ปลายทางนี้ไม่ได้: ${named}${more} กรุณาโหลดหน้านี้ใหม่แล้วลองอีกครั้ง`;
}
