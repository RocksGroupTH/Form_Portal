import sql from "mssql";
import { getCorePool, sql as mssqlSql } from "@/lib/db/mssql";
import { decryptPassword, encryptPassword } from "@/lib/db/connection-crypto";
import { normalizeConnectionCode, validateConnectionCode } from "@/lib/db/connection-code";
import { applySqlPort, formatHostPort, normalizeDatabaseName, parseDatabaseInput } from "@/lib/db/sql-port";

export { normalizeConnectionCode, validateConnectionCode } from "@/lib/db/connection-code";

const isIP = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");

export function mapConnectionDbError(err: unknown): { message: string; status: number } {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("UQ_DbConnection_Code")) {
    return { message: "Connection code already exists", status: 409 };
  }
  if (msg.includes("UQ_DbConnection_Name")) {
    return { message: "Connection name already exists", status: 409 };
  }
  if (/duplicate key|UNIQUE KEY|2627|2601/i.test(msg)) {
    return { message: "Duplicate connection value", status: 409 };
  }
  return { message: msg || "Internal server error", status: 500 };
}

export interface DbConnectionRow {
  Id: number;
  Code: string;
  Name: string;
  Host: string;
  Port: number;
  DatabaseName: string | null;
  Username: string;
  PasswordEnc: string;
  Encrypt: boolean;
  TrustServerCert: boolean;
  Purpose: string | null;
  IsActive: boolean;
  LastTestAt: Date | null;
  LastTestOk: boolean | null;
  LastTestMessage: string | null;
  CreatedAt: Date;
  UpdatedAt: Date;
}

