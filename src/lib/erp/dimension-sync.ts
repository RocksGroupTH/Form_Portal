/**
 * Sync BC dimension values for PCTH → Fast_Data.ErpDimensionValue
 */

import { getDataPool, sql } from "@/lib/db/mssql";
import { getBrandConfig } from "@/lib/brand-config";
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
}> {
  const code = brandCode.trim().toUpperCase();
  const dim = dimensionCode.trim().toUpperCase();
  const brand = await getBrandConfig(code);
  if (!brand) {
    throw new Error(`ไม่พบการตั้งค่าแบรนด์ ${code}`);
  }
  if (!brand.bcConnectionId) {
    throw new Error(`แบรนด์ ${code} ยังไม่ได้เลือก BC Connection`);
  }
  if (!brand.bcName?.trim()) {
    throw new Error(`แบรนด์ ${code} ยังไม่ได้ตั้งค่า BC Company (BcName)`);
  }

  const conn = await getBcConnectionById(brand.bcConnectionId);
  if (!conn || !conn.IsActive) {
    throw new Error("BC Connection ไม่พร้อมใช้งาน");
  }

  const odataUrl = `${buildBcODataEntityUrl(
    conn.BaseUrl,
    brand.bcName.trim(),
    BC_DIMENSION_ENTITY,
  )}?$filter=Dimension_Code eq '${dim}'`;

  return {
    brandCode: code,
    bcConnectionId: brand.bcConnectionId,
    companyName: brand.bcName.trim(),
    odataUrl,
    dimensionCode: dim,
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
  status: "success" | "failed",
  rowsUpserted: number,
  errorMessage: string | null,
  triggeredBy: number | null,
  startedAt: Date,
): Promise<void> {
  const pool = await getDataPool();
  await pool
    .request()
    .input("syncType", sql.NVarChar, "DIMENSION_VALUES")
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

    const pool = await getDataPool();

    for (const raw of rawRows) {
      const norm = normalizeRow(raw);
      if (!norm || norm.dimensionCode !== dim) continue;

      await pool
        .request()
        .input("brand", sql.NVarChar, ctx.brandCode)
        .input("dim", sql.NVarChar, norm.dimensionCode)
        .input("code", sql.NVarChar, norm.code)
        .input("name", sql.NVarChar, norm.displayName)
        .input("blocked", sql.Bit, norm.isBlocked ? 1 : 0)
        .input("raw", sql.NVarChar, norm.rawJson)
        .query(`
          MERGE [dbo].[ErpDimensionValue] AS t
          USING (SELECT @brand AS BrandCode, @dim AS DimensionCode, @code AS Code) AS s
          ON t.BrandCode = s.BrandCode AND t.DimensionCode = s.DimensionCode AND t.Code = s.Code
          WHEN MATCHED THEN
            UPDATE SET
              DisplayName = @name,
              IsBlocked = @blocked,
              IsActive = 1,
              SyncedAt = SYSDATETIME(),
              RawJson = @raw
          WHEN NOT MATCHED THEN
            INSERT (BrandCode, DimensionCode, Code, DisplayName, IsBlocked, IsActive, SyncedAt, RawJson)
            VALUES (@brand, @dim, @code, @name, @blocked, 1, SYSDATETIME(), @raw);
        `);
      rowsUpserted++;
    }

    await pool
      .request()
      .input("brand", sql.NVarChar, ctx.brandCode)
      .input("dim", sql.NVarChar, dim)
      .input("cutoff", sql.DateTime2, startedAt)
      .query(`
        UPDATE [dbo].[ErpDimensionValue]
        SET IsActive = 0
        WHERE BrandCode = @brand AND DimensionCode = @dim AND SyncedAt < @cutoff
      `);

    if (!options?.skipLog) {
      await insertSyncLog(ctx.brandCode, "success", rowsUpserted, null, triggeredBy, startedAt);
    }

    return {
      brandCode: ctx.brandCode,
      rowsUpserted,
      syncedAt: new Date().toISOString(),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync failed";
    if (!options?.skipLog) {
      await insertSyncLog(ctx.brandCode, "failed", rowsUpserted, msg, triggeredBy, startedAt);
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
): Promise<ErpDimensionOption[]> {
  const pool = await getDataPool();
  const res = await pool
    .request()
    .input("brand", sql.NVarChar, brandCode.trim().toUpperCase())
    .input("dim", sql.NVarChar, dimensionCode.trim().toUpperCase())
    .query(`
      SELECT DimensionCode, Code, DisplayName
      FROM [dbo].[ErpDimensionValue]
      WHERE BrandCode = @brand AND DimensionCode = @dim AND IsActive = 1 AND IsBlocked = 0
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
): Promise<Record<string, ErpDimensionOption[]>> {
  const out: Record<string, ErpDimensionOption[]> = {};
  await Promise.all(
    brandCodes.map(async (code) => {
      const brand = code.trim().toUpperCase();
      out[brand] = await listErpDimensionOptions(brand, BRANCH_DIMENSION_CODE);
    }),
  );
  return out;
}

export async function listErpDepartmentsForBrands(
  brandCodes: string[],
): Promise<Record<string, ErpDimensionOption[]>> {
  const out: Record<string, ErpDimensionOption[]> = {};
  await Promise.all(
    brandCodes.map(async (code) => {
      const brand = code.trim().toUpperCase();
      out[brand] = await listErpDimensionOptions(brand, HR_DEPARTMENT_DIMENSION_CODE);
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
  const pool = await getDataPool();
  const res = await pool
    .request()
    .input("brand", sql.NVarChar, brandCode)
    .input("type", sql.NVarChar, "DIMENSION_VALUES")
    .query(`
      SELECT TOP 1 Status, RowsUpserted, ErrorMessage, StartedAt, FinishedAt
      FROM [dbo].[ErpSyncLog]
      WHERE BrandCode = @brand AND SyncType = @type
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
