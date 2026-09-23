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

import { listErpInterfaceBrands } from "@/lib/acc/erp-interface-brands";
import { postBcCodexStoreRpc } from "@/lib/bc/bc-odata";
import { getBcConnectionById } from "@/lib/bc/bc-connection";
import { getBrandConfig } from "@/lib/brand-config";
import {
  resolveErpSourceEnvironment,
  type ErpBcEnvironment,
} from "@/lib/erp/source-environment";
import {
  missingBcProfileMessage,
  resolveBrandBcProfile,
} from "@/lib/erp/brand-bc-profile";

import { getErpDataPool, sql } from "@/lib/db/mssql";
import { normalizeLocationRow, type CodexLocationRow } from "./location-sync-core";

/** Locations are read from Production for every brand, as vendors are. */
/* `ERP_LOCATION_SOURCE_ENVIRONMENT = "Production"` stood here, the same shape
   `vendor-sync` carried: a literal deciding which BC is CALLED. It is
   `ctx.environment` now — resolved once per brand alongside the company this
   sync reads, so the environment in the URL and the environment stamped on the
   rows cannot disagree. */

interface BrandLocationSyncContext {
  brandCode: string;
  bcCompanyId: string;
  bcCompanyName: string;
  bcConnectionId: number;
  baseUrl: string;
  /** Which BC this read, and what every row it writes is stamped with. */
  environment: ErpBcEnvironment;
}

export interface LocationSyncResult {
  brandCode: string;
  locationRows: number;
  syncedAt: string;
}

async function resolveBrandLocationSyncContext(brandCode: string): Promise<BrandLocationSyncContext> {
  const code = brandCode.trim().toUpperCase();
  const environment = await resolveErpSourceEnvironment();
  // No fallback between environments — see `brand-bc-profile.ts`.
  const profile = await resolveBrandBcProfile(code, environment);
  if (!profile) throw new Error(missingBcProfileMessage(code, environment));

  return {
    brandCode: code,
    bcCompanyId: profile.bcCompanyId,
    bcCompanyName: profile.bcCompanyName,
    bcConnectionId: profile.bcConnectionId,
    baseUrl: profile.baseUrl,
    environment,
  };
}

async function insertSyncLog(
  brandCode: string,
  /** Which BC the run read — one answer per sync, decided where it starts. */
  environment: ErpBcEnvironment,
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
    .input("env", sql.NVarChar, environment)
    .input("status", sql.NVarChar, status)
    .input("rows", sql.Int, rowsUpserted)
    .input("err", sql.NVarChar, errorMessage)
    .input("started", sql.DateTime2, startedAt)
    .input("by", sql.Int, triggeredBy ?? null)
    .query(`
      INSERT INTO [dbo].[ErpSyncLog]
        (SourceEnvironment, SyncType, BrandCode, Status, RowsUpserted, ErrorMessage, StartedAt, FinishedAt, TriggeredBy)
      VALUES
        (@env, @syncType, @brand, @status, @rows, @err, @started, SYSDATETIME(), @by)
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
      ctx.environment,
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
        .input("env", sql.NVarChar, ctx.environment)
        .input("code", sql.NVarChar, loc.code)
        .input("name", sql.NVarChar, loc.displayName)
        .input("branch", sql.NVarChar, loc.branchCode)
        .input("bu", sql.NVarChar, loc.buCode)
        .input("dept", sql.NVarChar, loc.departmentCode)
        .input("raw", sql.NVarChar, loc.rawJson)
        .query(`
          MERGE [dbo].[ErpLocation] AS t
          USING (SELECT @env AS SourceEnvironment, @brand AS BrandCode, @code AS Code) AS s
          ON t.SourceEnvironment = s.SourceEnvironment
            AND t.BrandCode = s.BrandCode AND t.Code = s.Code
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
            INSERT (SourceEnvironment, BrandCode, Code, DisplayName, BranchCode, BuCode, DepartmentCode, IsActive, SyncedAt, RawJson)
            VALUES (@env, @brand, @code, @name, @branch, @bu, @dept, 1, SYSDATETIME(), @raw);
        `);
      locationRows++;
    }

    await pool
      .request()
      .input("brand", sql.NVarChar, ctx.brandCode)
      .input("env", sql.NVarChar, ctx.environment)
      .input("cutoff", sql.DateTime2, startedAt)
      .query(`
        UPDATE [dbo].[ErpLocation]
        SET IsActive = 0
        WHERE SourceEnvironment = @env AND BrandCode = @brand AND SyncedAt < @cutoff
      `);

    await insertSyncLog(ctx.brandCode, ctx.environment, "success", locationRows, null, triggeredBy, startedAt);

    return {
      brandCode: ctx.brandCode,
      locationRows,
      syncedAt: new Date().toISOString(),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Location sync failed";
    await insertSyncLog(ctx.brandCode, ctx.environment, "failed", locationRows, msg, triggeredBy, startedAt);
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
  for (const brand of await listErpInterfaceBrands()) {
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
