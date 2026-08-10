import { getAccPool, sql } from "@/lib/acc/pool";
import { getCorePool } from "@/lib/db/mssql";
import type { AccBrandOption } from "@/features/accounting/types";

/** All active brands from the company brand master (Rocks_Codex.dbo.Brand). */
export async function listAllBrands(): Promise<AccBrandOption[]> {
  const pool = await getCorePool();
  const r = await pool.request().query(`
    SELECT Code, Name, Logo
    FROM [Rocks_Codex].[dbo].[Brand] WITH (NOLOCK)
    WHERE IsActive = 1 AND Code IS NOT NULL AND LTRIM(RTRIM(Code)) <> ''
    ORDER BY Id
  `);
  // The Codex Logo column points at /uploads/brands/* which this app does not
  // serve. Use the local processed logos at /brandlogo/{code}-200.png instead
  // (same convention as the brand switcher).
  return r.recordset.map((x: { Code: string; Name: string | null; Logo: string | null }) => ({
    brandCode: x.Code,
    brandName: x.Name ?? x.Code,
    brandLogo: `/brandlogo/${x.Code.toLowerCase()}-200.png`,
  }));
}

/**
 * Brands allowed for a form (from AccFormBrand), enriched with display
 * name/logo from the brand master (Rocks_Codex.dbo.Brand).
 */
export async function getAllowedBrands(formCode: string): Promise<AccBrandOption[]> {
  const pool = await getAccPool();
  const r = await pool
    .request()
    .input("form", sql.NVarChar, formCode)
    .query(`
      SELECT BrandCode FROM [dbo].[AccFormBrand]
      WHERE FormCode = @form AND IsActive = 1 ORDER BY SortOrder, BrandCode
    `);

  const all = await listAllBrands();
  const byCode = new Map(all.map((b) => [b.brandCode, b]));

  return r.recordset.map((row: { BrandCode: string }) => {
    const b = byCode.get(row.BrandCode);
    return {
      brandCode: row.BrandCode,
      brandName: b?.brandName ?? row.BrandCode,
      brandLogo: b?.brandLogo ?? null,
    };
  });
}
