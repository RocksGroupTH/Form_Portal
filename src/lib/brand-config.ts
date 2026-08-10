import { BRANDS } from "@/lib/brand";
import { getAppMssqlLookup, isAppDbConnection } from "@/lib/db/app-connection";
import { getCorePool, sql as mssqlSql } from "@/lib/db/mssql";
import { parseDatabaseInput } from "@/lib/db/sql-port";

export interface BrandDbTarget {
  dbConnectionId: number;
  databaseName: string;
}

export interface BrandConfigPublic {
  brandCode: string;
  brandName: string;
  brandLogo: string;
  bcId: string | null;
  bcName: string | null;
  bcConnectionId: number | null;
  bcConnectionName: string | null;
  dbConnectionId: number | null;
  dbConnectionCode: string | null;
  dbConnectionName: string | null;
  databaseName: string | null;
  dashboardDbConnectionId: number | null;
  dashboardDbConnectionCode: string | null;
  dashboardDbConnectionName: string | null;
  dashboardDatabaseName: string | null;
  isActive: boolean;
}

export interface BrandConfigInput {
  bcId?: string | null;
  bcName?: string | null;
  bcConnectionId?: number | null;
  dbConnectionId?: number | null;
  databaseName?: string | null;
  dashboardDbConnectionId?: number | null;
  dashboardDatabaseName?: string | null;
  isActive?: boolean;
}

export interface BrandConfigLookups {
  dbConnections: { id: number; code: string; name: string }[];
  bcConnections: { id: number; code: string; name: string }[];
}

function mapDbConnectionDisplay(
  connectionId: number | null,
  code: string | null | undefined,
  name: string | null | undefined,
): { code: string | null; name: string | null } {
  if (connectionId == null) return { code: null, name: null };
  if (isAppDbConnection(connectionId)) {
    const app = getAppMssqlLookup();
    return { code: app.code, name: app.name };
  }
  return { code: code ?? null, name: name ?? null };
}

export async function listBrandConfigLookups(): Promise<BrandConfigLookups> {
  const pool = await getCorePool();
  const dbResult = await pool.request().query(`
    SELECT Id, Code, Name FROM DbConnection WHERE IsActive = 1 ORDER BY Code
  `);
  const bcResult = await pool.request().query(`
    SELECT Id, Code, Name FROM BcConnection WHERE IsActive = 1 ORDER BY Code
  `);
  const mapRow = (r: Record<string, unknown>) => ({
    id: r.Id as number,
    code: r.Code as string,
    name: r.Name as string,
  });
  return {
    dbConnections: [getAppMssqlLookup(), ...dbResult.recordset.map(mapRow)],
    bcConnections: bcResult.recordset.map(mapRow),
  };
}

