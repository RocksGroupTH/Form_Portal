/**
 * The API-key registry: `Rocks_Portal_Form.dbo.ApiKey` plus its change log.
 * See `migrations/116_portal_form_api_key.sql` for why it lives there, why
 * there is no UAT twin, and why `ExpiresAt NULL` is the whole "no expiry"
 * story.
 *
 * Three rules this module exists to hold:
 *
 * 1. **A stored key is never handed back to a browser.** Nothing here returns a
 *    plaintext value to a route that renders; `listApiKeys` returns a mask.
 *    `resolveApiKey` returns the value and is for server-side callers only —
 *    the thing that then calls Anthropic or Google, never a response body.
 * 2. **Nothing is stored unencrypted.** Every write goes through
 *    `encryptSecret`, and `assertEncryptionReady` refuses the write outright
 *    when `CONNECTION_ENCRYPTION_KEY` is unset rather than falling back to
 *    plaintext.
 * 3. **A change and its log row commit together.** Both happen in one
 *    transaction, so there is no way to alter a key and leave no trace — the
 *    same shape `logManagerOnBehalf` uses for approvals.
 */
import { getProductionFormPool, sql } from "@/lib/db/mssql";
import { encryptSecret, decryptSecret, isEncryptionConfigured } from "@/lib/db/connection-crypto";
import { teamMemberTableRef } from "@/lib/team-member/service";
import { getAppSetting } from "@/lib/app-settings";
import { apiKeyCodeError, apiKeyNameError, normalizeApiKeyCode } from "./codes";
import { env } from "@/env";

export type ApiKeyAction =
  | "created"
  | "renamed"
  | "expiry_changed"
  | "secret_rotated"
  | "deactivated"
  | "reactivated";

export interface ApiKeyRow {
  id: number;
  code: string;
  name: string;
  /** `••••abcd`, or null when the stored box could not be opened. */
  masked: string | null;
  /**
   * True when decryption failed — a wrong or rotated `CONNECTION_ENCRYPTION_KEY`.
   * Surfaced rather than thrown so one unreadable row cannot take the page down,
   * and so the cause is named instead of showing an empty mask that looks fine.
   */
  unreadable: boolean;
  /** `YYYY-MM-DD`, or null for no expiry. */
  expiresAt: string | null;
  isActive: boolean;
  updatedAt: string;
  updatedByName: string | null;
}

export interface ApiKeyLogRow {
  id: number;
  action: ApiKeyAction;
  detail: string | null;
  changedAt: string;
  changedByName: string | null;
}

export interface ApiKeyResolution {
  value: string | null;
  /** Where it came from: this registry, the old Fast_Core setting, or `.env`. */
  source: "db" | "legacy" | "env" | null;
  /** Only set when the value came from the registry. */
  expiresAt: string | null;
}

/* ─────────────────────────── helpers ─────────────────────────── */

// `normalizeApiKeyCode` now lives in `./codes`, which imports nothing, so the
// settings dialog can call the same function instead of retyping its regex.
// Re-exported because this module is the registry's public face.
export { normalizeApiKeyCode };

/** `••••` plus the last four, matching what the Google Maps route already shows. */
export function maskSecret(value: string): string {
  return value.length <= 4 ? "••••" : `••••${value.slice(-4)}`;
}

function assertEncryptionReady(): void {
  if (!isEncryptionConfigured()) {
    throw new Error(
      "ยังไม่ได้ตั้งค่า CONNECTION_ENCRYPTION_KEY — บันทึก API key ไม่ได้ (สร้างด้วย: openssl rand -base64 32)",
    );
  }
}

