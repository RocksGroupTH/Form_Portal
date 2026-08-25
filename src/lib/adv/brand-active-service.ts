import { writeBothPools } from "@/lib/acc/dual-write";
import { sql } from "@/lib/adv/pool";

/**
 * Turn a brand on/off for BOTH AP-2 and AP-3 at once (shared IsActive).
 * MERGE keeps them in lockstep: an AP-3 row missing for a brand is inserted
 * from the AP-2 row's SortOrder so the shared write can never half-apply.
 * Dual-writes prod + UAT via writeBothPools.
 */
export async function setBrandActiveShared(
  brandCode: string,
  active: boolean,
  userId: number,
): Promise<void> {
  const brand = brandCode.trim().toUpperCase();
  if (!brand) throw new Error("กรุณาเลือกแบรนด์");
  await writeBothPools(async (tx) => {
    // SortOrder to use if an AP-3 row must be created — take the AP-2 row's, else 0.
    const soRes = await tx.request()
      .input("brand", sql.NVarChar, brand)
      .query(`SELECT SortOrder FROM [dbo].[AccFormBrand] WHERE FormCode='AP-2' AND BrandCode=@brand`);
    const sortOrder = (soRes.recordset[0]?.SortOrder as number | undefined) ?? 0;

    for (const form of ["AP-2", "AP-3"] as const) {
      await tx.request()
        .input("form", sql.NVarChar, form)
        .input("brand", sql.NVarChar, brand)
        .input("active", sql.Bit, active)
        .input("sort", sql.Int, sortOrder)
        .query(`
          MERGE [dbo].[AccFormBrand] AS t
          USING (SELECT @form AS FormCode, @brand AS BrandCode) AS s
          ON t.FormCode = s.FormCode AND t.BrandCode = s.BrandCode
          WHEN MATCHED THEN UPDATE SET IsActive = @active
          WHEN NOT MATCHED THEN INSERT (FormCode, BrandCode, IsActive, SortOrder)
            VALUES (@form, @brand, @active, @sort);`);
    }
  });
  void userId; // reserved for a future audit column; not stored today
}
