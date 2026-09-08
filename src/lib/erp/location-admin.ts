/**
 * Read side of the Location / BU settings tab: the rows an admin looks at, and
 * when the sync last ran. Separate from `location-lookup.ts`, which answers the
 * one narrow question the journal builder asks.
 */

import { getErpDataPool, sql } from "@/lib/db/mssql";

export interface AdminLocationRow {
  code: string;
  displayName: string | null;
  branchCode: string | null;
  buCode: string | null;
  departmentCode: string | null;
  /** The BRANCH dimension value is blocked in BC — the line would be refused. */
  isBranchBlocked: boolean;
  syncedAt: string | null;
}

export interface LocationSyncStatus {
  status: string;
  rowsUpserted: number;
  finishedAt: string | null;
  errorMessage: string | null;
}

/** One brand's active Locations, with the blocked flag joined from the BRANCH dimension. */
export async function listBrandLocations(brandCode: string): Promise<AdminLocationRow[]> {
  const code = brandCode.trim().toUpperCase();
  if (!code) return [];

  const pool = await getErpDataPool();
  const res = await pool
    .request()
    .input("brand", sql.NVarChar, code)
    .query(`
      SELECT
        l.Code, l.DisplayName, l.BranchCode, l.BuCode, l.DepartmentCode, l.SyncedAt,
        -- Joined, never stored: blocked belongs to the dimension value and moves
        -- on the dimension sync's own schedule. LEFT, and a missing row counts as
        -- open, so a brand whose dimension values have never synced does not show
        -- every branch as blocked.
        CAST(ISNULL(d.IsBlocked, 0) AS BIT) AS IsBranchBlocked
      FROM [dbo].[ErpLocation] l
      LEFT JOIN [dbo].[ErpDimensionValue] d
        ON d.BrandCode = l.BrandCode
       AND d.DimensionCode = 'BRANCH'
       AND d.Code = l.BranchCode
       AND d.IsActive = 1
      WHERE l.BrandCode = @brand AND l.IsActive = 1
      ORDER BY l.Code
    `);

  // Columns mapped across by hand. `recordset` carries the SELECT's PascalCase
  // keys, and casting it straight to the row type type-checks while every field
  // reads undefined.
  return (res.recordset as Record<string, unknown>[]).map((r) => ({
    code: String(r.Code ?? ""),
    displayName: (r.DisplayName as string | null) ?? null,
    branchCode: (r.BranchCode as string | null) ?? null,
    buCode: (r.BuCode as string | null) ?? null,
    departmentCode: (r.DepartmentCode as string | null) ?? null,
    isBranchBlocked: r.IsBranchBlocked === true || r.IsBranchBlocked === 1,
    syncedAt: r.SyncedAt instanceof Date ? r.SyncedAt.toISOString() : null,
  }));
}

/**
 * The most recent Location sync for a brand, successful or not.
 *
 * A failure is as worth showing as a success: without it the tab would display
 * yesterday's rows under a silent "last synced" and give no hint that today's
 * run threw.
 */
export async function getLastLocationSync(brandCode: string): Promise<LocationSyncStatus | null> {
  const code = brandCode.trim().toUpperCase();
  if (!code) return null;

  const pool = await getErpDataPool();
  const res = await pool
    .request()
    .input("brand", sql.NVarChar, code)
    .query(`
      SELECT TOP 1 Status, RowsUpserted, FinishedAt, ErrorMessage
      FROM [dbo].[ErpSyncLog]
      WHERE SyncType = 'LOCATIONS' AND BrandCode = @brand
      ORDER BY Id DESC
    `);

  const r = (res.recordset as Record<string, unknown>[])[0];
  if (!r) return null;
  return {
    status: String(r.Status ?? ""),
    rowsUpserted: Number(r.RowsUpserted ?? 0),
    finishedAt: r.FinishedAt instanceof Date ? r.FinishedAt.toISOString() : null,
    errorMessage: (r.ErrorMessage as string | null) ?? null,
  };
}