/** All enabled brands merged with DB config (creates empty rows if missing). */
export async function listBrandConfigs(userId: number): Promise<BrandConfigPublic[]> {
  const pool = await getCorePool();
  const enabledBrands = BRANDS.filter((b) => b.enabled);

  for (const b of enabledBrands) {
    await pool
      .request()
      .input("brandCode", mssqlSql.NVarChar, b.id)
      .input("createdBy", mssqlSql.Int, userId || null)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM BrandConfig WHERE BrandCode = @brandCode)
        INSERT INTO BrandConfig (BrandCode, CreatedBy, UpdatedBy)
        VALUES (@brandCode, @createdBy, @createdBy)
      `);
  }

  const result = await pool.request().query(`
    SELECT
      bc.BrandCode,
      bc.BcId,
      bc.BcName,
      bc.BcConnectionId,
      bc.DbConnectionId,
      bc.DatabaseName,
      bc.DashboardDbConnectionId,
      bc.DashboardDatabaseName,
      bc.IsActive,
      dbc.Code AS DbCode,
      dbc.Name AS DbName,
      dash.Code AS DashDbCode,
      dash.Name AS DashDbName,
      bcc.Name AS BcConnName
    FROM BrandConfig bc
    LEFT JOIN DbConnection dbc ON dbc.Id = bc.DbConnectionId AND bc.DbConnectionId > 0
    LEFT JOIN DbConnection dash ON dash.Id = bc.DashboardDbConnectionId AND bc.DashboardDbConnectionId > 0
    LEFT JOIN BcConnection bcc ON bcc.Id = bc.BcConnectionId
  `);

  const byCode = new Map<string, Record<string, unknown>>();
  for (const r of result.recordset as Record<string, unknown>[]) {
    byCode.set(r.BrandCode as string, r);
  }

  return enabledBrands.map((brand) => {
    const r = byCode.get(brand.id);
    const dbId = (r?.DbConnectionId as number) ?? null;
    const dashId = (r?.DashboardDbConnectionId as number) ?? null;
    const erpConn = mapDbConnectionDisplay(dbId, r?.DbCode as string, r?.DbName as string);
    const dashConn = mapDbConnectionDisplay(dashId, r?.DashDbCode as string, r?.DashDbName as string);

    return {
      brandCode: brand.id,
      brandName: brand.name,
      brandLogo: brand.logo,
      bcId: (r?.BcId as string) ?? null,
      bcName: (r?.BcName as string) ?? null,
      bcConnectionId: (r?.BcConnectionId as number) ?? null,
      bcConnectionName: (r?.BcConnName as string) ?? null,
      dbConnectionId: dbId,
      dbConnectionCode: erpConn.code,
      dbConnectionName: erpConn.name,
      databaseName: (r?.DatabaseName as string) ?? null,
      dashboardDbConnectionId: dashId,
      dashboardDbConnectionCode: dashConn.code,
      dashboardDbConnectionName: dashConn.name,
      dashboardDatabaseName: (r?.DashboardDatabaseName as string) ?? null,
      isActive: r ? (r.IsActive as boolean) : true,
    };
  });
}

export async function updateBrandConfig(
  brandCode: string,
  input: BrandConfigInput,
  userId: number,
): Promise<BrandConfigPublic | null> {
  const brand = BRANDS.find((b) => b.id === brandCode && b.enabled);
  if (!brand) return null;

  const pool = await getCorePool();
  await pool
    .request()
    .input("brandCode", mssqlSql.NVarChar, brandCode)
    .input("createdBy", mssqlSql.Int, userId || null)
    .query(`
      IF NOT EXISTS (SELECT 1 FROM BrandConfig WHERE BrandCode = @brandCode)
      INSERT INTO BrandConfig (BrandCode, CreatedBy, UpdatedBy)
      VALUES (@brandCode, @createdBy, @createdBy)
    `);

  const dbName =
    input.databaseName !== undefined
      ? parseDatabaseInput(input.databaseName ?? "")
      : null;
  const dashboardDbName =
    input.dashboardDatabaseName !== undefined
      ? parseDatabaseInput(input.dashboardDatabaseName ?? "")
      : null;

  const req = pool
    .request()
    .input("brandCode", mssqlSql.NVarChar, brandCode)
    .input("bcId", mssqlSql.NVarChar, input.bcId?.trim() || null)
    .input("bcName", mssqlSql.NVarChar, input.bcName?.trim() || null)
    .input("bcConnectionId", mssqlSql.Int, input.bcConnectionId ?? null)
    .input("dbConnectionId", mssqlSql.Int, input.dbConnectionId ?? null)
    .input("dashboardDbConnectionId", mssqlSql.Int, input.dashboardDbConnectionId ?? null)
    .input("isActive", mssqlSql.Bit, input.isActive !== false ? 1 : 0)
    .input("updatedBy", mssqlSql.Int, userId || null);

  const sets = [
    "BcId = @bcId",
    "BcName = @bcName",
    "BcConnectionId = @bcConnectionId",
    "DbConnectionId = @dbConnectionId",
    "DashboardDbConnectionId = @dashboardDbConnectionId",
    "IsActive = @isActive",
    "UpdatedBy = @updatedBy",
    "UpdatedAt = GETDATE()",
  ];

  if (input.databaseName !== undefined) {
    sets.push("DatabaseName = @databaseName");
    req.input("databaseName", mssqlSql.NVarChar, dbName);
  }
  if (input.dashboardDatabaseName !== undefined) {
    sets.push("DashboardDatabaseName = @dashboardDatabaseName");
    req.input("dashboardDatabaseName", mssqlSql.NVarChar, dashboardDbName);
  }

  await req.query(`UPDATE BrandConfig SET ${sets.join(", ")} WHERE BrandCode = @brandCode`);

  const list = await listBrandConfigs(userId);
  return list.find((c) => c.brandCode === brandCode) ?? null;
}

export async function getBrandConfig(brandCode: string): Promise<BrandConfigPublic | null> {
  const list = await listBrandConfigs(0);
  return list.find((c) => c.brandCode === brandCode) ?? null;
}

/** Whether Dashboard SQL is configured (for Intelligence hub brand picker). */
export function isDashboardConfigured(
  dbConnectionId: number | null | undefined,
  databaseName: string | null | undefined,
): boolean {
  return dbConnectionId != null && !!databaseName?.trim();
}

/** Per-brand Dashboard readiness for enabled brands in BRANDS registry. */
export async function getBrandDashboardReadiness(): Promise<Record<string, boolean>> {
  const pool = await getCorePool();
  const result = await pool.request().query(`
    SELECT BrandCode, DashboardDbConnectionId, DashboardDatabaseName
    FROM BrandConfig
  `);

  const byCode = new Map<string, { DashboardDbConnectionId: number | null; DashboardDatabaseName: string | null }>();
  for (const r of result.recordset as Record<string, unknown>[]) {
    byCode.set(r.BrandCode as string, {
      DashboardDbConnectionId: (r.DashboardDbConnectionId as number) ?? null,
      DashboardDatabaseName: (r.DashboardDatabaseName as string) ?? null,
    });
  }

  const out: Record<string, boolean> = {};
  for (const brand of BRANDS.filter((b) => b.enabled)) {
    const row = byCode.get(brand.id);
    out[brand.id] = row
      ? isDashboardConfigured(row.DashboardDbConnectionId, row.DashboardDatabaseName)
      : false;
  }
  return out;
}

/** ERP lookups (New Item Inventory, etc.) */
export async function resolveBrandErpTarget(brandCode: string): Promise<BrandDbTarget> {
  return resolveBrandSqlTarget(brandCode, "erp");
}

/** Dashboard / reporting DB per brand */
export async function resolveBrandDashboardTarget(brandCode: string): Promise<BrandDbTarget> {
  return resolveBrandSqlTarget(brandCode, "dashboard");
}

async function resolveBrandSqlTarget(
  brandCode: string,
  kind: "erp" | "dashboard",
): Promise<BrandDbTarget> {
  const pool = await getCorePool();
  const result = await pool
    .request()
    .input("brand", mssqlSql.NVarChar, brandCode)
    .query(`
      SELECT DbConnectionId, DatabaseName, DashboardDbConnectionId, DashboardDatabaseName
      FROM BrandConfig
      WHERE BrandCode = @brand AND IsActive = 1
    `);
  const row = result.recordset[0] as
    | {
        DbConnectionId: number | null;
        DatabaseName: string | null;
        DashboardDbConnectionId: number | null;
        DashboardDatabaseName: string | null;
      }
    | undefined;

  if (!row) {
    throw new Error(`Brand "${brandCode}" is not configured`);
  }

  const dbConnectionId =
    kind === "erp" ? row.DbConnectionId : row.DashboardDbConnectionId;
  const databaseName =
    kind === "erp" ? row.DatabaseName : row.DashboardDatabaseName;

  if (dbConnectionId == null || !databaseName?.trim()) {
    const label = kind === "erp" ? "ERP" : "Dashboard";
    throw new Error(`Brand "${brandCode}" has no ${label} database configured`);
  }

  const DB_NAME_RE = /^[A-Za-z0-9_]+$/;
  if (!DB_NAME_RE.test(databaseName)) {
    throw new Error(`Brand "${brandCode}" has an invalid database name`);
  }

  return { dbConnectionId, databaseName };
}
