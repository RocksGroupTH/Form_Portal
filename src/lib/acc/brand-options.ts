import { getAccPool, sql } from "@/lib/acc/pool";
import { listBrandRegistry } from "@/lib/brand-registry";
import type { AccBrandOption } from "@/features/accounting/types";

/**
 * All active brands from the company brand master, with this app's logo for
 * each — an uploaded one where there is one, the local file otherwise.
 *
 * **Disabled brands are still returned.** `BrandSetting.IsEnabled` governs the
 * brand *picker*: whether a user may work under that brand. This list is the
 * one an admin grants a form access to, and hiding a brand here would make an
 * existing grant invisible rather than revoked. Narrow it at the picker, which
 * is what `listSelectableBrands` is for.
 *
 * The Codex `Logo` column is still ignored: it holds a path on the Codex server
 * (/uploads/brands/*), and that server serves the newer brands only behind a
 * login — measured 2026-08-26. See `brand-registry.ts`.
 */
export async function listAllBrands(): Promise<AccBrandOption[]> {
  return (await listBrandRegistry()).map((b) => ({
    brandCode: b.code,
    brandName: b.name,
    brandLogo: b.logo,
    currencyCode: b.currencyCode,
    currencyEnabled: b.currencyEnabled,
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
      // From the map this function already builds — not a second query.
      currencyCode: b?.currencyCode ?? null,
      currencyEnabled: b?.currencyEnabled ?? false,
    };
  });
}

/**
 * Does `AccFormBrand` grant `brandCode` to `formCode`? The narrow yes/no a
 * submit gate asks.
 *
 * `getAllowedBrands` answers the same question, but only after enriching every
 * row from the company brand master — `Rocks_Codex.dbo.Brand`, through
 * `getCorePool()` — which is display data a grant check never reads. Using it
 * for the check coupled AP-4's submit to a second database's availability: an
 * outage in Fast_Core threw out of the grant test and surfaced a raw driver
 * message, refusing a claim whose brand was in fact allowed.
 *
 * The two agree on membership. `getAllowedBrands` maps every `AccFormBrand` row
 * through, falling back to the code when the master has no row for it, so it
 * never filters an allowed brand out — this is the same set, without the join.
 *
 * Reads through `getAccPool()`, so it asks the database the request resolved to.
 */
export async function isBrandAllowedForForm(
  formCode: string,
  brandCode: string,
): Promise<boolean> {
  const pool = await getAccPool();
  const r = await pool
    .request()
    .input("form", sql.NVarChar, formCode)
    .input("brand", sql.NVarChar, brandCode)
    .query(`
      SELECT TOP 1 1 AS Allowed FROM [dbo].[AccFormBrand]
      WHERE FormCode = @form AND BrandCode = @brand AND IsActive = 1
    `);
  return r.recordset.length > 0;
}