/** A DATE column comes back as a Date; render it with local getters, never toISOString. */
function toYmd(d: Date | null | undefined): string | null {
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * `.env` values by code — the last resort, and the only one that still works
 * when the form database is unreachable.
 */
function envValueFor(code: string): string | null {
  switch (code) {
    case "ANTHROPIC_API_KEY":
      return env.ANTHROPIC_API_KEY?.trim() || null;
    case "GOOGLE_MAPS_API_KEY":
      return env.GOOGLE_MAPS_API_KEY?.trim() || env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() || null;
    case "ORS_API_KEY":
      return env.ORS_API_KEY?.trim() || null;
    default:
      return null;
  }
}

/** Codes that used to live in `Fast_Core.AppSetting` and may still be there. */
const LEGACY_APP_SETTING_CODES = ["GOOGLE_MAPS_API_KEY", "ORS_API_KEY"];

/* ─────────────────────────── reads ─────────────────────────── */

/**
 * Resolve a key for use. **Server-side callers only** — the value must not
 * reach a response body.
 *
 * Order: this registry, then the old `Fast_Core.AppSetting` row, then `.env`.
 * The middle step is what lets the two existing keys keep working before
 * anybody has entered them here, and it is why the move needed no flag day.
 *
 * Expiry is deliberately not consulted. See `./expiry.ts`.
 */
export async function resolveApiKey(code: string): Promise<ApiKeyResolution> {
  try {
    const pool = await getProductionFormPool();
    const r = await pool
      .request()
      .input("code", sql.NVarChar, code)
      .query(`SELECT TOP 1 SecretEnc, ExpiresAt FROM [dbo].[ApiKey] WHERE Code = @code AND IsActive = 1`);
    const row = r.recordset[0];
    if (row?.SecretEnc) {
      // A row that cannot be decrypted is not "no key" — falling through to a
      // stale `.env` value would silently use a credential the admin believes
      // they replaced. Report nothing found and let the caller's 503 stand.
      const value = decryptSecret(row.SecretEnc as string);
      return { value, source: "db", expiresAt: toYmd(row.ExpiresAt as Date | null) };
    }
  } catch {
    // Database down, table not yet created, key undecryptable — fall through to
    // the sources that do not need it.
  }

  if (LEGACY_APP_SETTING_CODES.indexOf(code) >= 0) {
    try {
      const legacy = (await getAppSetting(code))?.trim();
      if (legacy) return { value: legacy, source: "legacy", expiresAt: null };
    } catch {
      /* Fast_Core unreachable — env is still worth trying */
    }
  }

  const fromEnv = envValueFor(code);
  return fromEnv
    ? { value: fromEnv, source: "env", expiresAt: null }
    : { value: null, source: null, expiresAt: null };
}

export async function listApiKeys(): Promise<ApiKeyRow[]> {
  const pool = await getProductionFormPool();
  const r = await pool.request().query(`
    SELECT k.Id, k.Code, k.Name, k.SecretEnc, k.ExpiresAt, k.IsActive, k.UpdatedAt,
           u.FullName AS UpdatedByName
    FROM [dbo].[ApiKey] k
    LEFT JOIN ${teamMemberTableRef()} u ON u.Id = k.UpdatedBy
    ORDER BY k.IsActive DESC, k.Code ASC
  `);
  return (r.recordset as Record<string, unknown>[]).map((x) => {
    let masked: string | null = null;
    let unreadable = false;
    try {
      masked = maskSecret(decryptSecret(x.SecretEnc as string));
    } catch {
      unreadable = true;
    }
    return {
      id: x.Id as number,
      code: x.Code as string,
      name: x.Name as string,
      masked,
      unreadable,
      expiresAt: toYmd(x.ExpiresAt as Date | null),
      isActive: !!x.IsActive,
      updatedAt: (x.UpdatedAt as Date).toISOString(),
      updatedByName: (x.UpdatedByName as string | null) ?? null,
    };
  });
}

export async function listApiKeyLog(apiKeyId: number): Promise<ApiKeyLogRow[]> {
  const pool = await getProductionFormPool();
  const r = await pool.request().input("id", sql.Int, apiKeyId).query(`
    SELECT TOP 200 l.Id, l.Action, l.Detail, l.ChangedAt, u.FullName AS ChangedByName
    FROM [dbo].[ApiKeyLog] l
    LEFT JOIN ${teamMemberTableRef()} u ON u.Id = l.ChangedBy
    WHERE l.ApiKeyId = @id
    ORDER BY l.ChangedAt DESC, l.Id DESC
  `);
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    id: x.Id as number,
    action: x.Action as ApiKeyAction,
    detail: (x.Detail as string | null) ?? null,
    changedAt: (x.ChangedAt as Date).toISOString(),
    changedByName: (x.ChangedByName as string | null) ?? null,
  }));
}

/* ─────────────────────────── writes ─────────────────────────── */

type Tx = ReturnType<Awaited<ReturnType<typeof getProductionFormPool>>["transaction"]>;

