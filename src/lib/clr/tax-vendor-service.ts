import { getAppPool, sql } from "@/lib/db/mssql";
import { env } from "@/env";

export interface TaxVendorCandidate {
  vendorNo: string;
  displayName: string | null;
  taxRegistrationNumber: string | null;
}

/**
 * Every vendor card in one BC company that a person may pick.
 *
 * The whole list, in one call, because it is small enough to be: PCTH is the
 * largest at 1,604 active cards, about 93KB of text. The screen then filters it
 * as the reader types, with no round trip and no button to press.
 *
 * Filtering in the browser also sidesteps the collation. `DisplayName` is
 * Thai_CI_AS, where LIKE compares collation elements — a Thai consonant and the
 * mark above it are one — so '%พิษณุพจน%' did not match "พิษณุพจน์" and a seller
 * whose name the OCR read one mark short was reported as not a vendor at all.
 * JavaScript compares code units, so a substring is a substring.
 *
 * Scoped to the Company the journal posts into: `ErpVendors` is keyed by
 * Company, and a vendor number from one is meaningless in another.
 */
export async function listTaxVendors(company: string): Promise<TaxVendorCandidate[]> {
  const co = (company ?? "").trim().toUpperCase();
  if (!co) return [];

  const pool = await getAppPool(env.MSSQL_ERP_DATA_DATABASE);
  const res = await pool
    .request()
    .input("co", sql.NVarChar, co)
    .query(`
      SELECT VendorNo, DisplayName, TaxRegistrationNumber
      FROM [dbo].[ErpVendors]
      WHERE BrandCode = @co
        AND IsActive = 1
        AND (IsBlocked = 0 OR IsBlocked IS NULL)
      ORDER BY DisplayName, VendorNo
    `);

  return (res.recordset as Record<string, unknown>[]).map((r) => ({
    vendorNo: String(r.VendorNo ?? ""),
    displayName: (r.DisplayName as string) ?? null,
    taxRegistrationNumber: (r.TaxRegistrationNumber as string) ?? null,
  }));
}
