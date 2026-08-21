import { getAccPool, sql } from "@/lib/acc/pool";
import { writeBothPools } from "@/lib/acc/dual-write";

/**
 * AP-3's OWN Interface ERP config, in its own table (AccClearAdvanceInterfaceConfig).
 * AP-3 reverses the cleared AP-2 lines, so the only thing it configures is the
 * Journal Batch its clearing journal posts into (one row per claim brand). Reads
 * use the form pool; writes go through writeBothPools so Prod + UAT stay in sync.
 */

/** AP-3 journal-batch config, keyed by upper-case brand code. */
export async function listClrInterfaceConfig(): Promise<Record<string, string | null>> {
  const pool = await getAccPool();
  const r = await pool.request().query(
    `SELECT BrandCode, JournalBatchName FROM [dbo].[AccClearAdvanceInterfaceConfig]`,
  );
  const map: Record<string, string | null> = {};
  for (const row of r.recordset as Record<string, unknown>[]) {
    map[(row.BrandCode as string).toUpperCase()] = (row.JournalBatchName as string) ?? null;
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
