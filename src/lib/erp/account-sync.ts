/**
 * Sync BC G/L (API v2 accounts) & Bank Account Card (OData BankAccountCard)
 * per Brand Config brand → Rocks_ERP_Data.ErpAccounts + ErpBankAccountCard
 */

import { ERP_INTERFACE_BRANDS } from "@/lib/acc/erp-interface-brands";
import {
  buildBcApiV2CompanyEntityUrl,
  buildBcODataEntityUrl,
  fetchBcApiV2Collection,
  fetchBcODataCollection,
} from "@/lib/bc/bc-odata";
import { getBcConnectionById } from "@/lib/bc/bc-connection";
import { getBrandConfig } from "@/lib/brand-config";
import { getErpDataPool, sql } from "@/lib/db/mssql";

export const ERP_ACCOUNT_SYNC_TYPE = "ACCOUNTS";
export const BC_BANK_ACCOUNT_CARD_ENTITY = "BankAccountCard";
export const BC_GENERAL_JOURNAL_BATCHES_ENTITY = "GeneralJournalBatches";
export type ErpAccountCategory = "GL" | "BANK";

export interface AccountSyncResult {
  brandCode: string;
  glRows: number;
  bankRows: number;
  journalBatchRows?: number;
  syncedAt: string;
}

export interface ErpAccountOption {
  accountNo: string;
  displayName: string | null;
  bcCategory: string | null;
}

interface BcGlAccountRow extends Record<string, unknown> {
  number?: string;
  Number?: string;
  displayName?: string;
  DisplayName?: string;
  category?: string;
  Category?: string;
  blocked?: boolean;
  Blocked?: boolean;
}

export interface ErpJournalBatchOption {
  batchName: string;
  displayName: string | null;
  templateName: string | null;
}

interface BcGeneralJournalBatchRow extends Record<string, unknown> {
  Name?: string;
  name?: string;
  Description?: string;
  description?: string;
  Journal_Template_Name?: string;
  JournalTemplateName?: string;
  journalTemplateName?: string;
  Blocked?: boolean;
  blocked?: boolean;
}

interface BcBankAccountCardRow extends Record<string, unknown> {
  No?: string;
  no?: string;
  Name?: string;
  name?: string;
  Bank_Account_No?: string;
  BankAccountNo?: string;
  bankAccountNo?: string;
  Bank_Name?: string;
  BankName?: string;
  Currency_Code?: string;
  CurrencyCode?: string;
  Blocked?: boolean;
  blocked?: boolean;
}

function pickStr(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function pickBool(row: Record<string, unknown>, ...keys: string[]): boolean {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "boolean") return v;
  }
  return false;
}

function normalizeGlRow(row: BcGlAccountRow): {
  accountNo: string;
  displayName: string | null;
  bcCategory: string | null;
  isBlocked: boolean;
  rawJson: string;
} | null {
  const accountNo = pickStr(row, "number", "Number");
  if (!accountNo) return null;

  return {
    accountNo,
    displayName: pickStr(row, "displayName", "DisplayName") ?? accountNo,
    bcCategory: pickStr(row, "category", "Category"),
    isBlocked: pickBool(row, "blocked", "Blocked"),
    rawJson: JSON.stringify(row),
  };
}

function normalizeBankCardRow(row: BcBankAccountCardRow): {
  accountNo: string;
  displayName: string | null;
  bankName: string | null;
  currencyCode: string | null;
  isBlocked: boolean;
  rawJson: string;
} | null {
  const accountNo = pickStr(
    row,
    "No",
    "no",
    "Bank_Account_No",
    "BankAccountNo",
    "bankAccountNo",
  );
  if (!accountNo) return null;

  const displayName = pickStr(row, "Name", "name") ?? accountNo;

  return {
    accountNo,
    displayName,
    bankName: pickStr(row, "Bank_Name", "BankName", "bankName"),
    currencyCode: pickStr(row, "Currency_Code", "CurrencyCode", "currencyCode"),
    isBlocked: pickBool(row, "Blocked", "blocked"),
    rawJson: JSON.stringify(row),
  };
}

function normalizeJournalBatchRow(row: BcGeneralJournalBatchRow): {
  batchName: string;
  displayName: string | null;
  templateName: string | null;
  isBlocked: boolean;
  rawJson: string;
} | null {
  const batchName = pickStr(row, "Name", "name");
  if (!batchName) return null;

  const displayName = pickStr(row, "Description", "description") ?? batchName;

  return {
    batchName,
    displayName,
    templateName: pickStr(
      row,
      "Journal_Template_Name",
      "JournalTemplateName",
      "journalTemplateName",
    ),
    isBlocked: pickBool(row, "Blocked", "blocked"),
    rawJson: JSON.stringify(row),
  };
}

