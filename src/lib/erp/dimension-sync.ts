/**
 * Sync BC dimension values for PCTH → Rocks_ERP_Data.ErpDimensionValue
 */

import { getErpDataPool, sql } from "@/lib/db/mssql";
import { getBrandConfig } from "@/lib/brand-config";
import {
  resolveErpSourceEnvironment,
  type ErpBcEnvironment,
} from "@/lib/erp/source-environment";
import {
  missingBcProfileMessage,
  resolveBrandBcProfile,
} from "@/lib/erp/brand-bc-profile";

import { getBcConnectionById } from "@/lib/bc/bc-connection";
import {
  buildBcODataEntityUrl,
  fetchBcODataCollection,
} from "@/lib/bc/bc-odata";

export const ERP_SYNC_BRAND_CODE = "PCTH";
export const BC_DIMENSION_ENTITY = "RPCIT_DimensionValues";
export const HR_DEPARTMENT_DIMENSION_CODE = "DEPT";
export const BRANCH_DIMENSION_CODE = "BRANCH";

export interface DimensionSyncResult {
  brandCode: string;
  rowsUpserted: number;
  syncedAt: string;
}

interface BcDimensionRow extends Record<string, unknown> {
  Code?: string;
  code?: string;
  Name?: string;
  name?: string;
  Display_Name?: string;
  displayName?: string;
  Dimension_Code?: string;
  dimensionCode?: string;
  DimensionCode?: string;
  Blocked?: boolean;
  blocked?: boolean;
}

function pickStr(row: BcDimensionRow, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function pickBool(row: BcDimensionRow, ...keys: string[]): boolean {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "boolean") return v;
  }
  return false;
}

function normalizeRow(row: BcDimensionRow): {
  dimensionCode: string;
  code: string;
  displayName: string | null;
  isBlocked: boolean;
  rawJson: string;
} | null {
  const code = pickStr(row, "Code", "code");
  const dimensionCode = pickStr(row, "Dimension_Code", "DimensionCode", "dimensionCode");
  if (!code || !dimensionCode) return null;

  const displayName =
    pickStr(row, "Name", "name", "Display_Name", "displayName") ?? code;

  return {
    dimensionCode,
    code,
    displayName,
    isBlocked: pickBool(row, "Blocked", "blocked"),
    rawJson: JSON.stringify(row),
  };
}

export async function isPcthBcConfigReady(): Promise<boolean> {
  try {
    await resolveBrandBcDimensionContext(ERP_SYNC_BRAND_CODE, HR_DEPARTMENT_DIMENSION_CODE);
    return true;
  } catch {
    return false;
  }
}

export async function resolveBrandBcDimensionContext(
  brandCode: string,
  dimensionCode: string,
): Promise<{
  brandCode: string;
  bcConnectionId: number;
  companyName: string;
  odataUrl: string;
  dimensionCode: string;
  /** Which BC this read, and what every row it writes is stamped with. */
  environment: ErpBcEnvironment;
}> {
  const code = brandCode.trim().toUpperCase();
  const dim = dimensionCode.trim().toUpperCase();
  const environment = await resolveErpSourceEnvironment();
  // No fallback between environments — see `brand-bc-profile.ts`.
  const profile = await resolveBrandBcProfile(code, environment);
  if (!profile) throw new Error(missingBcProfileMessage(code, environment));

  // The environment, or the builder appends its "Production" default to a base
  // URL that already ends in /Sandbox — see account-sync's own note.
  const odataUrl = `${buildBcODataEntityUrl(
    profile.baseUrl,
    profile.bcCompanyName,
    BC_DIMENSION_ENTITY,
    environment,
  )}?$filter=Dimension_Code eq '${dim}'`;

  return {
    brandCode: code,
    bcConnectionId: profile.bcConnectionId,
    companyName: profile.bcCompanyName,
    odataUrl,
    dimensionCode: dim,
    environment,
  };
}

