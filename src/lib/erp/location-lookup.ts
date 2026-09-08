/**
 * Read side of the Location sync: what BU a journal line's branch belongs to.
 *
 * Codeunit 50263 writes `COCO` into the BU dimension whenever the payload sends
 * no `buCode`. That was every line of every AP-2 and AP-3 journal, and it is
 * wrong for 121 of the 341 Locations across the four interface brands. This is
 * what the journal builder consults instead.
 */

import { getErpDataPool, sql } from "@/lib/db/mssql";
import { buildBranchBuMap, type LocationBuRow } from "./location-lookup-core";

export type BranchBuMap = ReadonlyMap<string, string>;

/**
 * One brand's active branch → BU map.
 *
 * Loaded whole and once per send rather than queried per line: a clearing has a
 * handful of lines and the brand has a few hundred Locations, so one read beats
 * one round trip per line.
 *
 * A brand whose Locations have never been synced returns an empty map, and every
 * line then sends no `buCode` — exactly today's behaviour. Nothing regresses
 * because the sync has not been run yet.
 */
export async function loadBranchBuMap(brandCode: string | null | undefined): Promise<BranchBuMap> {
  const code = brandCode?.trim().toUpperCase();
  if (!code) return new Map();

  const pool = await getErpDataPool();
  const res = await pool
    .request()
    .input("brand", sql.NVarChar, code)
    .query(`
      SELECT BranchCode, BuCode
      FROM [dbo].[ErpLocation]
      WHERE BrandCode = @brand AND IsActive = 1 AND BranchCode IS NOT NULL AND BuCode IS NOT NULL
    `);

  // Map the columns across explicitly. `recordset` carries the SELECT's own
  // PascalCase keys, so casting it straight to LocationBuRow type-checks and
  // then reads `undefined` from every row — an empty map, every line silently
  // back on the COCO default, and nothing to show for it.
  const rows: LocationBuRow[] = (res.recordset as Record<string, unknown>[]).map((r) => ({
    branchCode: (r.BranchCode as string | null) ?? null,
    buCode: (r.BuCode as string | null) ?? null,
  }));
  return buildBranchBuMap(rows);
}
