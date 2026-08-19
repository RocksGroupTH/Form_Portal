import { getCorePool, sql as mssqlSql } from "@/lib/db/mssql";
import {
  assertApiDestination,
  assertOAuthDestination,
  bcSecretRebindRequired,
} from "@/lib/bc/bc-destination";
import { decryptPassword, encryptPassword } from "@/lib/db/connection-crypto";
import { normalizeConnectionCode, validateConnectionCode } from "@/lib/db/connection-code";
import {
  refreshBcOAuthToken,
  requestBcOAuthToken,
  testBcApiAccess,
  type BcTokenResult,
} from "@/lib/bc/bc-auth";

export interface BcConnectionRow {
  Id: number;
  Code: string;
  Name: string;
  OAuthUrl: string;
  ClientId: string;
  ClientSecretEnc: string;
  Scope: string | null;
  Username: string | null;
  PasswordEnc: string | null;
  BaseUrl: string;
  AccessTokenEnc: string | null;
  RefreshTokenEnc: string | null;
  TokenExpiresAt: Date | null;
  IsActive: boolean;
  LastTestAt: Date | null;
  LastTestOk: boolean | null;
  LastTestMessage: string | null;
  CreatedAt: Date;
  UpdatedAt: Date;
}

export interface BcConnectionPublic {
  id: number;
  code: string;
  name: string;
  oauthUrl: string;
  clientId: string;
  hasClientSecret: boolean;
  scope: string | null;
  username: string | null;
  hasPassword: boolean;
  baseUrl: string;
  hasToken: boolean;
  tokenExpiresAt: string | null;
  isActive: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BcConnectionInput {
  code: string;
  name: string;
  oauthUrl: string;
  clientId: string;
  clientSecret?: string;
  scope?: string | null;
  username?: string | null;
  password?: string;
  baseUrl: string;
  isActive?: boolean;
}

const SELECT_COLS = `
  Id, Code, Name, OAuthUrl, ClientId, ClientSecretEnc, Scope, Username, PasswordEnc,
  BaseUrl, AccessTokenEnc, RefreshTokenEnc, TokenExpiresAt, IsActive,
  LastTestAt, LastTestOk, LastTestMessage, CreatedAt, UpdatedAt
`;

function rowFromRecord(r: Record<string, unknown>): BcConnectionRow {
  return {
    Id: r.Id as number,
    Code: r.Code as string,
    Name: r.Name as string,
    OAuthUrl: r.OAuthUrl as string,
    ClientId: r.ClientId as string,
    ClientSecretEnc: r.ClientSecretEnc as string,
    Scope: (r.Scope as string) ?? null,
    Username: (r.Username as string) ?? null,
    PasswordEnc: (r.PasswordEnc as string) ?? null,
    BaseUrl: r.BaseUrl as string,
    AccessTokenEnc: (r.AccessTokenEnc as string) ?? null,
    RefreshTokenEnc: (r.RefreshTokenEnc as string) ?? null,
    TokenExpiresAt: (r.TokenExpiresAt as Date) ?? null,
    IsActive: r.IsActive as boolean,
    LastTestAt: (r.LastTestAt as Date) ?? null,
    LastTestOk: r.LastTestOk == null ? null : (r.LastTestOk as boolean),
    LastTestMessage: (r.LastTestMessage as string) ?? null,
    CreatedAt: r.CreatedAt as Date,
    UpdatedAt: r.UpdatedAt as Date,
  };
}

export function mapBcPublic(row: BcConnectionRow): BcConnectionPublic {
  return {
    id: row.Id,
    code: row.Code,
    name: row.Name,
    oauthUrl: row.OAuthUrl,
    clientId: row.ClientId,
    hasClientSecret: !!row.ClientSecretEnc,
    scope: row.Scope,
    username: row.Username,
    hasPassword: !!row.PasswordEnc,
    baseUrl: row.BaseUrl,
    hasToken: !!row.AccessTokenEnc,
    tokenExpiresAt: row.TokenExpiresAt ? row.TokenExpiresAt.toISOString() : null,
    isActive: row.IsActive,
    lastTestAt: row.LastTestAt ? row.LastTestAt.toISOString() : null,
    lastTestOk: row.LastTestOk,
    lastTestMessage: row.LastTestMessage,
    createdAt: row.CreatedAt.toISOString(),
    updatedAt: row.UpdatedAt.toISOString(),
  };
}

export function mapBcConnectionDbError(err: unknown): { message: string; status: number } {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("UQ_BcConnection_Code")) {
    return { message: "BC connection code already exists", status: 409 };
  }
  if (/duplicate key|UNIQUE KEY|2627|2601/i.test(msg)) {
    return { message: "Duplicate BC connection value", status: 409 };
  }
  return { message: msg || "Internal server error", status: 500 };
}

