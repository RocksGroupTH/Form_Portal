/**
 * Telling a UAT record from a production one by its id.
 *
 * Migration 061 reseeds every transactional identity in the UAT form database
 * to 900000, so ids never collide across the two databases and a row's id alone
 * says which one it came from. Reads that merge both databases tag their rows
 * with `environment` and should use that; a detail page loads a single row
 * through the form's own pool and has nothing else to go on.
 *
 * "At or above": on an empty table DBCC CHECKIDENT RESEED makes the first row
 * 900000 itself, not 900001.
 *
 * Pure and client-safe — no request context, no I/O. Import this leaf module
 * rather than the package index, which pulls in next/headers.
 */

export const UAT_IDENTITY_SEED = 900000;

export function isUatId(id: number | null | undefined): boolean {
  return typeof id === "number" && Number.isFinite(id) && id >= UAT_IDENTITY_SEED;
}