export interface DbConnectionPublic {
  id: number;
  code: string;
  name: string;
  host: string;
  port: number;
  databaseName: string | null;
  username: string;
  hasPassword: boolean;
  encrypt: boolean;
  trustServerCert: boolean;
  purpose: string | null;
  isActive: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionInput {
  code: string;
  name: string;
  host: string;
  port?: number;
  databaseName?: string | null;
  username: string;
  password?: string;
  encrypt?: boolean;
  trustServerCert?: boolean;
  purpose?: string | null;
  isActive?: boolean;
}

export interface TestConnectionInput {
  host: string;
  port?: number;
  databaseName?: string | null;
  username: string;
  password: string;
  encrypt?: boolean;
  trustServerCert?: boolean;
}

function mapPublic(row: DbConnectionRow): DbConnectionPublic {
  return {
    id: row.Id,
    code: row.Code,
    name: row.Name,
    host: row.Host,
    port: row.Port,
    databaseName: row.DatabaseName,
    username: row.Username,
    hasPassword: !!row.PasswordEnc,
    encrypt: row.Encrypt,
    trustServerCert: row.TrustServerCert,
    purpose: row.Purpose,
    isActive: row.IsActive,
    lastTestAt: row.LastTestAt ? row.LastTestAt.toISOString() : null,
    lastTestOk: row.LastTestOk,
    lastTestMessage: row.LastTestMessage,
    createdAt: row.CreatedAt.toISOString(),
    updatedAt: row.UpdatedAt.toISOString(),
  };
}

function rowFromRecord(r: Record<string, unknown>): DbConnectionRow {
  return {
    Id: r.Id as number,
    Code: r.Code as string,
    Name: r.Name as string,
    Host: r.Host as string,
    Port: r.Port as number,
    DatabaseName: (r.DatabaseName as string) ?? null,
    Username: r.Username as string,
    PasswordEnc: r.PasswordEnc as string,
    Encrypt: r.Encrypt as boolean,
    TrustServerCert: r.TrustServerCert as boolean,
    Purpose: (r.Purpose as string) ?? null,
    IsActive: r.IsActive as boolean,
    LastTestAt: (r.LastTestAt as Date) ?? null,
    LastTestOk: r.LastTestOk == null ? null : (r.LastTestOk as boolean),
    LastTestMessage: (r.LastTestMessage as string) ?? null,
    CreatedAt: r.CreatedAt as Date,
    UpdatedAt: r.UpdatedAt as Date,
  };
}

const SELECT_COLS = `
  Id, Code, Name, Host, Port, DatabaseName, Username, PasswordEnc,
  Encrypt, TrustServerCert, Purpose, IsActive,
  LastTestAt, LastTestOk, LastTestMessage, CreatedAt, UpdatedAt
`;

export async function listDbConnections(activeOnly = false): Promise<DbConnectionPublic[]> {
  const pool = await getCorePool();
  const where = activeOnly ? "WHERE IsActive = 1" : "";
  const result = await pool.request().query(`
    SELECT ${SELECT_COLS}
    FROM DbConnection
    ${where}
    ORDER BY Code
  `);
  return result.recordset.map((r: Record<string, unknown>) =>
    mapPublic(rowFromRecord(r)),
  );
}

export async function getDbConnectionById(id: number): Promise<DbConnectionRow | null> {
  const pool = await getCorePool();
  const result = await pool
    .request()
    .input("id", mssqlSql.Int, id)
    .query(`SELECT ${SELECT_COLS} FROM DbConnection WHERE Id = @id`);
  const r = result.recordset[0] as Record<string, unknown> | undefined;
  return r ? rowFromRecord(r) : null;
}

export async function getDbConnectionByName(name: string): Promise<DbConnectionRow | null> {
  const pool = await getCorePool();
  const result = await pool
    .request()
    .input("name", mssqlSql.NVarChar, name)
    .query(`SELECT ${SELECT_COLS} FROM DbConnection WHERE Name = @name AND IsActive = 1`);
  const r = result.recordset[0] as Record<string, unknown> | undefined;
  return r ? rowFromRecord(r) : null;
}

export async function getDbConnectionByCode(code: string): Promise<DbConnectionRow | null> {
  const pool = await getCorePool();
  const result = await pool
    .request()
    .input("code", mssqlSql.NVarChar, normalizeConnectionCode(code))
    .query(`SELECT ${SELECT_COLS} FROM DbConnection WHERE Code = @code AND IsActive = 1`);
  const r = result.recordset[0] as Record<string, unknown> | undefined;
  return r ? rowFromRecord(r) : null;
}

export async function createDbConnection(
  input: ConnectionInput,
  userId: number,
): Promise<DbConnectionPublic> {
  if (!input.password) throw new Error("Password is required");
  const pool = await getCorePool();
  const passwordEnc = encryptPassword(input.password);
  const code = normalizeConnectionCode(input.code);
  const codeErr = validateConnectionCode(code);
  if (codeErr) throw new Error(codeErr);

  const result = await pool
    .request()
    .input("code", mssqlSql.NVarChar, code)
    .input("name", mssqlSql.NVarChar, input.name.trim())
    .input("host", mssqlSql.NVarChar, input.host.trim())
    .input("port", mssqlSql.Int, input.port != null ? input.port : 1433)
    .input("databaseName", mssqlSql.NVarChar, parseDatabaseInput(input.databaseName ?? ""))
    .input("username", mssqlSql.NVarChar, input.username.trim())
    .input("passwordEnc", mssqlSql.NVarChar, passwordEnc)
    .input("encrypt", mssqlSql.Bit, input.encrypt !== false ? 1 : 0)
    .input("trustServerCert", mssqlSql.Bit, input.trustServerCert !== false ? 1 : 0)
    .input("purpose", mssqlSql.NVarChar, input.purpose?.trim() || null)
    .input("isActive", mssqlSql.Bit, input.isActive !== false ? 1 : 0)
    .input("createdBy", mssqlSql.Int, userId || null)
    .query(`
      INSERT INTO DbConnection (
        Code, Name, Host, Port, DatabaseName, Username, PasswordEnc,
        Encrypt, TrustServerCert, Purpose, IsActive, CreatedBy, UpdatedBy
      )
      OUTPUT INSERTED.Id
      VALUES (
        @code, @name, @host, @port, @databaseName, @username, @passwordEnc,
        @encrypt, @trustServerCert, @purpose, @isActive, @createdBy, @createdBy
      )
    `);
  const id = (result.recordset[0] as { Id: number }).Id;
  const row = await getDbConnectionById(id);
  if (!row) throw new Error("Failed to load created connection");
  return mapPublic(row);
}

export async function updateDbConnection(
  id: number,
  input: ConnectionInput,
  userId: number,
): Promise<DbConnectionPublic | null> {
  const existing = await getDbConnectionById(id);
  if (!existing) return null;

  const pool = await getCorePool();
  const req = pool.request().input("id", mssqlSql.Int, id);

  const code = normalizeConnectionCode(input.code);
  const codeErr = validateConnectionCode(code);
  if (codeErr) throw new Error(codeErr);

  const sets: string[] = [
    "Code = @code",
    "Name = @name",
    "Host = @host",
    "Port = @port",
    "DatabaseName = @databaseName",
    "Username = @username",
    "Encrypt = @encrypt",
    "TrustServerCert = @trustServerCert",
    "Purpose = @purpose",
    "IsActive = @isActive",
    "UpdatedBy = @updatedBy",
    "UpdatedAt = GETDATE()",
  ];

  req
    .input("code", mssqlSql.NVarChar, code)
    .input("name", mssqlSql.NVarChar, input.name.trim())
    .input("host", mssqlSql.NVarChar, input.host.trim())
    .input("port", mssqlSql.Int, input.port != null ? input.port : existing.Port)
    .input("databaseName", mssqlSql.NVarChar, parseDatabaseInput(input.databaseName ?? ""))
    .input("username", mssqlSql.NVarChar, input.username.trim())
    .input("encrypt", mssqlSql.Bit, input.encrypt !== false ? 1 : 0)
    .input("trustServerCert", mssqlSql.Bit, input.trustServerCert !== false ? 1 : 0)
    .input("purpose", mssqlSql.NVarChar, input.purpose?.trim() || null)
    .input("isActive", mssqlSql.Bit, input.isActive !== false ? 1 : 0)
    .input("updatedBy", mssqlSql.Int, userId || null);

  if (input.password) {
    sets.push("PasswordEnc = @passwordEnc");
    req.input("passwordEnc", mssqlSql.NVarChar, encryptPassword(input.password));
  }

  await req.query(`UPDATE DbConnection SET ${sets.join(", ")} WHERE Id = @id`);

  const row = await getDbConnectionById(id);
  return row ? mapPublic(row) : null;
}

export async function deleteDbConnection(id: number, userId: number): Promise<boolean> {
  const pool = await getCorePool();
  const result = await pool
    .request()
    .input("id", mssqlSql.Int, id)
    .input("updatedBy", mssqlSql.Int, userId || null)
    .query(`
      UPDATE DbConnection
      SET IsActive = 0, UpdatedBy = @updatedBy, UpdatedAt = GETDATE()
      WHERE Id = @id
    `);
  return (result.rowsAffected[0] ?? 0) > 0;
}

export async function recordConnectionTest(
  id: number,
  ok: boolean,
  message: string,
): Promise<void> {
  const pool = await getCorePool();
  await pool
    .request()
    .input("id", mssqlSql.Int, id)
    .input("ok", mssqlSql.Bit, ok ? 1 : 0)
    .input("message", mssqlSql.NVarChar, message.slice(0, 500))
    .query(`
      UPDATE DbConnection
      SET LastTestAt = GETDATE(), LastTestOk = @ok, LastTestMessage = @message, UpdatedAt = GETDATE()
      WHERE Id = @id
    `);
}

function buildPoolConfig(
  host: string,
  port: number,
  databaseName: string | null | undefined,
  username: string,
  password: string,
  encrypt: boolean,
  trustServerCert: boolean,
): sql.config {
  const base: sql.config = {
    server: host,
    user: username,
    password,
    options: {
      encrypt,
      trustServerCertificate: trustServerCert,
      serverName: isIP(host) ? "localhost" : undefined,
    },
    pool: { max: 2, min: 0, idleTimeoutMillis: 10000 },
    connectionTimeout: 15000,
    requestTimeout: 15000,
  };
  const db = normalizeDatabaseName(databaseName);
  if (db) base.database = db;
  return applySqlPort(base, port);
}

/** Test MSSQL connectivity (opens pool, runs SELECT 1, closes) */
export async function testMssqlConnection(
  input: TestConnectionInput,
): Promise<{ ok: boolean; message: string }> {
  const port = input.port != null ? input.port : 1433;
  const config = buildPoolConfig(
    input.host.trim(),
    port,
    input.databaseName,
    input.username.trim(),
    input.password,
    input.encrypt !== false,
    input.trustServerCert !== false,
  );

  let pool: sql.ConnectionPool | null = null;
  try {
    pool = new sql.ConnectionPool(config);
    await pool.connect();
    await pool.request().query("SELECT 1 AS ok");
    return { ok: true, message: "Connection successful" };
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Connection failed";
    const loginMatch = /login failed for user '([^']+)'/i.exec(raw);
    const msg = loginMatch
      ? `SQL login failed for user '${loginMatch[1]}' on ${formatHostPort(input.host.trim(), port)} — ตรวจสอบ username/password บน SQL Server (ถ้าแก้รหัสใหม่ ให้ใส่ในช่อง Password แล้วกด Test)`
      : raw;
    return { ok: false, message: msg };
  } finally {
    if (pool) {
      try {
        await pool.close();
      } catch {
        /* ignore */
      }
    }
  }
}