export async function listBcConnections(): Promise<BcConnectionPublic[]> {
  const pool = await getCorePool();
  const result = await pool.request().query(`
    SELECT ${SELECT_COLS}
    FROM BcConnection
    ORDER BY Code
  `);
  return result.recordset.map((r: Record<string, unknown>) =>
    mapBcPublic(rowFromRecord(r)),
  );
}

export async function getBcConnectionById(id: number): Promise<BcConnectionRow | null> {
  const pool = await getCorePool();
  const result = await pool
    .request()
    .input("id", mssqlSql.Int, id)
    .query(`SELECT ${SELECT_COLS} FROM BcConnection WHERE Id = @id`);
  const r = result.recordset[0] as Record<string, unknown> | undefined;
  return r ? rowFromRecord(r) : null;
}

export async function getBcConnectionByCode(code: string): Promise<BcConnectionRow | null> {
  const pool = await getCorePool();
  const result = await pool
    .request()
    .input("code", mssqlSql.NVarChar, normalizeConnectionCode(code))
    .query(`SELECT ${SELECT_COLS} FROM BcConnection WHERE Code = @code AND IsActive = 1`);
  const r = result.recordset[0] as Record<string, unknown> | undefined;
  return r ? rowFromRecord(r) : null;
}

function decryptSecret(enc: string | null): string | null {
  if (!enc) return null;
  return decryptPassword(enc);
}

async function saveTokens(
  id: number,
  tokens: BcTokenResult,
): Promise<void> {
  const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
  const pool = await getCorePool();
  await pool
    .request()
    .input("id", mssqlSql.Int, id)
    .input("accessTokenEnc", mssqlSql.NVarChar, encryptPassword(tokens.accessToken))
    .input(
      "refreshTokenEnc",
      mssqlSql.NVarChar,
      tokens.refreshToken ? encryptPassword(tokens.refreshToken) : null,
    )
    .input("tokenExpiresAt", mssqlSql.DateTime2, expiresAt)
    .query(`
      UPDATE BcConnection
      SET AccessTokenEnc = @accessTokenEnc,
          RefreshTokenEnc = COALESCE(@refreshTokenEnc, RefreshTokenEnc),
          TokenExpiresAt = @tokenExpiresAt,
          UpdatedAt = GETDATE()
      WHERE Id = @id
    `);
}

