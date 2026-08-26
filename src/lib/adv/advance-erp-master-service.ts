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
export interface AdvErpVendorOption { vendorNo: string; displayName: string | null }

export interface AdvErpCompanyMaster {
  gl: AdvErpAcctOption[];
  bank: AdvErpAcctOption[];
  branch: AdvErpBranchOption[];
  journalBatch: AdvErpBatchOption[];
  vendors: AdvErpVendorOption[];
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

export async function listVendors(company: string): Promise<AdvErpVendorOption[]> {
  const c = company.trim().toUpperCase();
  if (!c) return [];
  const pool = await getAppPool(ERP_DATA_DB);
  const r = await pool.request().input("c", sql.NVarChar, c).query(`
    SELECT VendorNo, DisplayName FROM [dbo].[ErpVendors]
    WHERE BrandCode = @c
      AND IsActive = 1 AND (IsBlocked = 0 OR IsBlocked IS NULL)
    ORDER BY DisplayName`);
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    vendorNo: x.VendorNo as string,
    displayName: (x.DisplayName as string) ?? null,
  }));
}

/** Prefilter candidates for the matcher: active vendors whose name shares a token
 *  with the payee. Caps the set so the LLM prompt stays small. */
export async function prefilterVendors(company: string, payeeName: string, limit = 10): Promise<AdvErpVendorOption[]> {
  const c = company.trim().toUpperCase();
  const term = (payeeName ?? "").trim();
  if (!c || !term) return [];
  const pool = await getAppPool(ERP_DATA_DB);
  const r = await pool.request()
    .input("c", sql.NVarChar, c)
    .input("t", sql.NVarChar, `%${term}%`)
    .input("lim", sql.Int, limit)
    .query(`
      SELECT TOP (@lim) VendorNo, DisplayName FROM [dbo].[ErpVendors]
      WHERE BrandCode = @c
        AND IsActive = 1 AND (IsBlocked = 0 OR IsBlocked IS NULL)
        AND (DisplayName LIKE @t OR @t LIKE '%' + DisplayName + '%')
      ORDER BY LEN(DisplayName)`);
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    vendorNo: x.VendorNo as string,
    displayName: (x.DisplayName as string) ?? null,
  }));
}

/** Is this vendor still selectable (active + not blocked) for the company? */
export async function isVendorSelectable(company: string, vendorNo: string): Promise<boolean> {
  const c = company.trim().toUpperCase();
  const v = (vendorNo ?? "").trim();
  if (!c || !v) return false;
  const pool = await getAppPool(ERP_DATA_DB);
  const r = await pool.request().input("c", sql.NVarChar, c).input("v", sql.NVarChar, v).query(`
    SELECT TOP 1 1 AS Ok FROM [dbo].[ErpVendors]
    WHERE BrandCode = @c AND VendorNo = @v
      AND IsActive = 1 AND (IsBlocked = 0 OR IsBlocked IS NULL)`);
  return r.recordset.length > 0;
}

/** The selectable (active, unblocked) vendor row, or null. One round-trip:
 *  serves both the validity gate and the display-name snapshot. */
export async function findSelectableVendor(company: string, vendorNo: string): Promise<AdvErpVendorOption | null> {
  const c = company.trim().toUpperCase();
  const v = (vendorNo ?? "").trim();
  if (!c || !v) return null;
  const pool = await getAppPool(ERP_DATA_DB);
  const r = await pool.request().input("c", sql.NVarChar, c).input("v", sql.NVarChar, v).query(`
    SELECT TOP 1 VendorNo, DisplayName FROM [dbo].[ErpVendors]
    WHERE BrandCode = @c AND VendorNo = @v
      AND IsActive = 1 AND (IsBlocked = 0 OR IsBlocked IS NULL)`);
  const row = (r.recordset as Record<string, unknown>[])[0];
  return row ? { vendorNo: row.VendorNo as string, displayName: (row.DisplayName as string) ?? null } : null;
}

/** All five master lists for one Company, read from Rocks_ERP_Data. */
export async function listAdvErpMaster(company: string): Promise<AdvErpCompanyMaster> {
  const c = company.trim().toUpperCase();
  if (!c) return { gl: [], bank: [], branch: [], journalBatch: [], vendors: [] };
  const [gl, bank, branch, journalBatch, vendors] = await Promise.all([
    listGl(c), listBank(c), listBranch(c), listBatch(c), listVendors(c),
  ]);
  return { gl, bank, branch, journalBatch, vendors };
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
