/**
 * Read side of the Location sync: what BU a journal line's branch belongs to,
 * and whether BC will accept that branch at all.
 *
 * Codeunit 50263 writes `COCO` into the BU dimension whenever the payload sends
 * no `buCode`. That was every line of every AP-2 and AP-3 journal, and it is
 * wrong for 121 of the 341 Locations across the four interface brands. This is
 * what the journal builder consults instead.
 */

import { getErpDataPool, sql } from "@/lib/db/mssql";
import { buildBranchLookup, type BranchLookupEntry, type LocationRow } from "./location-lookup-core";

export type BranchLookup = ReadonlyMap<string, BranchLookupEntry>;

/**
 * One brand's active branch → { BU, blocked } map.
 *
 * Loaded whole and once per send rather than queried per line: a clearing has a
 * handful of lines and the brand has a few hundred Locations, so one read beats
 * one round trip per line.
 *
 * A brand whose Locations have never been synced returns an empty map, and every
 * line then sends no `buCode` — exactly today's behaviour. Nothing regresses
 * because the sync has not been run yet.
 */
export async function loadBranchLookup(brandCode: string | null | undefined): Promise<BranchLookup> {
  const code = brandCode?.trim().toUpperCase();
  if (!code) return new Map();

  const pool = await getErpDataPool();
  const res = await pool
    .request()
    .input("brand", sql.NVarChar, code)
    .query(`
      SELECT
        l.BranchCode,
        l.BuCode,
        -- Blocked is read from the BRANCH dimension value, never copied into
        -- ErpLocation: it belongs to the dimension, changes on the dimension
        -- sync's own schedule, and a copy would be a second truth that goes
        -- stale between the two syncs.
        --
        -- LEFT JOIN, and a missing row counts as open. A brand whose dimension
        -- values have not been synced has no rows here at all, and treating
        -- that silence as "blocked" would flag every branch it has — absent
        -- data must not manufacture a warning.
        CAST(ISNULL(d.IsBlocked, 0) AS BIT) AS IsBranchBlocked
      FROM [dbo].[ErpLocation] l
      LEFT JOIN [dbo].[ErpDimensionValue] d
        ON d.BrandCode = l.BrandCode
       AND d.DimensionCode = 'BRANCH'
       AND d.Code = l.BranchCode
       AND d.IsActive = 1
      WHERE l.BrandCode = @brand AND l.IsActive = 1 AND l.BranchCode IS NOT NULL
    `);

  // Map the columns across explicitly. `recordset` carries the SELECT's own
  // PascalCase keys, so casting it straight to the row type type-checks and
  // then reads `undefined` from every row — an empty map, every line silently
  // back on the COCO default, and nothing to show for it.
  const rows: LocationRow[] = (res.recordset as Record<string, unknown>[]).map((r) => ({
    branchCode: (r.BranchCode as string | null) ?? null,
    buCode: (r.BuCode as string | null) ?? null,
    isBranchBlocked: r.IsBranchBlocked === true || r.IsBranchBlocked === 1,
  }));
  return buildBranchLookup(rows);
}