/** Obtain or refresh OAuth token for a stored connection. */
export async function refreshBcConnectionToken(
  id: number,
): Promise<{ ok: boolean; message: string; tokenExpiresAt?: string }> {
  const row = await getBcConnectionById(id);
  if (!row) return { ok: false, message: "Connection not found" };
  if (!row.IsActive) return { ok: false, message: "Connection is inactive" };

  let clientSecret: string;
  try {
    clientSecret = decryptPassword(row.ClientSecretEnc);
  } catch {
    return {
      ok: false,
      message:
        "Cannot decrypt client secret (CONNECTION_ENCRYPTION_KEY may have changed). Re-enter client secret.",
    };
  }

  const password = row.PasswordEnc ? decryptSecret(row.PasswordEnc) : null;
  const refreshToken = row.RefreshTokenEnc ? decryptSecret(row.RefreshTokenEnc) : null;

  const tokenStillValid =
    row.TokenExpiresAt && row.TokenExpiresAt.getTime() > Date.now() + 60_000 && row.AccessTokenEnc;

  if (tokenStillValid) {
    return {
      ok: true,
      message: "Token is still valid",
      tokenExpiresAt: row.TokenExpiresAt!.toISOString(),
    };
  }

  try {
    let tokens: BcTokenResult;

    if (refreshToken) {
      try {
        tokens = await refreshBcOAuthToken({
          oauthUrl: row.OAuthUrl,
          clientId: row.ClientId,
          clientSecret,
          refreshToken,
          scope: row.Scope,
        });
      } catch {
        tokens = await requestBcOAuthToken({
          oauthUrl: row.OAuthUrl,
          clientId: row.ClientId,
          clientSecret,
          scope: row.Scope,
          username: row.Username,
          password,
        });
      }
    } else {
      tokens = await requestBcOAuthToken({
        oauthUrl: row.OAuthUrl,
        clientId: row.ClientId,
        clientSecret,
        scope: row.Scope,
        username: row.Username,
        password,
      });
    }

    await saveTokens(id, tokens);
    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);
    return {
      ok: true,
      message: "Token obtained successfully",
      tokenExpiresAt: expiresAt.toISOString(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token request failed";
    return { ok: false, message };
  }
}

/** Get valid access token (refreshes if expired). */
export async function getBcAccessToken(code: string): Promise<string> {
  const row = await getBcConnectionByCode(code);
  if (!row) throw new Error(`BC connection not found: ${code}`);

  const refresh = await refreshBcConnectionToken(row.Id);
  if (!refresh.ok) throw new Error(refresh.message);

  const updated = await getBcConnectionById(row.Id);
  if (!updated?.AccessTokenEnc) throw new Error("No access token after refresh");
  return decryptPassword(updated.AccessTokenEnc);
}

export async function testBcConnection(id: number): Promise<{ ok: boolean; message: string }> {
  const tokenResult = await refreshBcConnectionToken(id);
  if (!tokenResult.ok) {
    await recordBcConnectionTest(id, false, tokenResult.message);
    return tokenResult;
  }

  const row = await getBcConnectionById(id);
  if (!row?.AccessTokenEnc) {
    const msg = "No access token available";
    await recordBcConnectionTest(id, false, msg);
    return { ok: false, message: msg };
  }

  try {
    const accessToken = decryptPassword(row.AccessTokenEnc);
    await testBcApiAccess(row.BaseUrl, accessToken);
    const msg = "OAuth token OK — BC API reachable";
    await recordBcConnectionTest(id, true, msg);
    return { ok: true, message: msg };
  } catch (err) {
    const message = err instanceof Error ? err.message : "BC API test failed";
    await recordBcConnectionTest(id, false, message);
    return { ok: false, message };
  }
}

export async function recordBcConnectionTest(
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
      UPDATE BcConnection
      SET LastTestAt = GETDATE(), LastTestOk = @ok, LastTestMessage = @message, UpdatedAt = GETDATE()
      WHERE Id = @id
    `);
}

export async function createBcConnection(
  input: BcConnectionInput,
  userId: number,
): Promise<BcConnectionPublic> {
  if (!input.clientSecret?.trim()) throw new Error("Client secret is required");

  const code = normalizeConnectionCode(input.code);
  const codeErr = validateConnectionCode(code);
  if (codeErr) throw new Error(codeErr);

  const pool = await getCorePool();
  const result = await pool
    .request()
    .input("code", mssqlSql.NVarChar, code)
    .input("name", mssqlSql.NVarChar, input.name.trim())
    .input("oauthUrl", mssqlSql.NVarChar, input.oauthUrl.trim())
    .input("clientId", mssqlSql.NVarChar, input.clientId.trim())
    .input("clientSecretEnc", mssqlSql.NVarChar, encryptPassword(input.clientSecret))
    .input("scope", mssqlSql.NVarChar, input.scope?.trim() || null)
    .input("username", mssqlSql.NVarChar, input.username?.trim() || null)
    .input(
      "passwordEnc",
      mssqlSql.NVarChar,
      input.password?.trim() ? encryptPassword(input.password) : null,
    )
    .input("baseUrl", mssqlSql.NVarChar, input.baseUrl.trim())
    .input("isActive", mssqlSql.Bit, input.isActive !== false ? 1 : 0)
    .input("createdBy", mssqlSql.Int, userId || null)
    .query(`
      INSERT INTO BcConnection (
        Code, Name, OAuthUrl, ClientId, ClientSecretEnc, Scope, Username, PasswordEnc,
        BaseUrl, IsActive, CreatedBy, UpdatedBy
      )
      OUTPUT INSERTED.Id
      VALUES (
        @code, @name, @oauthUrl, @clientId, @clientSecretEnc, @scope, @username, @passwordEnc,
        @baseUrl, @isActive, @createdBy, @createdBy
      )
    `);

  const id = (result.recordset[0] as { Id: number }).Id;
  const row = await getBcConnectionById(id);
  if (!row) throw new Error("Failed to load created BC connection");
  return mapBcPublic(row);
}

/**
 * Update a BC connection.
 *
 * Two destination rules, both enforced here rather than at the route so a second
 * caller cannot skip them:
 *
 *  - `oauthUrl` and `baseUrl` must name approved Business Central hosts — they
 *    are the addresses the stored client secret and bearer token get sent to;
 *  - moving the token endpoint or renaming the client requires the client secret
 *    to be supplied again, and changing the username on a password-grant
 *    connection requires the password. The form omits both fields when they have
 *    not been retyped, so without this an edit could repoint the destination and
 *    leave the stored secret behind to be sent to it. See `@/lib/bc/bc-destination`.
 */
export async function updateBcConnection(
  id: number,
  input: BcConnectionInput,
  userId: number,
): Promise<BcConnectionPublic | null> {
  const existing = await getBcConnectionById(id);
  if (!existing) return null;

  const code = normalizeConnectionCode(input.code);
  const codeErr = validateConnectionCode(code);
  if (codeErr) throw new Error(codeErr);

  assertOAuthDestination(input.oauthUrl);
  assertApiDestination(input.baseUrl);

  const rebind = bcSecretRebindRequired({
    stored: {
      oauthUrl: existing.OAuthUrl,
      clientId: existing.ClientId,
      username: existing.Username,
    },
    next: {
      oauthUrl: input.oauthUrl,
      clientId: input.clientId,
      username: input.username,
    },
    clientSecretSupplied: !!input.clientSecret?.trim(),
    passwordSupplied: !!input.password?.trim(),
  });
  if (rebind.length > 0) {
    throw new Error(
      `Re-enter the ${rebind.includes("username") ? "password" : "client secret"} before changing ${rebind.join(" / ")} — a stored secret is only ever sent to the destination and client it was stored against.`,
    );
  }

  const pool = await getCorePool();
  const req = pool.request().input("id", mssqlSql.Int, id);

  const sets: string[] = [
    "Code = @code",
    "Name = @name",
    "OAuthUrl = @oauthUrl",
    "ClientId = @clientId",
    "Scope = @scope",
    "Username = @username",
    "BaseUrl = @baseUrl",
    "IsActive = @isActive",
    "UpdatedBy = @updatedBy",
    "UpdatedAt = GETDATE()",
  ];

  req
    .input("code", mssqlSql.NVarChar, code)
    .input("name", mssqlSql.NVarChar, input.name.trim())
    .input("oauthUrl", mssqlSql.NVarChar, input.oauthUrl.trim())
    .input("clientId", mssqlSql.NVarChar, input.clientId.trim())
    .input("scope", mssqlSql.NVarChar, input.scope?.trim() || null)
    .input("username", mssqlSql.NVarChar, input.username?.trim() || null)
    .input("baseUrl", mssqlSql.NVarChar, input.baseUrl.trim())
    .input("isActive", mssqlSql.Bit, input.isActive !== false ? 1 : 0)
    .input("updatedBy", mssqlSql.Int, userId || null);

  if (input.clientSecret?.trim()) {
    sets.push("ClientSecretEnc = @clientSecretEnc");
    req.input("clientSecretEnc", mssqlSql.NVarChar, encryptPassword(input.clientSecret));
  }

  if (input.password !== undefined) {
    sets.push("PasswordEnc = @passwordEnc");
    req.input(
      "passwordEnc",
      mssqlSql.NVarChar,
      input.password.trim() ? encryptPassword(input.password) : null,
    );
  }

  await req.query(`UPDATE BcConnection SET ${sets.join(", ")} WHERE Id = @id`);

  const row = await getBcConnectionById(id);
  return row ? mapBcPublic(row) : null;
}

export async function deleteBcConnection(id: number, userId: number): Promise<boolean> {
  const pool = await getCorePool();
  const result = await pool
    .request()
    .input("id", mssqlSql.Int, id)
    .input("updatedBy", mssqlSql.Int, userId || null)
    .query(`
      UPDATE BcConnection
      SET IsActive = 0, UpdatedBy = @updatedBy, UpdatedAt = GETDATE()
      WHERE Id = @id
    `);
  return (result.rowsAffected[0] ?? 0) > 0;
}
