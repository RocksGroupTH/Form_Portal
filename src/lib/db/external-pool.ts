import sql from "mssql";
import { env } from "@/env";
import { APP_DB_CONNECTION_ID } from "@/lib/db/app-connection";
import { applySqlPort, normalizeDatabaseName } from "@/lib/db/sql-port";
import { decryptPassword } from "@/lib/db/connection-crypto";
import { getDbConnectionByCode, getDbConnectionById, getDbConnectionByName } from "@/lib/db/db-connection";

const isIP = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");

const externalPools = new Map<string, Promise<sql.ConnectionPool>>();

function poolKey(id: number): string {
  return `ext:${id}`;
}

/** Remove cached pool after connection credentials change */
export function invalidateExternalPool(connectionId: number): void {
  const key = poolKey(connectionId);
  const existing = externalPools.get(key);
  if (existing) {
    existing.then((p) => p.close()).catch(() => {});
    externalPools.delete(key);
  }
}

async function connectAppMssql(): Promise<sql.ConnectionPool> {
  const base: sql.config = {
    server: env.MSSQL_HOST,
    user: env.MSSQL_USER,
    password: env.MSSQL_PASSWORD,
    options: {
      encrypt: env.MSSQL_ENCRYPT ?? false,
      trustServerCertificate: env.MSSQL_TRUST_CERT !== false,
      serverName: env.MSSQL_TLS_SERVER_NAME || (isIP(env.MSSQL_HOST) ? "localhost" : undefined),
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    connectionTimeout: 15000,
    requestTimeout: 30000,
  };
  const pool = new sql.ConnectionPool(applySqlPort(base, env.MSSQL_PORT));
  await pool.connect();
  return pool;
}

async function connectFromRow(row: {
  Host: string;
  Port: number;
  DatabaseName: string | null;
  Username: string;
  PasswordEnc: string;
  Encrypt: boolean;
  TrustServerCert: boolean;
}): Promise<sql.ConnectionPool> {
  const password = decryptPassword(row.PasswordEnc);
  const base: sql.config = {
    server: row.Host,
    user: row.Username,
    password,
    options: {
      encrypt: row.Encrypt,
      trustServerCertificate: row.TrustServerCert,
      serverName: isIP(row.Host) ? "localhost" : undefined,
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    connectionTimeout: 15000,
    requestTimeout: 30000,
  };
  const db = normalizeDatabaseName(row.DatabaseName);
  if (db) base.database = db;
  const pool = new sql.ConnectionPool(applySqlPort(base, row.Port));
  await pool.connect();
  return pool;
}

/** Get a cached connection pool for an external server by Id (0 = app MSSQL_HOST from .env) */
export async function getExternalPool(connectionId: number): Promise<sql.ConnectionPool> {
  const key = poolKey(connectionId);
  let poolPromise = externalPools.get(key);
  if (!poolPromise) {
    poolPromise = (async () => {
      if (connectionId === APP_DB_CONNECTION_ID) {
        return connectAppMssql();
      }
      const row = await getDbConnectionById(connectionId);
      if (!row || !row.IsActive) {
        throw new Error(`External connection ${connectionId} not found or inactive`);
      }
      return connectFromRow(row);
    })().catch((err) => {
      externalPools.delete(key);
      throw err;
    });
    externalPools.set(key, poolPromise);
  }
  return poolPromise;
}

/** Get a cached connection pool by connection Name */
export async function getExternalPoolByName(name: string): Promise<sql.ConnectionPool> {
  const row = await getDbConnectionByName(name);
  if (!row) throw new Error(`External connection not found: ${name}`);
  return getExternalPool(row.Id);
}

/** Get a cached connection pool by connection Code */
export async function getExternalPoolByCode(code: string): Promise<sql.ConnectionPool> {
  const row = await getDbConnectionByCode(code);
  if (!row) throw new Error(`External connection not found: ${code}`);
  return getExternalPool(row.Id);
}

if (typeof process !== "undefined") {
  const cleanup = () => {
    externalPools.forEach((p) => p.then((c) => c.close()).catch(() => {}));
    externalPools.clear();
  };
  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
}
