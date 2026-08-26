import { listAllBrands } from "@/lib/acc/brand-options";
import { BRANDS } from "@/lib/brand";

/**
 * The four brands the Intelligence dashboards ever covered — see
 * `getBrandDashboardReadiness`, the only reader. Everything else on this page
 * now comes from the company brand master.
 */
const LEGACY_DASHBOARD_BRANDS = BRANDS.filter((b) => b.enabled);
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
  /** `/brandlogo/{code}-200.png`, or null for a brand with no logo file. */
  brandLogo: string | null;
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

/**
 * Every active brand merged with its DB config, creating an empty row for any
 * brand that has none yet.
 *
 * **The brand list comes from the company brand master** (`Rocks_Codex.dbo.Brand`,
 * via `listAllBrands`), not from the hardcoded `BRANDS` array in
 * `src/lib/brand.ts`. That array holds four entries, so this page showed four
 * cards while AP-1's แบรนด์ที่เบิกได้ tab — which has always read the master —
 * showed seven. Two lists of "which brands exist" is the bug; the master is the
 * one that gains a brand when the business does.
 *
 * `BRANDS` still drives `BrandGate`, the navbar switcher and `isValidBrand`, so
 * a brand that appears here is **not** thereby selectable by users. That is
 * deliberate: this page is where an admin configures a brand's BC and ERP SQL,
 * which has to be possible *before* anybody can pick it.
 *
 * Seeding extra rows is safe for the sibling applications. RocksFast's own
 * `listBrandConfigs` maps over *its* `BRANDS` at the end, so a row for a brand
 * it does not know is simply never read.
 */
export async function listBrandConfigs(userId: number): Promise<BrandConfigPublic[]> {
  const pool = await getCorePool();
  // Already filtered to IsActive = 1 by `listAllBrands`.
  const enabledBrands = await listAllBrands();

  for (const b of enabledBrands) {
    await pool
      .request()
      .input("brandCode", mssqlSql.NVarChar, b.brandCode)
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
    const r = byCode.get(brand.brandCode);
    const dbId = (r?.DbConnectionId as number) ?? null;
    const dashId = (r?.DashboardDbConnectionId as number) ?? null;
    const erpConn = mapDbConnectionDisplay(dbId, r?.DbCode as string, r?.DbName as string);
    const dashConn = mapDbConnectionDisplay(dashId, r?.DashDbCode as string, r?.DashDbName as string);

    return {
      brandCode: brand.brandCode,
      brandName: brand.brandName,
      // `/brandlogo/{code}-200.png`, the same convention the brand switcher
      // uses. A brand with no such file — Paloma and SANMAI today — renders the
      // card's initials fallback instead of a broken image; see BrandMark on
      // the settings page.
      brandLogo: brand.brandLogo,
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
  // Against the master, for the same reason `listBrandConfigs` reads it: a
  // brand the page can show has to be a brand the page can save. Checking the
  // hardcoded four here would 400 every save for Paloma and SANMAI.
  const brands = await listAllBrands();
  if (!brands.some((b) => b.brandCode === brandCode)) return null;

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

/**
 * Whether Dashboard SQL is configured, per brand.
 *
 * **Dead in this app** — Intelligence was removed when it was cloned, and
 * nothing in `src/` calls this. Kept because `brand-config.ts` is deliberately
 * frozen against the Rocks Fast sibling, which still reads the Dashboard
 * columns. Its brand list stays the hardcoded four on purpose: those are the
 * brands that ever had an Intelligence dashboard, and reading the master here
 * would report on brands the feature never covered.
 */
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
  for (const brand of LEGACY_DASHBOARD_BRANDS) {
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
