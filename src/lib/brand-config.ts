import { listBrandRegistry } from "@/lib/brand-registry";
import {
  listErpTargetSettings,
  upsertErpTargetUatSetting,
} from "@/lib/acc/erp-target-setting-service";
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
  /**
   * An uploaded logo's URL, or the `/brandlogo/{code}-200.png` convention.
   * Never checked for existence — the card falls back on the image failing to
   * load. Null only if the registry ever stops building one.
   */
  brandLogo: string | null;
  /** Whether this app offers the brand in its picker (`BrandSetting`). */
  isEnabled: boolean;
  /** True when the logo above is one an admin uploaded, so it can be removed. */
  hasUploadedLogo: boolean;
  bcId: string | null;
  bcName: string | null;
  bcConnectionId: number | null;
  bcConnectionName: string | null;
  /**
   * The SANDBOX half of Config BC, read from `AccBrandErpTargetSetting` —
   * **not** from `BrandConfig`, which has no UAT columns and is not being
   * given any.
   *
   * The two halves stay in the two places they were already stored, and this
   * shape is where they are presented as one question. Copying the Sandbox
   * company into `BrandConfig` would be a third copy of a BC company id to
   * keep in step, and Settings → ERP Interface Environment still edits these
   * same rows. See `erp/brand-bc-profile.ts`, which resolves either half for
   * the sync and the send.
   */
  bcUatId: string | null;
  bcUatName: string | null;
  bcUatConnectionId: number | null;
  bcUatConnectionName: string | null;
  dbConnectionId: number | null;
  dbConnectionCode: string | null;
  dbConnectionName: string | null;
  databaseName: string | null;
  dashboardDbConnectionId: number | null;
  dashboardDbConnectionCode: string | null;
  dashboardDbConnectionName: string | null;
  dashboardDatabaseName: string | null;
  /**
   * `Fast_Core.dbo.BrandConfig.IsActive` — a column of the **shared** config
   * row, not this app's switch. `isEnabled` above is ours. They are separate on
   * purpose: writing our meaning into a column two sibling applications also
   * read is how two apps end up disagreeing about what a flag means.
   */
  isActive: boolean;
}

