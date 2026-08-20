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
 * Import-free on purpose. `department-map-service` opens a pool, and anything
 * that can reach a pool drags `@/env` into the test run, which validates the
 * whole environment at import time.
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

export interface LegacyClaimPurgeBounds {
  /**
   * The codes the purge may delete: uppercased, de-duplicated, in the caller's
   * order, with the target brand and any blank entry dropped.
   */
  codes: string[];
  /**
   * Entries refused because no brand of that code is enabled in AP-1, echoed
   * back as they were sent so the error can name them.
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
 * - anything else must name a brand that is enabled in AP-1 — the same
 *   `getAllowedBrands(AP1_FORM_CODE)` set the mapping page built the list from.
 *   Everything else lands in `rejected`, and the caller is expected to refuse
 *   the whole request rather than delete the subset it recognised.
 */
export function boundLegacyClaimCodes(
  legacyClaimCodes: unknown,
  targetBrandCode: string,
  allowedBrandCodes: string[],
): LegacyClaimPurgeBounds {
  const codes: string[] = [];
  const rejected: string[] = [];
  if (!Array.isArray(legacyClaimCodes)) return { codes, rejected };

  const target = String(targetBrandCode ?? "").trim().toUpperCase();
  const allowed: string[] = [];
  for (const raw of allowedBrandCodes) {
    const code = String(raw ?? "").trim().toUpperCase();
    if (code && allowed.indexOf(code) === -1) allowed.push(code);
  }

  for (const raw of legacyClaimCodes) {
    if (typeof raw !== "string") {
      rejected.push(String(raw));
      continue;
    }
    const code = raw.trim().toUpperCase();
    if (!code || code === target) continue;
    if (allowed.indexOf(code) === -1) {
      rejected.push(raw);
      continue;
    }
    if (codes.indexOf(code) === -1) codes.push(code);
  }

  return { codes, rejected };
}

/** What the caller is told when the list names a brand it may not clear. */
export function legacyClaimPurgeError(rejected: string[]): string {
  const named = rejected.slice(0, 10).join(", ");
  const more = rejected.length > 10 ? ` (+${rejected.length - 10})` : "";
  return `ล้าง mapping ของแบรนด์ที่ไม่ได้เปิดใช้ใน AP-1 ไม่ได้: ${named}${more}`;
}