export async function testStoredConnection(id: number): Promise<{ ok: boolean; message: string }> {
  return testStoredConnectionWithOverrides(id);
}

/** Test saved connection; optional overrides use form values but keep stored password if password omitted */
export async function testStoredConnectionWithOverrides(
  id: number,
  overrides?: Partial<TestConnectionInput>,
): Promise<{ ok: boolean; message: string }> {
  const row = await getDbConnectionById(id);
  if (!row) return { ok: false, message: "Connection not found" };
  if (!row.IsActive) return { ok: false, message: "Connection is inactive" };

  let password: string;
  try {
    password = overrides?.password?.trim() ? overrides.password : decryptPassword(row.PasswordEnc);
  } catch {
    return {
      ok: false,
      message:
        "Cannot decrypt stored password (CONNECTION_ENCRYPTION_KEY may have changed). Re-enter the password and test again.",
    };
  }

  if (!password) {
    return {
      ok: false,
      message: "No password stored. Enter the SQL password in the form, then click Test.",
    };
  }

  const result = await testMssqlConnection({
    host: (overrides?.host ?? row.Host).trim(),
    port: overrides?.port != null ? overrides.port : row.Port,
    databaseName: overrides?.databaseName !== undefined ? overrides.databaseName : row.DatabaseName,
    username: (overrides?.username ?? row.Username).trim(),
    password,
    encrypt: overrides?.encrypt ?? row.Encrypt,
    trustServerCert: overrides?.trustServerCert ?? row.TrustServerCert,
  });

  await recordConnectionTest(id, result.ok, result.message);
  return result;
}

export { mapPublic as toPublicConnection };