export interface BrandConfigInput {
  bcId?: string | null;
  bcName?: string | null;
  bcConnectionId?: number | null;
  /**
   * The Sandbox half. **Absent leaves the stored row alone; an explicit null
   * clears it** — the same three-valued rule the API-key PATCH draws for
   * `expiresAt`, and for the same reason: a caller sending only the Production
   * fields must not wipe a brand's UAT company as a side effect of a change
   * nobody would connect to it.
   */
  bcUatId?: string | null;
  bcUatName?: string | null;
  bcUatConnectionId?: number | null;
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
 * **This paragraph named `BRANDS` as the thing that gates the picker, and it
 * is out of date** (corrected 2026-09-23). `BrandGate` and the navbar switcher
 * read `/api/brands`, which is `listBrandRegistry()` — the master joined with
 * `BrandSetting` — and `isValidBrand` is a SHAPE check that decides nothing;
 * both are written up in `brand.ts`'s own docblock. What survives of the old
 * sentence is its point, and that point still holds: a brand appearing on this
 * page is **not** thereby offered to users, because `BrandSetting.IsEnabled` is
 * what decides that. This page is where an admin configures a brand's BC and
 * ERP SQL, which has to be possible *before* anybody can pick it.
 *
 * **The Save had the opposite bug until 2026-09-23**: this function listed the
 * master's brands while `PATCH /api/settings/brand-config/[brandCode]`
 * validated against the four in `BRANDS`, so three of the seven could be
 * filled in here and answered "Invalid brand". `brand-source-guard.test.ts`
 * is what stops that pair drifting apart again.
 *
 * Seeding extra rows is safe for the sibling applications. RocksFast's own
 * `listBrandConfigs` maps over *its* `BRANDS` at the end, so a row for a brand
 * it does not know is simply never read.
 */
export async function listBrandConfigs(userId: number): Promise<BrandConfigPublic[]> {
  const pool = await getCorePool();
  // Every active brand in the master, disabled ones included — this page is
  // where they are turned back on.
  const enabledBrands = await listBrandRegistry();

  for (const b of enabledBrands) {
    await pool
      .request()
      .input("brandCode", mssqlSql.NVarChar, b.code)
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

  /* The Sandbox half, from its own table. Read here rather than joined,
     because it lives in a DIFFERENT DATABASE — `AccBrandErpTargetSetting` is
     in the form database and `BrandConfig` is in Fast_Core — so a join would
     have to interpolate a database name into the statement, the env-drift
     hazard CLAUDE.md already records for `MSSQL_ERP_DATA_DATABASE`.

     A failure is swallowed to an empty map on purpose: the Production half of
     this page must stay editable when the form database is down, which is the
     same reason the settings pages that read Fast_Core stay up. A brand then
     shows no Sandbox company, which is honest — it could not be read. */
  const uatByCode = new Map<string, { id: string | null; name: string | null; connId: number | null }>();
  try {
    for (const row of await listErpTargetSettings()) {
      uatByCode.set(row.brandCode.trim().toUpperCase(), {
        id: row.bcUatId,
        name: row.bcUatName,
        connId: row.bcUatConnectionId,
      });
    }
  } catch {
    // Left empty — see above.
  }
  const connNameById = new Map<number, string>();
  for (const r of result.recordset as Record<string, unknown>[]) {
    const id = r.BcConnectionId as number | null;
    if (id != null && r.BcConnName) connNameById.set(id, r.BcConnName as string);
  }

  return enabledBrands.map((brand) => {
    const r = byCode.get(brand.code);
    const dbId = (r?.DbConnectionId as number) ?? null;
    const dashId = (r?.DashboardDbConnectionId as number) ?? null;
    const erpConn = mapDbConnectionDisplay(dbId, r?.DbCode as string, r?.DbName as string);
    const dashConn = mapDbConnectionDisplay(dashId, r?.DashDbCode as string, r?.DashDbName as string);

    return {
      brandCode: brand.code,
      brandName: brand.name,
      isEnabled: brand.isEnabled,
      hasUploadedLogo: brand.hasUploadedLogo,
      // `/brandlogo/{code}-200.png`, the same convention the brand switcher
      // uses. A brand with no such file — Paloma and SANMAI today — renders the
      // card's initials fallback instead of a broken image; see BrandMark on
      // the settings page.
      brandLogo: brand.logo,
      bcId: (r?.BcId as string) ?? null,
      bcName: (r?.BcName as string) ?? null,
      bcConnectionId: (r?.BcConnectionId as number) ?? null,
      bcConnectionName: (r?.BcConnName as string) ?? null,
      bcUatId: uatByCode.get(brand.code)?.id ?? null,
      bcUatName: uatByCode.get(brand.code)?.name ?? null,
      bcUatConnectionId: uatByCode.get(brand.code)?.connId ?? null,
      /* Resolved from the connections this query already named, so the UAT row
         shows a connection's NAME rather than a bare id where one of the
         brands happens to use the same connection. Null otherwise — the page's
         picker still labels it, and inventing a name here would be a second
         answer to what a connection is called. */
      bcUatConnectionName:
        connNameById.get(uatByCode.get(brand.code)?.connId ?? -1) ?? null,
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
  const brands = await listBrandRegistry();
  if (!brands.some((b) => b.code === brandCode)) return null;

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

  /* The Sandbox half goes to its own table, through the service that already
     owns it — the same rows Settings → ERP Interface Environment writes.
     Touched only when the caller sent at least one of the three, so a save of
     the Production half alone cannot clear a brand's UAT company.

     **This does widen who may set the Sandbox company** from System Admin (the
     `/api/settings/erp-interface` route) to IT Admin (this page). Stated
     rather than slipped in — and it is not an escalation in any meaningful
     sense: the same person already edits the PRODUCTION company two fields
     above, which is strictly the more consequential of the two. */
  if (
    input.bcUatId !== undefined ||
    input.bcUatName !== undefined ||
    input.bcUatConnectionId !== undefined
  ) {
    await upsertErpTargetUatSetting(
      brandCode,
      {
        bcUatId: input.bcUatId,
        bcUatName: input.bcUatName,
        bcUatConnectionId: input.bcUatConnectionId,
      },
      userId,
    );
  }

  const list = await listBrandConfigs(userId);
  return list.find((c) => c.brandCode === brandCode) ?? null;
}

export async function getBrandConfig(brandCode: string): Promise<BrandConfigPublic | null> {
  const list = await listBrandConfigs(0);
  return list.find((c) => c.brandCode === brandCode) ?? null;
}

/** ERP lookups (New Item Inventory, etc.) */
export async function resolveBrandErpTarget(brandCode: string): Promise<BrandDbTarget> {
  return resolveBrandSqlTarget(brandCode);
}

/**
 * The brand's ERP database.
 *
 * Took a `kind: "erp" | "dashboard"` until 2026-09-01. The dashboard arm served
 * `resolveBrandDashboardTarget`, which nothing in this app ever called — it was
 * kept for the Rocks Fast sibling, whose own copy of this file reads the
 * Dashboard columns. That sibling is no longer connected to this project.
 *
 * **The COLUMNS are deliberately still read and still written.** Removing the
 * round-trip would null DashboardDbConnectionId / DashboardDatabaseName on the
 * next brand save — a data change nobody would associate with a settings edit,
 * and irreversible. Deleting dead code is safe; silently clearing a column is
 * not, and the two do not have to happen together.
 */
async function resolveBrandSqlTarget(
  brandCode: string,
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

  const dbConnectionId = row.DbConnectionId;
  const databaseName = row.DatabaseName;

  if (dbConnectionId == null || !databaseName?.trim()) {
    throw new Error(`Brand "${brandCode}" has no ERP database configured`);
  }

  const DB_NAME_RE = /^[A-Za-z0-9_]+$/;
  if (!DB_NAME_RE.test(databaseName)) {
    throw new Error(`Brand "${brandCode}" has an invalid database name`);
  }

  return { dbConnectionId, databaseName };
}
