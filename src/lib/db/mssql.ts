import sql from "mssql";
import { env } from "@/env";
import { applySqlPort } from "@/lib/db/sql-port";

const TH_OFFSET_MS = 7 * 60 * 60 * 1000;

export function fixThaiDate(d: Date | null | undefined): Date | null {
  if (!d) return null;
  return new Date(d.getTime() - TH_OFFSET_MS);
}

/* ── Shared connection options ── */

const isIP = (s: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(s) || s.includes(":");

const sharedOptions: sql.config["options"] = {
  encrypt: env.MSSQL_ENCRYPT ?? false,
  trustServerCertificate: env.MSSQL_TRUST_CERT !== false,
  // Avoid DEP0123: TLS ServerName must not be an IP address (RFC 6066).
  // When host is an IP and trustServerCertificate is on, use 'localhost' for SNI.
  serverName: env.MSSQL_TLS_SERVER_NAME || (isIP(env.MSSQL_HOST) ? "localhost" : undefined),
};

const sharedPool: sql.config["pool"] = {
  max: 30,
  min: 0,
  idleTimeoutMillis: 30000,
};

function makeConfig(database: string): sql.config {
  return applySqlPort(
    {
      server: env.MSSQL_HOST,
      database,
      user: env.MSSQL_USER,
      password: env.MSSQL_PASSWORD,
      options: sharedOptions,
      pool: sharedPool,
    },
    env.MSSQL_PORT,
  );
}

/* ── Named pool registry ── */

const pools = new Map<string, Promise<sql.ConnectionPool>>();

function getNamedPool(database: string): Promise<sql.ConnectionPool> {
  let poolPromise = pools.get(database);
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(makeConfig(database)).connect().catch((err) => {
      pools.delete(database);
      throw err;
    });
    pools.set(database, poolPromise);
  }
  return poolPromise;
}

/* ── Public pool accessors ── */

/**
 * Core DB — configuration and shared lookups.
 *
 * User identity is no longer here: it moved to the form database and is reached
 * only through `@/lib/team-member/service`. Fast_Core still holds the copy the
 * Rocks Fast sibling serves from, so a query pointed here would read that app's
 * roster without erroring.
 */
export function getCorePool(): Promise<sql.ConnectionPool> {
  return getNamedPool(env.MSSQL_CORE_DATABASE);
}

/**
 * Form DB — form definitions, submissions, approvals, and all Acc* tables.
 *
 * Which physical database this is depends on the route: a form flagged UAT at
 * Settings → Form Environment resolves to MSSQL_FORM_UAT_DATABASE, everything
 * else to MSSQL_FORM_DATABASE. The signature stays argument-free so none of its
 * call sites need to know.
 *
 * The dynamic import breaks a module cycle: form-environment imports its
 * service, which imports this file.
 */
export async function getFormPool(): Promise<sql.ConnectionPool> {
  const { resolveFormEnvironment } = await import("@/lib/form-environment");
  const e = await resolveFormEnvironment();
  return getNamedPool(
    e === "UAT" ? env.MSSQL_FORM_UAT_DATABASE : env.MSSQL_FORM_DATABASE,
  );
}

/** The production form database, whatever the current route resolves to. */
export function getProductionFormPool(): Promise<sql.ConnectionPool> {
  return getNamedPool(env.MSSQL_FORM_DATABASE);
}

/** The UAT form database, whatever the current route resolves to. */
export function getUatFormPool(): Promise<sql.ConnectionPool> {
  return getNamedPool(env.MSSQL_FORM_UAT_DATABASE);
}

/**
 * Fast_Data — no longer read by any code under src/. TravelProvince (AP-17
 * province lookups) moved to Rocks_Portal_Form in migrations 104/105; the five
 * Business Central sync tables moved to Rocks_ERP_Data in migrations 101/102
 * (use getErpDataPool() for those). Fast_Data now holds only synonyms behind
 * both moves, kept for the Rocks Fast and ACC Portal siblings, which still
 * name these tables two-part against it.
 *
 * The accessor stays defined because scripts/checks/verify-travel-province-move.ts
 * and verify-erp-data-move.ts both read through those synonyms to confirm they
 * still resolve to the new homes.
 */
export function getDataPool(): Promise<sql.ConnectionPool> {
  return getNamedPool(env.MSSQL_DATA_DATABASE);
}

/**
 * Rocks_ERP_Data — the mirror of Business Central: ErpAccounts,
 * ErpDimensionValue, ErpGeneralJournalBatch, ErpBankAccountCard and ErpSyncLog.
 *
 * Sync output only. The per-brand and per-form choices this app makes about
 * where money posts — AccBrandGlAccount, AccBrandJournalBatch and the rest —
 * stay in the form database and are reached through getFormPool().
 */
export function getErpDataPool(): Promise<sql.ConnectionPool> {
  return getNamedPool(env.MSSQL_ERP_DATA_DATABASE);
}

/**
 * Get a pool on the app's MSSQL server (MSSQL_* env) for an arbitrary database.
 * Used for databases outside the three named pools above — e.g. Rocks_Portal_HR.
 */
export function getAppPool(databaseName: string): Promise<sql.ConnectionPool> {
  return getNamedPool(databaseName);
}

/** @deprecated Use getCorePool() — kept for backward compatibility */
export const getPool = getCorePool;

/* ── Cleanup ── */

if (typeof process !== "undefined") {
  const cleanup = () => {
    pools.forEach((p) => p.then((c) => c.close()).catch(() => {}));
    pools.clear();
  };
  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
}

export { sql };
