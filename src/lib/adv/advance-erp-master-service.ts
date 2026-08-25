import { getAppPool, sql } from "@/lib/db/mssql";
import { ADVANCE_JOURNAL_TEMPLATE } from "@/lib/adv/advance-batch-service";

/**
 * AP-2 Interface ERP master options, read DIRECTLY from the pre-synced
 * Rocks_ERP_Data database (populated by the ERP sync pipeline). The four
 * dropdowns on the AP-2 settings page each map to one table there, all keyed
 * by BrandCode = the BC Company code (PCTH / KSI / PCMY / UNO):
 *
 *   G/L Account   → dbo.ErpAccounts        (AccountCategory = 'GL')
 *   Bank Account  → dbo.ErpBankAccountCard
 *   Branch        → dbo.ErpDimensionValue  (DimensionCode = 'BRANCH')
 *   Journal Batch → dbo.ErpGeneralJournalBatch
 */

const ERP_DATA_DB = process.env.MSSQL_ERP_DATA_DATABASE || "Rocks_ERP_Data";

export interface AdvErpAcctOption { accountNo: string; displayName: string | null }
export interface AdvErpBranchOption { code: string; displayName: string | null }
export interface AdvErpBatchOption { batchName: string; displayName: string | null; templateName: string | null }

export interface AdvErpCompanyMaster {
  gl: AdvErpAcctOption[];
  bank: AdvErpAcctOption[];
  branch: AdvErpBranchOption[];
  journalBatch: AdvErpBatchOption[];
}

async function listGl(company: string): Promise<AdvErpAcctOption[]> {
  const pool = await getAppPool(ERP_DATA_DB);
  const r = await pool.request().input("c", sql.NVarChar, company).query(`
    SELECT AccountNo, DisplayName FROM [dbo].[ErpAccounts]
    WHERE BrandCode = @c AND AccountCategory = 'GL'
      AND IsActive = 1 AND (IsBlocked = 0 OR IsBlocked IS NULL)
    ORDER BY AccountNo`);
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    accountNo: x.AccountNo as string,
    displayName: (x.DisplayName as string) ?? null,
  }));
}

async function listBank(company: string): Promise<AdvErpAcctOption[]> {
  const pool = await getAppPool(ERP_DATA_DB);
  const r = await pool.request().input("c", sql.NVarChar, company).query(`
    SELECT AccountNo, DisplayName FROM [dbo].[ErpBankAccountCard]
    WHERE BrandCode = @c
      AND IsActive = 1 AND (IsBlocked = 0 OR IsBlocked IS NULL)
    ORDER BY AccountNo`);
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    accountNo: x.AccountNo as string,
    displayName: (x.DisplayName as string) ?? null,
  }));
}

async function listBranch(company: string): Promise<AdvErpBranchOption[]> {
  const pool = await getAppPool(ERP_DATA_DB);
  const r = await pool.request().input("c", sql.NVarChar, company).query(`
    SELECT Code, DisplayName FROM [dbo].[ErpDimensionValue]
    WHERE BrandCode = @c AND DimensionCode = 'BRANCH'
      AND IsActive = 1 AND (IsBlocked = 0 OR IsBlocked IS NULL)
    ORDER BY Code`);
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    code: x.Code as string,
    displayName: (x.DisplayName as string) ?? null,
  }));
}

async function listBatch(company: string): Promise<AdvErpBatchOption[]> {
  const pool = await getAppPool(ERP_DATA_DB);
  // Only PAYMENTS-template batches — the PPAP CU (CU 50263) posts under the
  // PAYMENTS template and rejects any other, so other templates must not appear.
  const r = await pool.request()
    .input("c", sql.NVarChar, company)
    .input("tpl", sql.NVarChar, ADVANCE_JOURNAL_TEMPLATE)
    .query(`
    SELECT BatchName, DisplayName, TemplateName FROM [dbo].[ErpGeneralJournalBatch]
    WHERE BrandCode = @c
      AND UPPER(LTRIM(RTRIM(TemplateName))) = @tpl
      AND IsActive = 1 AND (IsBlocked = 0 OR IsBlocked IS NULL)
    ORDER BY BatchName`);
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    batchName: x.BatchName as string,
    displayName: (x.DisplayName as string) ?? null,
    templateName: (x.TemplateName as string) ?? null,
  }));
}

/** All four master lists for one Company, read from Rocks_ERP_Data. */
export async function listAdvErpMaster(company: string): Promise<AdvErpCompanyMaster> {
  const c = company.trim().toUpperCase();
  if (!c) return { gl: [], bank: [], branch: [], journalBatch: [] };
  const [gl, bank, branch, journalBatch] = await Promise.all([
    listGl(c), listBank(c), listBranch(c), listBatch(c),
  ]);
  return { gl, bank, branch, journalBatch };
}

/** Master lists for several Companies, keyed by Company code. */
export async function listAdvErpMasterForCompanies(
  companies: string[],
): Promise<Record<string, AdvErpCompanyMaster>> {
  const uniq = Array.from(new Set(companies.map((c) => c.trim().toUpperCase()).filter(Boolean)));
  const out: Record<string, AdvErpCompanyMaster> = {};
  await Promise.all(uniq.map(async (c) => { out[c] = await listAdvErpMaster(c); }));
  return out;
}