/**
 * One row per distinct change, not one per Save. Renaming a key while also
 * replacing its value writes two rows, so "when was this last rotated?" stays a
 * single indexed query instead of a scan through free-text detail.
 *
 * `detail` must never carry any part of a secret — see migration 116's header.
 */
async function writeLog(
  tx: Tx,
  input: { apiKeyId: number; code: string; action: ApiKeyAction; detail?: string | null; userId: number },
): Promise<void> {
  await tx
    .request()
    .input("kid", sql.Int, input.apiKeyId)
    .input("code", sql.NVarChar, input.code)
    .input("action", sql.NVarChar, input.action)
    .input("detail", sql.NVarChar, input.detail ?? null)
    .input("user", sql.Int, input.userId || null)
    .query(`INSERT INTO [dbo].[ApiKeyLog] (ApiKeyId, Code, Action, Detail, ChangedBy)
            VALUES (@kid, @code, @action, @detail, @user)`);
}

export interface CreateApiKeyInput {
  code: string;
  name: string;
  secret: string;
  /** `YYYY-MM-DD`, or null for "Non expiry". A create has nothing to keep. */
  expiresAt: string | null;
}

export async function createApiKey(input: CreateApiKeyInput, userId: number): Promise<number> {
  assertEncryptionReady();
  const codeErr = apiKeyCodeError(input.code);
  if (codeErr) throw new Error(codeErr);
  const nameErr = apiKeyNameError(input.name);
  if (nameErr) throw new Error(nameErr);
  const code = normalizeApiKeyCode(input.code);
  const name = input.name.trim();
  const secret = input.secret.trim();
  if (!secret) throw new Error("กรุณากรอก KEY");

  const pool = await getProductionFormPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const ins = await tx
      .request()
      .input("code", sql.NVarChar, code)
      .input("name", sql.NVarChar, name)
      .input("enc", sql.NVarChar, encryptSecret(secret))
      .input("exp", sql.Date, input.expiresAt)
      .input("user", sql.Int, userId || null)
      .query(`INSERT INTO [dbo].[ApiKey] (Code, Name, SecretEnc, ExpiresAt, CreatedBy, UpdatedBy)
              OUTPUT INSERTED.Id
              VALUES (@code, @name, @enc, @exp, @user, @user)`);
    const id = ins.recordset[0].Id as number;
    await writeLog(tx, {
      apiKeyId: id,
      code,
      action: "created",
      detail: input.expiresAt ? `หมดอายุ ${input.expiresAt}` : "ไม่มีวันหมดอายุ",
      userId,
    });
    await tx.commit();
    return id;
  } catch (e) {
    await tx.rollback();
    // The unique index is the only thing that can tell us this reliably —
    // checking first would race with another admin adding the same code.
    if (e instanceof Error && /UQ_ApiKey_Code|duplicate key/i.test(e.message)) {
      throw new Error(`มี CODE "${code}" อยู่แล้ว`);
    }
    throw e;
  }
}

export interface UpdateApiKeyInput {
  name: string;
  /**
   * `YYYY-MM-DD`, null for "Non expiry", or **absent to keep what is stored**.
   *
   * The three-way split exists because this is a PATCH. `SecretEnc` has always
   * had a "leave it alone" value — a blank key — and the expiry had none, so a
   * caller sending only `name` silently cleared the date. The dialog always
   * sends the field, so nothing on screen relied on the old behaviour.
   */
  expiresAt?: string | null;
  /**
   * Blank or absent keeps the stored value. The browser is never sent the
   * current key, so "leave it alone" has to be expressible without echoing it
   * back and posting it again.
   */
  secret?: string | null;
}

