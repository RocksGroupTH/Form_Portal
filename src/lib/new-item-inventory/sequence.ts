import { getCorePool, sql } from "@/lib/db/mssql";
import { REQUEST_NO_PREFIX } from "@/features/new-item-inventory/constants";

/**
 * Allocate the next request number for a brand: NII-{BRAND}-{YYYYMM}-{seq}.
 * Sequence is per brand per calendar month, 3-digit zero-padded.
 *
 * Atomic: MERGE with HOLDLOCK serialises concurrent allocations so two
 * submits in the same brand+month never receive the same number.
 *
 * Server runs in Thai time; we use local getters (not toISOString).
 */
export async function allocateRequestNo(brandCode: string): Promise<string> {
  const now = new Date();
  const yearMonth = now.getFullYear() * 100 + (now.getMonth() + 1); // YYYYMM

  const pool = await getCorePool();
  const result = await pool
    .request()
    .input("brand", sql.NVarChar, brandCode)
    .input("ym", sql.Int, yearMonth)
    .query(`
      MERGE [NewItemInventorySequence] WITH (HOLDLOCK) AS t
      USING (SELECT @brand AS BrandCode, @ym AS YearMonth) AS s
        ON t.BrandCode = s.BrandCode AND t.YearMonth = s.YearMonth
      WHEN MATCHED THEN
        UPDATE SET LastSeq = t.LastSeq + 1, UpdatedAt = SYSDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (BrandCode, YearMonth, LastSeq, UpdatedAt)
        VALUES (s.BrandCode, s.YearMonth, 1, SYSDATETIME())
      OUTPUT INSERTED.LastSeq AS LastSeq;
    `);

  const seq = result.recordset[0]?.LastSeq as number | undefined;
  if (seq == null) {
    throw new Error("Failed to allocate request number");
  }

  return `${REQUEST_NO_PREFIX}-${brandCode}-${yearMonth}-${String(seq).padStart(3, "0")}`;
}