export async function resolvePcthBcSyncContext(): Promise<{
  brandCode: string;
  bcConnectionId: number;
  companyName: string;
  odataUrl: string;
}> {
  const ctx = await resolveBrandBcDimensionContext(
    ERP_SYNC_BRAND_CODE,
    HR_DEPARTMENT_DIMENSION_CODE,
  );
  return {
    brandCode: ctx.brandCode,
    bcConnectionId: ctx.bcConnectionId,
    companyName: ctx.companyName,
    odataUrl: ctx.odataUrl,
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
  // The five Business Central sync tables moved to Rocks_ERP_Data in migrations
  // 101/102; Fast_Data keeps synonyms for the two sibling applications. This app
  // names the new home directly.
  const pool = await getErpDataPool();
  await pool
    .request()
    .input("syncType", sql.NVarChar, "DIMENSION_VALUES")
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

export async function syncBrandDimensionValues(
  brandCode: string,
  dimensionCode: string,
  triggeredBy: number | null,
  options?: { skipLog?: boolean },
): Promise<DimensionSyncResult> {
  const startedAt = new Date();
  const ctx = await resolveBrandBcDimensionContext(brandCode, dimensionCode);
  const dim = ctx.dimensionCode;

  let rowsUpserted = 0;
  try {
    const rawRows = await fetchBcODataCollection<BcDimensionRow>(
      ctx.bcConnectionId,
      ctx.odataUrl,
    );

    const pool = await getErpDataPool();

    for (const raw of rawRows) {
      const norm = normalizeRow(raw);
      if (!norm || norm.dimensionCode !== dim) continue;

      await pool
        .request()
        .input("brand", sql.NVarChar, ctx.brandCode)
        .input("env", sql.NVarChar, ctx.environment)
        .input("dim", sql.NVarChar, norm.dimensionCode)
        .input("code", sql.NVarChar, norm.code)
        .input("name", sql.NVarChar, norm.displayName)
        .input("blocked", sql.Bit, norm.isBlocked ? 1 : 0)
        .input("raw", sql.NVarChar, norm.rawJson)
        .query(`
          MERGE [dbo].[ErpDimensionValue] AS t
          USING (SELECT @env AS SourceEnvironment, @brand AS BrandCode, @dim AS DimensionCode, @code AS Code) AS s
          ON t.SourceEnvironment = s.SourceEnvironment
            AND t.BrandCode = s.BrandCode AND t.DimensionCode = s.DimensionCode AND t.Code = s.Code
          WHEN MATCHED THEN
            UPDATE SET
              DisplayName = @name,
              IsBlocked = @blocked,
              IsActive = 1,
              SyncedAt = SYSDATETIME(),
              RawJson = @raw
          WHEN NOT MATCHED THEN
            INSERT (SourceEnvironment, BrandCode, DimensionCode, Code, DisplayName, IsBlocked, IsActive, SyncedAt, RawJson)
            VALUES (@env, @brand, @dim, @code, @name, @blocked, 1, SYSDATETIME(), @raw);
        `);
      rowsUpserted++;
    }

    await pool
      .request()
      .input("brand", sql.NVarChar, ctx.brandCode)
      .input("env", sql.NVarChar, ctx.environment)
      .input("dim", sql.NVarChar, dim)
      .input("cutoff", sql.DateTime2, startedAt)
      .query(`
        UPDATE [dbo].[ErpDimensionValue]
        SET IsActive = 0
        WHERE SourceEnvironment = @env AND BrandCode = @brand AND DimensionCode = @dim AND SyncedAt < @cutoff
      `);

    if (!options?.skipLog) {
      await insertSyncLog(ctx.brandCode, ctx.environment, "success", rowsUpserted, null, triggeredBy, startedAt);
    }

    return {
      brandCode: ctx.brandCode,
      rowsUpserted,
      syncedAt: new Date().toISOString(),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync failed";
    if (!options?.skipLog) {
      await insertSyncLog(ctx.brandCode, ctx.environment, "failed", rowsUpserted, msg, triggeredBy, startedAt);
    }
    throw e;
  }
}

export async function syncPcthDimensionValues(
  triggeredBy: number | null,
): Promise<DimensionSyncResult> {
  return syncBrandDimensionValues(
    ERP_SYNC_BRAND_CODE,
    HR_DEPARTMENT_DIMENSION_CODE,
    triggeredBy,
  );
}

export interface ErpDimensionOption {
  dimensionCode: string;
  code: string;
  displayName: string | null;
}

export async function listErpDimensionOptions(
  brandCode: string,
  dimensionCode: string,
  /**
   * Which BC's mirror to read. Omitted, the environment this request resolves
   * to — which is what every money path passes and why none of them can read
   * the other company's chart.
   *
   * The Interface ERP settings screens name it, because their routes are
   * pinned to Production in `ROUTE_RULES` while their PRO/UAT toggle decides
   * which half is being configured. Without it, an admin setting up the UAT
   * half picks from PRODUCTION's batch names and account numbers — and stores
   * them as UAT's, which is precisely the wrong-company value migration 161
   * exists to keep out.
   */
  environment?: ErpBcEnvironment,
): Promise<ErpDimensionOption[]> {
  const pool = await getErpDataPool();
  const res = await pool
    .request()
    .input("brand", sql.NVarChar, brandCode.trim().toUpperCase())
    .input("env", sql.NVarChar, await resolveErpSourceEnvironment(environment))
    .input("dim", sql.NVarChar, dimensionCode.trim().toUpperCase())
    .query(`
      SELECT DimensionCode, Code, DisplayName
      FROM [dbo].[ErpDimensionValue]
      WHERE SourceEnvironment = @env
        AND BrandCode = @brand AND DimensionCode = @dim AND IsActive = 1 AND IsBlocked = 0
      ORDER BY DisplayName, Code
    `);

  return (res.recordset as Record<string, unknown>[]).map((r) => ({
    dimensionCode: r.DimensionCode as string,
    code: r.Code as string,
    displayName: (r.DisplayName as string) ?? null,
  }));
}

export async function listErpBranchesForBrands(
  brandCodes: string[],
  /**
   * Which BC's mirror to read. Omitted, the environment this request resolves
   * to — which is what every money path passes and why none of them can read
   * the other company's chart.
   *
   * The Interface ERP settings screens name it, because their routes are
   * pinned to Production in `ROUTE_RULES` while their PRO/UAT toggle decides
   * which half is being configured. Without it, an admin setting up the UAT
   * half picks from PRODUCTION's batch names and account numbers — and stores
   * them as UAT's, which is precisely the wrong-company value migration 161
   * exists to keep out.
   */
  environment?: ErpBcEnvironment,
): Promise<Record<string, ErpDimensionOption[]>> {
  const out: Record<string, ErpDimensionOption[]> = {};
  await Promise.all(
    brandCodes.map(async (code) => {
      const brand = code.trim().toUpperCase();
      out[brand] = await listErpDimensionOptions(brand, BRANCH_DIMENSION_CODE, environment);
    }),
  );
  return out;
}

export async function listErpDepartmentsForBrands(
  brandCodes: string[],
  /**
   * Which BC's mirror to read. Omitted, the environment this request resolves
   * to — which is what every money path passes and why none of them can read
   * the other company's chart.
   *
   * The Interface ERP settings screens name it, because their routes are
   * pinned to Production in `ROUTE_RULES` while their PRO/UAT toggle decides
   * which half is being configured. Without it, an admin setting up the UAT
   * half picks from PRODUCTION's batch names and account numbers — and stores
   * them as UAT's, which is precisely the wrong-company value migration 161
   * exists to keep out.
   */
  environment?: ErpBcEnvironment,
): Promise<Record<string, ErpDimensionOption[]>> {
  const out: Record<string, ErpDimensionOption[]> = {};
  await Promise.all(
    brandCodes.map(async (code) => {
      const brand = code.trim().toUpperCase();
      out[brand] = await listErpDimensionOptions(brand, HR_DEPARTMENT_DIMENSION_CODE, environment);
    }),
  );
  return out;
}

export function erpDimensionHasCode(
  options: ErpDimensionOption[],
  code: string,
): boolean {
  const key = code.trim().toUpperCase();
  if (!key) return false;
  for (const opt of options) {
    if (opt.code.trim().toUpperCase() === key) return true;
  }
  return false;
}

export interface ErpSyncLogSummary {
  status: string;
  rowsUpserted: number;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export async function getLastDimensionSync(
  brandCode: string,
): Promise<ErpSyncLogSummary | null> {
  const pool = await getErpDataPool();
  const res = await pool
    .request()
    .input("brand", sql.NVarChar, brandCode)
    .input("type", sql.NVarChar, "DIMENSION_VALUES")
    .input("env", sql.NVarChar, await resolveErpSourceEnvironment())
    .query(`
      SELECT TOP 1 Status, RowsUpserted, ErrorMessage, StartedAt, FinishedAt
      FROM [dbo].[ErpSyncLog]
      WHERE SourceEnvironment = @env AND BrandCode = @brand AND SyncType = @type
      ORDER BY StartedAt DESC
    `);

  const r = res.recordset[0] as Record<string, unknown> | undefined;
  if (!r) return null;

  return {
    status: r.Status as string,
    rowsUpserted: (r.RowsUpserted as number) ?? 0,
    errorMessage: (r.ErrorMessage as string) ?? null,
    startedAt: (r.StartedAt as Date).toISOString(),
    finishedAt: r.FinishedAt ? (r.FinishedAt as Date).toISOString() : null,
  };
}
