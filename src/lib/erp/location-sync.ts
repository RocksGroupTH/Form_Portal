/**
 * Sync Business Central Locations into `Rocks_ERP_Data.ErpLocation` via
 * `RPCCodexStore_CodexGetLocations` — the same codeunit RPC rail the vendor sync
 * uses, not the Standard API, because only the RPC returns a Location's default
 * dimensions alongside it.
 *
 * Why the table is needed at all: codeunit 50263 wrote a constant `COCO` into
 * the BU dimension of every AP-2 and AP-3 journal line, because nothing on this
 * side knew what BU a Location was bound to. Of PCTH's 240 Locations only 130
 * are COCO. This sync is what lets the journal builder send the real one.
 */

import { ERP_INTERFACE_BRANDS } from "@/lib/acc/erp-interface-brands";
import { postBcCodexStoreRpc } from "@/lib/bc/bc-odata";
import { getBcConnectionById } from "@/lib/bc/bc-connection";
import { getBrandConfig } from "@/lib/brand-config";
import { getErpDataPool, sql } from "@/lib/db/mssql";
import { normalizeLocationRow, type CodexLocationRow } from "./location-sync-core";

/** Locations are read from Production for every brand, as vendors are. */
export const ERP_LOCATION_SOURCE_ENVIRONMENT = "Production";

interface BrandLocationSyncContext {
  brandCode: string;
  bcCompanyId: string;
  bcCompanyName: string;
  bcConnectionId: number;
  baseUrl: string;
}

export interface LocationSyncResult {
  brandCode: string;
  locationRows: number;
  syncedAt: string;
}

async function resolveBrandLocationSyncContext(brandCode: string): Promise<BrandLocationSyncContext> {
  const code = brandCode.trim().toUpperCase();
  const brand = await getBrandConfig(code);
  if (!brand) throw new Error(`Brand ${code} is not configured`);
  if (!brand.bcId?.trim()) throw new Error(`Brand ${code} has no BC company id`);
  if (!brand.bcName?.trim()) throw new Error(`Brand ${code} has no BC company name`);
  if (!brand.bcConnectionId) throw new Error(`Brand ${code} has no BC connection`);

  const connection = await getBcConnectionById(brand.bcConnectionId);
  if (!connection?.IsActive) throw new Error(`BC connection for ${code} is not active`);

  return {
    brandCode: code,
    bcCompanyId: brand.bcId.trim(),
    bcCompanyName: brand.bcName.trim(),
    bcConnectionId: brand.bcConnectionId,
    baseUrl: connection.BaseUrl,
  };
}

async function insertSyncLog(
  brandCode: string,
  status: "success" | "failed",
  rowsUpserted: number,
  errorMessage: string | null,
  triggeredBy: number | null,
  startedAt: Date,
): Promise<void> {
  const pool = await getErpDataPool();
  await pool
    .request()
    .input("syncType", sql.NVarChar, "LOCATIONS")
    .input("brand", sql.NVarChar, brandCode)
    .input("status", sql.NVarChar, status)
    .input("rows", sql.Int, rowsUpserted)
    .input("err", sql.NVarChar, errorMessage)
    .input("started", sql.DateTime2, startedAt)
    .input("by", sql.Int, triggeredBy ?? null)
    .query(`
      INSERT INTO [dbo].[ErpSyncLog]
        (SyncType, BrandCode, Status, RowsUpserted, ErrorMessage, StartedAt, FinishedAt, TriggeredBy)
      VALUES
        (@syncType, @brand, @status, @rows, @err, @started, SYSDATETIME(), @by)
    `);
}

/**
 * Pull one brand's Locations and mirror them.
 *
 * A Location that stops coming back is deactivated, never deleted: journals
 * already sent reference it, and `IsActive = 0` keeps the history readable while
 * taking it out of the lookup.
 */
export async function syncBrandErpLocations(
  brandCode: string,
  triggeredBy: number | null,
): Promise<LocationSyncResult> {
  const startedAt = new Date();
  const ctx = await resolveBrandLocationSyncContext(brandCode);
  let locationRows = 0;

  try {
    const raw = await postBcCodexStoreRpc<CodexLocationRow>(
      ctx.bcConnectionId,
      ctx.bcCompanyId,
      ERP_LOCATION_SOURCE_ENVIRONMENT,
      ctx.baseUrl,
      "RPCCodexStore_CodexGetLocations",
      [],
    );

    // An empty answer would deactivate the whole brand a moment later. That is a
    // BC-side failure dressed as success, so it is refused before anything is
    // written rather than after the damage.
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new Error(`BC returned no Locations for ${ctx.brandCode}`);
    }

    const pool = await getErpDataPool();

    for (const row of raw) {
      const loc = normalizeLocationRow(row);
      if (!loc) continue;

      await pool
        .request()
        .input("brand", sql.NVarChar, ctx.brandCode)
        .input("code", sql.NVarChar, loc.code)
        .input("name", sql.NVarChar, loc.displayName)
        .input("branch", sql.NVarChar, loc.branchCode)
        .input("bu", sql.NVarChar, loc.buCode)
        .input("dept", sql.NVarChar, loc.departmentCode)
        .input("raw", sql.NVarChar, loc.rawJson)
        .query(`
          MERGE [dbo].[ErpLocation] AS t
          USING (SELECT @brand AS BrandCode, @code AS Code) AS s
          ON t.BrandCode = s.BrandCode AND t.Code = s.Code
          WHEN MATCHED THEN
            UPDATE SET
              DisplayName = @name,
              BranchCode = @branch,
              BuCode = @bu,
              DepartmentCode = @dept,
              IsActive = 1,
              SyncedAt = SYSDATETIME(),
              RawJson = @raw
          WHEN NOT MATCHED THEN
            INSERT (BrandCode, Code, DisplayName, BranchCode, BuCode, DepartmentCode, IsActive, SyncedAt, RawJson)
            VALUES (@brand, @code, @name, @branch, @bu, @dept, 1, SYSDATETIME(), @raw);
        `);
      locationRows++;
    }

    await pool
      .request()
      .input("brand", sql.NVarChar, ctx.brandCode)
      .input("cutoff", sql.DateTime2, startedAt)
      .query(`
        UPDATE [dbo].[ErpLocation]
        SET IsActive = 0
        WHERE BrandCode = @brand AND SyncedAt < @cutoff
      `);

    await insertSyncLog(ctx.brandCode, "success", locationRows, null, triggeredBy, startedAt);

    return {
      brandCode: ctx.brandCode,
      locationRows,
      syncedAt: new Date().toISOString(),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Location sync failed";
    await insertSyncLog(ctx.brandCode, "failed", locationRows, msg, triggeredBy, startedAt);
    throw e;
  }
}

/** Every interface brand, one at a time. One brand's failure does not stop the rest. */
export async function syncAllBrandErpLocations(triggeredBy: number | null): Promise<{
  results: LocationSyncResult[];
  errors: { brandCode: string; error: string }[];
}> {
  const results: LocationSyncResult[] = [];
  const errors: { brandCode: string; error: string }[] = [];
  for (const brand of ERP_INTERFACE_BRANDS) {
    try {
      results.push(await syncBrandErpLocations(brand.id, triggeredBy));
    } catch (error) {
      errors.push({
        brandCode: brand.id,
        error: error instanceof Error ? error.message : "Location sync failed",
      });
    }
  }
  return { results, errors };
}