export async function updateApiKey(id: number, input: UpdateApiKeyInput, userId: number): Promise<void> {
  const nameErr = apiKeyNameError(input.name);
  if (nameErr) throw new Error(nameErr);
  const name = input.name.trim();
  const newSecret = input.secret?.trim() || null;
  if (newSecret) assertEncryptionReady();

  const pool = await getProductionFormPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const cur = await tx
      .request()
      .input("id", sql.Int, id)
      .query(`SELECT Code, Name, ExpiresAt FROM [dbo].[ApiKey] WHERE Id = @id`);
    const row = cur.recordset[0];
    if (!row) throw new Error("ไม่พบ API key นี้");
    const code = row.Code as string;
    const oldName = row.Name as string;
    const oldExp = toYmd(row.ExpiresAt as Date | null);
    // Absent means keep. Resolved here, against the row just read, so the
    // UPDATE stays one statement and the log compares the value it writes.
    const nextExp = input.expiresAt === undefined ? oldExp : input.expiresAt;

    await tx
      .request()
      .input("id", sql.Int, id)
      .input("name", sql.NVarChar, name)
      .input("exp", sql.Date, nextExp)
      .input("enc", sql.NVarChar, newSecret ? encryptSecret(newSecret) : null)
      .input("user", sql.Int, userId || null)
      .query(`UPDATE [dbo].[ApiKey]
              SET Name = @name,
                  ExpiresAt = @exp,
                  SecretEnc = COALESCE(@enc, SecretEnc),
                  UpdatedBy = @user,
                  UpdatedAt = SYSDATETIME()
              WHERE Id = @id`);

    if (oldName !== name) {
      await writeLog(tx, { apiKeyId: id, code, action: "renamed", detail: `${oldName} → ${name}`, userId });
    }
    if (oldExp !== nextExp) {
      await writeLog(tx, {
        apiKeyId: id,
        code,
        action: "expiry_changed",
        detail: `${oldExp ?? "ไม่มีวันหมดอายุ"} → ${nextExp ?? "ไม่มีวันหมดอายุ"}`,
        userId,
      });
    }
    if (newSecret) {
      // No part of either value, old or new. Just that it changed.
      await writeLog(tx, { apiKeyId: id, code, action: "secret_rotated", detail: null, userId });
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

/** Removal is deactivation — see migration 116's header for why there is no delete. */
export async function setApiKeyActive(id: number, active: boolean, userId: number): Promise<void> {
  const pool = await getProductionFormPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const cur = await tx
      .request()
      .input("id", sql.Int, id)
      .query(`SELECT Code, IsActive FROM [dbo].[ApiKey] WHERE Id = @id`);
    const row = cur.recordset[0];
    if (!row) throw new Error("ไม่พบ API key นี้");
    if (!!row.IsActive === active) {
      await tx.rollback();
      return; // Already there. No change, so no log row.
    }
    await tx
      .request()
      .input("id", sql.Int, id)
      .input("active", sql.Bit, active)
      .input("user", sql.Int, userId || null)
      .query(`UPDATE [dbo].[ApiKey]
              SET IsActive = @active, UpdatedBy = @user, UpdatedAt = SYSDATETIME()
              WHERE Id = @id`);
    await writeLog(tx, {
      apiKeyId: id,
      code: row.Code as string,
      action: active ? "reactivated" : "deactivated",
      userId,
    });
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

/**
 * Bring a key that still lives in `Fast_Core.AppSetting` or `.env` into the
 * registry, without it ever passing through a browser.
 *
 * This exists because the value is only ever shown masked: an admin moving
 * Google Maps or OpenRouteService here by hand would have to already know the
 * key, and they generally do not. Returns false when there was nothing to
 * import or the code is already registered.
 */
export async function importLegacyKey(code: string, name: string, userId: number): Promise<boolean> {
  assertEncryptionReady();
  const normalized = normalizeApiKeyCode(code);
  const existing = await getProductionFormPool().then((p) =>
    p.request().input("code", sql.NVarChar, normalized)
      .query(`SELECT TOP 1 Id FROM [dbo].[ApiKey] WHERE Code = @code`),
  );
  if (existing.recordset.length > 0) return false;

  const found = await resolveApiKey(normalized);
  if (!found.value || found.source === "db") return false;

  await createApiKey({ code: normalized, name, secret: found.value, expiresAt: null }, userId);
  return true;
}

/**
 * The decrypted value of one row, for a server-side tester.
 *
 * **Never return this from a route.** It exists so Settings → API Keys can
 * check the key on the row somebody is looking at — including a deactivated
 * one, which `resolveApiKey` skips by design.
 */
export async function getApiKeySecret(id: number): Promise<{ code: string; value: string } | null> {
  const pool = await getProductionFormPool();
  const r = await pool
    .request()
    .input("id", sql.Int, id)
    .query(`SELECT TOP 1 Code, SecretEnc FROM [dbo].[ApiKey] WHERE Id = @id`);
  const row = r.recordset[0];
  if (!row) return null;
  return { code: row.Code as string, value: decryptSecret(row.SecretEnc as string) };
}
