import { getAccPool, sql } from "@/lib/acc/pool";
import { writeBothPools } from "@/lib/acc/dual-write";

/**
 * AP-3's OWN Interface ERP config, in its own table (AccClearAdvanceInterfaceConfig).
 * AP-3 reverses the cleared AP-2 lines, so the only thing it configures is the
 * Journal Batch its clearing journal posts into (one row per claim brand). Reads
 * use the form pool; writes go through writeBothPools so Prod + UAT stay in sync.
 */

/** One row of AP-3 interface config, keyed by upper-case brand code. */
export interface ClrInterfaceConfigRow {
  journalBatchName: string | null;
  vatInputGlAccountNo: string | null;
  whtPayableGlAccountNo: string | null;
}

/** AP-3 interface config, keyed by upper-case brand code. */
export async function listClrInterfaceConfig(): Promise<Record<string, ClrInterfaceConfigRow>> {
  const pool = await getAccPool();
  const r = await pool.request().query(
    `SELECT BrandCode, JournalBatchName, VatInputGlAccountNo, WhtPayableGlAccountNo FROM [dbo].[AccClearAdvanceInterfaceConfig]`,
  );
  const map: Record<string, ClrInterfaceConfigRow> = {};
  for (const row of r.recordset as Record<string, unknown>[]) {
    map[(row.BrandCode as string).toUpperCase()] = {
      journalBatchName: (row.JournalBatchName as string) ?? null,
      vatInputGlAccountNo: (row.VatInputGlAccountNo as string) ?? null,
      whtPayableGlAccountNo: (row.WhtPayableGlAccountNo as string) ?? null,
    };
  }
  return map;
}

/** Set the AP-3 Journal Batch for one claim brand (Prod + UAT). */
export async function saveClrBatch(brandCode: string, batchName: string, userId: number): Promise<void> {
  const brand = brandCode.trim().toUpperCase();
  if (!brand) throw new Error("กรุณาเลือกแบรนด์");
  const value = batchName.trim() || null;
  await writeBothPools(async (tx) => {
    await tx.request()
      .input("brand", sql.NVarChar, brand)
      .input("batch", sql.NVarChar, value)
      .input("user", sql.Int, userId || null)
      .query(`
        MERGE [dbo].[AccClearAdvanceInterfaceConfig] AS t
        USING (SELECT @brand AS BrandCode) AS s ON t.BrandCode = s.BrandCode
        WHEN MATCHED THEN
          UPDATE SET JournalBatchName = @batch, UpdatedAt = SYSDATETIME(), UpdatedBy = @user
        WHEN NOT MATCHED THEN
          INSERT (BrandCode, JournalBatchName, CreatedBy) VALUES (@brand, @batch, @user);
      `);
  });
}

/** Set the AP-3 VAT-input and WHT-payable GL accounts for one claim brand (Prod + UAT). */
export async function saveClrErpAccounts(
  brandCode: string,
  vatInputGlAccountNo: string | null,
  whtPayableGlAccountNo: string | null,
  userId: number,
): Promise<void> {
  const brand = brandCode.trim().toUpperCase();
  if (!brand) throw new Error("กรุณาเลือกแบรนด์");
  const vat = vatInputGlAccountNo?.trim() || null;
  const wht = whtPayableGlAccountNo?.trim() || null;
  await writeBothPools(async (tx) => {
    await tx.request()
      .input("brand", sql.NVarChar, brand)
      .input("vat", sql.NVarChar, vat)
      .input("wht", sql.NVarChar, wht)
      .input("user", sql.Int, userId || null)
      .query(`
        MERGE [dbo].[AccClearAdvanceInterfaceConfig] AS t
        USING (SELECT @brand AS BrandCode) AS s ON t.BrandCode = s.BrandCode
        WHEN MATCHED THEN
          UPDATE SET VatInputGlAccountNo = @vat, WhtPayableGlAccountNo = @wht,
                     UpdatedAt = SYSDATETIME(), UpdatedBy = @user
        WHEN NOT MATCHED THEN
          INSERT (BrandCode, VatInputGlAccountNo, WhtPayableGlAccountNo, CreatedBy)
          VALUES (@brand, @vat, @wht, @user);
      `);
  });
}
