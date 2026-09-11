import { getAccPool, sql } from "@/lib/acc/pool";
import { AP3_FORM_CODE } from "@/features/clear-advance/constants";
import { pickKnownSellers, type KnownSellerRow } from "@/lib/clr/known-seller-core";

/**
 * Sellers this brand has cleared before, from clearings an accountant approved.
 *
 * Scoped to the brand because a seller is a fact about a company's own trade,
 * and because a name someone in another company typed is not something this
 * requester can check.
 *
 * Only 'Approved'. A draft is somebody mid-typing and a cancelled request is
 * often cancelled precisely because it was wrong; neither is evidence about who
 * a tax id belongs to. `pickKnownSellers` applies the rest of the judgement —
 * the check digit and the ambiguous-spelling rule — so this query stays a
 * question about what happened, not about what to believe.
 */
export async function listKnownSellers(brandCode: string): Promise<Map<string, string>> {
  const brand = (brandCode ?? "").trim();
  if (!brand) return new Map();

  const pool = await getAccPool();
  const res = await pool
    .request()
    .input("brand", sql.NVarChar, brand)
    .input("form", sql.NVarChar, AP3_FORM_CODE)
    .query(`
      SELECT REPLACE(REPLACE(i.TaxId, '-', ''), ' ', '') AS Tin,
             i.PayeeName,
             COUNT(*) AS Uses
      FROM [dbo].[AccClearAdvanceItem] i
      JOIN [dbo].[AccClearAdvance] c ON c.Id = i.ClearAdvanceId
      JOIN [dbo].[AccRequest] r ON r.Id = c.RequestId
      WHERE r.FormCode = @form
        AND r.Status = 'Approved'
        AND r.BrandCode = @brand
        AND LEN(REPLACE(REPLACE(ISNULL(i.TaxId, ''), '-', ''), ' ', '')) = 13
        AND LTRIM(RTRIM(ISNULL(i.PayeeName, ''))) <> ''
      GROUP BY REPLACE(REPLACE(i.TaxId, '-', ''), ' ', ''), i.PayeeName
    `);

  const rows: KnownSellerRow[] = (res.recordset as Record<string, unknown>[]).map((r) => ({
    tin: String(r.Tin ?? ""),
    payeeName: (r.PayeeName as string) ?? null,
    uses: Number(r.Uses ?? 0),
  }));
  return pickKnownSellers(rows);
}