export interface BrandAccountSyncContext {
  brandCode: string;
  bcCompanyId: string;
  bcCompanyName: string;
  bcConnectionId: number;
  glUrl: string;
  bankCardUrl: string;
  journalBatchUrl: string;
}

export async function resolveBrandAccountSyncContext(
  brandCode: string,
): Promise<BrandAccountSyncContext> {
  const code = brandCode.trim().toUpperCase();
  const brand = await getBrandConfig(code);
  if (!brand) {
    throw new Error(`ไม่พบการตั้งค่าแบรนด์ ${code}`);
  }
  if (!brand.bcId?.trim()) {
    throw new Error(`แบรนด์ ${code} ยังไม่ได้ตั้งค่า BC Id`);
  }
  if (!brand.bcName?.trim()) {
    throw new Error(`แบรนด์ ${code} ยังไม่ได้ตั้งค่า BC Name (Company)`);
  }
  if (!brand.bcConnectionId) {
    throw new Error(`แบรนด์ ${code} ยังไม่ได้เลือก BC Connection`);
  }

  const conn = await getBcConnectionById(brand.bcConnectionId);
  if (!conn || !conn.IsActive) {
    throw new Error(`BC Connection ของ ${code} ไม่พร้อมใช้งาน`);
  }

  const bcCompanyId = brand.bcId.trim();
  const bcCompanyName = brand.bcName.trim();

  return {
    brandCode: code,
    bcCompanyId,
    bcCompanyName,
    bcConnectionId: brand.bcConnectionId,
    glUrl: buildBcApiV2CompanyEntityUrl(conn.BaseUrl, bcCompanyId, "accounts"),
    bankCardUrl: buildBcODataEntityUrl(
      conn.BaseUrl,
      bcCompanyName,
      BC_BANK_ACCOUNT_CARD_ENTITY,
    ),
    journalBatchUrl: buildBcODataEntityUrl(
      conn.BaseUrl,
      bcCompanyName,
      BC_GENERAL_JOURNAL_BATCHES_ENTITY,
    ),
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
  // The five Business Central sync tables moved to Rocks_ERP_Data in migrations
  // 101/102; Fast_Data keeps synonyms for the two sibling applications. This app
  // names the new home directly.
  const pool = await getErpDataPool();
  await pool
    .request()
    .input("syncType", sql.NVarChar, ERP_ACCOUNT_SYNC_TYPE)
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

async function upsertGlAccounts(
  ctx: BrandAccountSyncContext,
  rawRows: BcGlAccountRow[],
  startedAt: Date,
): Promise<number> {
  const pool = await getErpDataPool();
  let count = 0;

  for (const raw of rawRows) {
    const norm = normalizeGlRow(raw);
    if (!norm) continue;

    await pool
      .request()
      .input("brand", sql.NVarChar, ctx.brandCode)
      .input("companyId", sql.NVarChar, ctx.bcCompanyId)
      .input("connId", sql.Int, ctx.bcConnectionId)
      .input("accountNo", sql.NVarChar, norm.accountNo)
      .input("displayName", sql.NVarChar, norm.displayName)
      .input("bcCategory", sql.NVarChar, norm.bcCategory)
      .input("blocked", sql.Bit, norm.isBlocked ? 1 : 0)
      .input("raw", sql.NVarChar, norm.rawJson)
      .query(`
        MERGE [dbo].[ErpAccounts] AS t
        USING (
          SELECT @brand AS BrandCode, 'GL' AS AccountCategory, @accountNo AS AccountNo
        ) AS s
        ON t.BrandCode = s.BrandCode
          AND t.AccountCategory = s.AccountCategory
          AND t.AccountNo = s.AccountNo
        WHEN MATCHED THEN
          UPDATE SET
            BcCompanyId = @companyId,
            BcConnectionId = @connId,
            DisplayName = @displayName,
            BcCategory = @bcCategory,
            IsBlocked = @blocked,
            IsActive = 1,
            SyncedAt = SYSDATETIME(),
            RawJson = @raw
        WHEN NOT MATCHED THEN
          INSERT (
            BrandCode, BcCompanyId, BcConnectionId, AccountCategory, AccountNo,
            DisplayName, BcCategory, IsBlocked, IsActive, SyncedAt, RawJson
          )
          VALUES (
            @brand, @companyId, @connId, 'GL', @accountNo,
            @displayName, @bcCategory, @blocked, 1, SYSDATETIME(), @raw
          );
      `);
    count++;
  }

  await pool
    .request()
    .input("brand", sql.NVarChar, ctx.brandCode)
    .input("cutoff", sql.DateTime2, startedAt)
    .query(`
      UPDATE [dbo].[ErpAccounts]
      SET IsActive = 0
      WHERE BrandCode = @brand AND AccountCategory = 'GL' AND SyncedAt < @cutoff
    `);

  return count;
}

async function upsertBankAccountCards(
  ctx: BrandAccountSyncContext,
  rawRows: BcBankAccountCardRow[],
  startedAt: Date,
): Promise<number> {
  const pool = await getErpDataPool();
  let count = 0;

  for (const raw of rawRows) {
    const norm = normalizeBankCardRow(raw);
    if (!norm) continue;

    await pool
      .request()
      .input("brand", sql.NVarChar, ctx.brandCode)
      .input("companyId", sql.NVarChar, ctx.bcCompanyId)
      .input("companyName", sql.NVarChar, ctx.bcCompanyName)
      .input("connId", sql.Int, ctx.bcConnectionId)
      .input("accountNo", sql.NVarChar, norm.accountNo)
      .input("displayName", sql.NVarChar, norm.displayName)
      .input("bankName", sql.NVarChar, norm.bankName)
      .input("currency", sql.NVarChar, norm.currencyCode)
      .input("blocked", sql.Bit, norm.isBlocked ? 1 : 0)
      .input("raw", sql.NVarChar, norm.rawJson)
      .query(`
        MERGE [dbo].[ErpBankAccountCard] AS t
        USING (
          SELECT @brand AS BrandCode, @accountNo AS AccountNo
        ) AS s
        ON t.BrandCode = s.BrandCode AND t.AccountNo = s.AccountNo
        WHEN MATCHED THEN
          UPDATE SET
            BcCompanyId = @companyId,
            BcCompanyName = @companyName,
            BcConnectionId = @connId,
            DisplayName = @displayName,
            BankName = @bankName,
            CurrencyCode = @currency,
            IsBlocked = @blocked,
            IsActive = 1,
            SyncedAt = SYSDATETIME(),
            RawJson = @raw
        WHEN NOT MATCHED THEN
          INSERT (
            BrandCode, BcCompanyId, BcCompanyName, BcConnectionId, AccountNo,
            DisplayName, BankName, CurrencyCode, IsBlocked, IsActive, SyncedAt, RawJson
          )
          VALUES (
            @brand, @companyId, @companyName, @connId, @accountNo,
            @displayName, @bankName, @currency, @blocked, 1, SYSDATETIME(), @raw
          );
      `);
    count++;
  }

  await pool
    .request()
    .input("brand", sql.NVarChar, ctx.brandCode)
    .input("cutoff", sql.DateTime2, startedAt)
    .query(`
      UPDATE [dbo].[ErpBankAccountCard]
      SET IsActive = 0
      WHERE BrandCode = @brand AND SyncedAt < @cutoff
    `);

  return count;
}

async function upsertGeneralJournalBatches(
  ctx: BrandAccountSyncContext,
  rawRows: BcGeneralJournalBatchRow[],
  startedAt: Date,
): Promise<number> {
  const pool = await getErpDataPool();
  let count = 0;

  for (const raw of rawRows) {
    const norm = normalizeJournalBatchRow(raw);
    if (!norm) continue;

    await pool
      .request()
      .input("brand", sql.NVarChar, ctx.brandCode)
      .input("companyId", sql.NVarChar, ctx.bcCompanyId)
      .input("companyName", sql.NVarChar, ctx.bcCompanyName)
      .input("connId", sql.Int, ctx.bcConnectionId)
      .input("batchName", sql.NVarChar, norm.batchName)
      .input("displayName", sql.NVarChar, norm.displayName)
      .input("templateName", sql.NVarChar, norm.templateName)
      .input("blocked", sql.Bit, norm.isBlocked ? 1 : 0)
      .input("raw", sql.NVarChar, norm.rawJson)
      .query(`
        MERGE [dbo].[ErpGeneralJournalBatch] AS t
        USING (
          SELECT @brand AS BrandCode, @batchName AS BatchName
        ) AS s
        ON t.BrandCode = s.BrandCode AND t.BatchName = s.BatchName
        WHEN MATCHED THEN
          UPDATE SET
            BcCompanyId = @companyId,
            BcCompanyName = @companyName,
            BcConnectionId = @connId,
            DisplayName = @displayName,
            TemplateName = @templateName,
            IsBlocked = @blocked,
            IsActive = 1,
            SyncedAt = SYSDATETIME(),
            RawJson = @raw
        WHEN NOT MATCHED THEN
          INSERT (
            BrandCode, BcCompanyId, BcCompanyName, BcConnectionId, BatchName,
            DisplayName, TemplateName, IsBlocked, IsActive, SyncedAt, RawJson
          )
          VALUES (
            @brand, @companyId, @companyName, @connId, @batchName,
            @displayName, @templateName, @blocked, 1, SYSDATETIME(), @raw
          );
      `);
    count++;
  }

  await pool
    .request()
    .input("brand", sql.NVarChar, ctx.brandCode)
    .input("cutoff", sql.DateTime2, startedAt)
    .query(`
      UPDATE [dbo].[ErpGeneralJournalBatch]
      SET IsActive = 0
      WHERE BrandCode = @brand AND SyncedAt < @cutoff
    `);

  return count;
}

export async function syncBrandErpJournalBatches(
  brandCode: string,
): Promise<{ brandCode: string; journalBatchRows: number }> {
  const startedAt = new Date();
  const ctx = await resolveBrandAccountSyncContext(brandCode);
  const raw = await fetchBcODataCollection<BcGeneralJournalBatchRow>(
    ctx.bcConnectionId,
    ctx.journalBatchUrl,
  );
  const journalBatchRows = await upsertGeneralJournalBatches(ctx, raw, startedAt);
  return { brandCode: ctx.brandCode, journalBatchRows };
}

export async function syncBrandErpGlAccounts(
  brandCode: string,
): Promise<{ brandCode: string; glRows: number }> {
  const startedAt = new Date();
  const ctx = await resolveBrandAccountSyncContext(brandCode);
  const glRaw = await fetchBcApiV2Collection<BcGlAccountRow>(ctx.bcConnectionId, ctx.glUrl);
  const glRows = await upsertGlAccounts(ctx, glRaw, startedAt);
  return { brandCode: ctx.brandCode, glRows };
}

export async function syncBrandErpBankAccounts(
  brandCode: string,
): Promise<{ brandCode: string; bankRows: number }> {
  const startedAt = new Date();
  const ctx = await resolveBrandAccountSyncContext(brandCode);
  const bankRaw = await fetchBcODataCollection<BcBankAccountCardRow>(ctx.bcConnectionId, ctx.bankCardUrl);
  const bankRows = await upsertBankAccountCards(ctx, bankRaw, startedAt);
  return { brandCode: ctx.brandCode, bankRows };
}

export async function syncBrandErpAccounts(
  brandCode: string,
  triggeredBy: number | null,
): Promise<AccountSyncResult> {
  const startedAt = new Date();
  const ctx = await resolveBrandAccountSyncContext(brandCode);
  let glRows = 0;
  let bankRows = 0;
  let journalBatchRows = 0;

  try {
    const journalRaw = await fetchBcODataCollection<BcGeneralJournalBatchRow>(
      ctx.bcConnectionId,
      ctx.journalBatchUrl,
    );
    journalBatchRows = await upsertGeneralJournalBatches(ctx, journalRaw, startedAt);

    const glRaw = await fetchBcApiV2Collection<BcGlAccountRow>(ctx.bcConnectionId, ctx.glUrl);
    glRows = await upsertGlAccounts(ctx, glRaw, startedAt);

    const bankRaw = await fetchBcODataCollection<BcBankAccountCardRow>(ctx.bcConnectionId, ctx.bankCardUrl);
    bankRows = await upsertBankAccountCards(ctx, bankRaw, startedAt);

    await insertSyncLog(
      ctx.brandCode,
      "success",
      glRows + bankRows + journalBatchRows,
      null,
      triggeredBy,
      startedAt,
    );

    return {
      brandCode: ctx.brandCode,
      glRows,
      bankRows,
      journalBatchRows,
      syncedAt: new Date().toISOString(),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync failed";
    await insertSyncLog(
      ctx.brandCode,
      "failed",
      glRows + bankRows + journalBatchRows,
      msg,
      triggeredBy,
      startedAt,
    );
    throw e;
  }
}

export interface AllAccountsSyncResult {
  results: AccountSyncResult[];
  errors: { brandCode: string; error: string }[];
}

export async function syncAllBrandErpAccounts(
  triggeredBy: number | null,
): Promise<AllAccountsSyncResult> {
  const results: AccountSyncResult[] = [];
  const errors: { brandCode: string; error: string }[] = [];

  for (const b of ERP_INTERFACE_BRANDS) {
    try {
      const r = await syncBrandErpAccounts(b.id, triggeredBy);
      results.push(r);
    } catch (e) {
      errors.push({
        brandCode: b.id,
        error: e instanceof Error ? e.message : "Sync failed",
      });
    }
  }

  return { results, errors };
}

export async function listErpGlAccountOptions(
  brandCode: string,
): Promise<ErpAccountOption[]> {
  const pool = await getErpDataPool();
  const res = await pool
    .request()
    .input("brand", sql.NVarChar, brandCode.trim().toUpperCase())
    .query(`
      SELECT AccountNo, DisplayName, BcCategory
      FROM [dbo].[ErpAccounts]
      WHERE BrandCode = @brand
        AND AccountCategory = 'GL'
        AND IsActive = 1
        AND IsBlocked = 0
      ORDER BY DisplayName, AccountNo
    `);

  return (res.recordset as Record<string, unknown>[]).map((r) => ({
    accountNo: r.AccountNo as string,
    displayName: (r.DisplayName as string) ?? null,
    bcCategory: (r.BcCategory as string) ?? null,
  }));
}

export async function listErpJournalBatchOptions(
  brandCode: string,
): Promise<ErpJournalBatchOption[]> {
  const pool = await getErpDataPool();
  const res = await pool
    .request()
    .input("brand", sql.NVarChar, brandCode.trim().toUpperCase())
    .query(`
      SELECT BatchName, DisplayName, TemplateName
      FROM [dbo].[ErpGeneralJournalBatch]
      WHERE BrandCode = @brand
        AND IsActive = 1
        AND IsBlocked = 0
      ORDER BY DisplayName, BatchName
    `);

  return (res.recordset as Record<string, unknown>[]).map((r) => ({
    batchName: r.BatchName as string,
    displayName: (r.DisplayName as string) ?? null,
    templateName: (r.TemplateName as string) ?? null,
  }));
}

export async function listErpBankAccountCardOptions(
  brandCode: string,
): Promise<ErpAccountOption[]> {
  const pool = await getErpDataPool();
  const res = await pool
    .request()
    .input("brand", sql.NVarChar, brandCode.trim().toUpperCase())
    .query(`
      SELECT AccountNo, DisplayName, BankName
      FROM [dbo].[ErpBankAccountCard]
      WHERE BrandCode = @brand
        AND IsActive = 1
        AND IsBlocked = 0
      ORDER BY DisplayName, AccountNo
    `);

  return (res.recordset as Record<string, unknown>[]).map((r) => ({
    accountNo: r.AccountNo as string,
    displayName: (r.DisplayName as string) ?? null,
    bcCategory: (r.BankName as string) ?? null,
  }));
}

/** @deprecated Use listErpGlAccountOptions or listErpBankAccountCardOptions */
export async function listErpAccountOptions(
  brandCode: string,
  category: ErpAccountCategory,
): Promise<ErpAccountOption[]> {
  if (category === "BANK") return listErpBankAccountCardOptions(brandCode);
  return listErpGlAccountOptions(brandCode);
}

export async function listErpAccountsForBrands(
  brandCodes: string[],
): Promise<Record<string, {
  gl: ErpAccountOption[];
  bank: ErpAccountOption[];
  journalBatch: ErpJournalBatchOption[];
}>> {
  const out: Record<string, {
    gl: ErpAccountOption[];
    bank: ErpAccountOption[];
    journalBatch: ErpJournalBatchOption[];
  }> = {};
  await Promise.all(
    brandCodes.map(async (code) => {
      const brand = code.trim().toUpperCase();
      const [gl, bank, journalBatch] = await Promise.all([
        listErpGlAccountOptions(brand),
        listErpBankAccountCardOptions(brand),
        listErpJournalBatchOptions(brand),
      ]);
      out[brand] = { gl, bank, journalBatch };
    }),
  );
  return out;
}

export async function getLastAccountSync(
  brandCode: string,
): Promise<{ syncedAt: string; rowsUpserted: number; status: string } | null> {
  const pool = await getErpDataPool();
  const res = await pool
    .request()
    .input("brand", sql.NVarChar, brandCode.trim().toUpperCase())
    .input("syncType", sql.NVarChar, ERP_ACCOUNT_SYNC_TYPE)
    .query(`
      SELECT TOP 1 Status, RowsUpserted, FinishedAt
      FROM [dbo].[ErpSyncLog]
      WHERE BrandCode = @brand AND SyncType = @syncType
      ORDER BY FinishedAt DESC
    `);
  const row = res.recordset[0] as Record<string, unknown> | undefined;
  if (!row?.FinishedAt) return null;
  return {
    status: row.Status as string,
    rowsUpserted: row.RowsUpserted as number,
    syncedAt: (row.FinishedAt as Date).toISOString(),
  };
}
