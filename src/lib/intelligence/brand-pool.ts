import type sql from "mssql";
import { getCorePool, getAppPool, sql as mssqlSql } from "@/lib/db/mssql";
import { getExternalPool } from "@/lib/db/external-pool";
import { isAppDbConnection } from "@/lib/db/app-connection";

export class BrandPoolError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "BrandPoolError";
  }
}

const DB_NAME_RE = /^[A-Za-z0-9_]+$/;

interface BrandDashboardTarget {
  dbConnectionId: number;
  databaseName: string;
}

/** Lightweight, side-effect-free read of a brand's Dashboard DB target. */
async function readBrandDashboardTarget(
  brandCode: string,
): Promise<BrandDashboardTarget | null> {
  const pool = await getCorePool();
  const result = await pool
    .request()
    .input("brand", mssqlSql.NVarChar, brandCode)
    .query(`
      SELECT DashboardDbConnectionId, DashboardDatabaseName
      FROM BrandConfig
      WHERE BrandCode = @brand AND IsActive = 1
    `);
  const row = result.recordset[0] as
    | { DashboardDbConnectionId: number | null; DashboardDatabaseName: string | null }
    | undefined;
  if (!row) return null;
  if (row.DashboardDbConnectionId == null || !row.DashboardDatabaseName) return null;
  return {
    dbConnectionId: row.DashboardDbConnectionId,
    databaseName: row.DashboardDatabaseName,
  };
}

/**
 * Resolve a brand to a connection pool for Intelligence reads.
 *
 * @throws BrandPoolError with .code:
 *   - "BRAND_NOT_CONFIGURED" if the brand has no DashboardDbConnectionId/Name.
 *   - "INVALID_DATABASE_NAME" if the DatabaseName fails the safety regex.
 *   - "POOL_UNREACHABLE" if the underlying pool connect fails.
 */
export async function getBrandDashboardPool(
  brandCode: string,
): Promise<sql.ConnectionPool> {
  const target = await readBrandDashboardTarget(brandCode);
  if (!target) {
    throw new BrandPoolError(
      `Brand "${brandCode}" has no Dashboard database configured`,
      "BRAND_NOT_CONFIGURED",
    );
  }
  if (!DB_NAME_RE.test(target.databaseName)) {
    throw new BrandPoolError(
      `Brand "${brandCode}" has an invalid Dashboard database name`,
      "INVALID_DATABASE_NAME",
    );
  }
  try {
    if (isAppDbConnection(target.dbConnectionId)) {
      return await getAppPool(target.databaseName);
    }
    return await getExternalPool(target.dbConnectionId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Pool connect failed";
    throw new BrandPoolError(
      `Cannot reach Dashboard database for brand "${brandCode}": ${msg}`,
      "POOL_UNREACHABLE",
    );
  }
}

/**
 * Enumerate all brands with a Dashboard database configured. Used by
 * apply-sql.ts and smoke-test.ts to find every target DB.
 */
export async function listConfiguredBrandTargets(): Promise<
  Array<{ brandCode: string } & BrandDashboardTarget>
> {
  const pool = await getCorePool();
  const result = await pool.request().query(`
    SELECT BrandCode, DashboardDbConnectionId, DashboardDatabaseName
    FROM BrandConfig
    WHERE IsActive = 1
      AND DashboardDbConnectionId IS NOT NULL
      AND DashboardDatabaseName IS NOT NULL
    ORDER BY BrandCode
  `);
  return result.recordset
    .map((r: Record<string, unknown>) => ({
      brandCode: r.BrandCode as string,
      dbConnectionId: r.DashboardDbConnectionId as number,
      databaseName: r.DashboardDatabaseName as string,
    }))
    .filter((t: { databaseName: string }) => DB_NAME_RE.test(t.databaseName));
}
