import { getAppPool, sql } from "@/lib/db/mssql";
import { env } from "@/env";

export interface TaxVendorCandidate {
  vendorNo: string;
  displayName: string | null;
  taxRegistrationNumber: string | null;
}

/**
 * The vendor cards in one BC company that carry a given tax id.
 *
 * A list, not an answer. One tax id routinely maps to many cards — Central
 * Pattana has 24 in PCTH under 0107537002443, one per mall, told apart only by a
 * prefix in the name like "[CTW]" or "[CMI]". Picking the first would be right
 * once in twenty-four times, and wrong in exactly the cases where the branch
 * matters, so the list goes to a person.
 *
 * Empty is a normal answer: a one-off seller is not a vendor of ours, and the
 * field is then left blank rather than filled with a near miss.
 *
 * Scoped to the Company the journal posts into (the interface target), because
 * `ErpVendors` is keyed by Company and a vendor number from one is meaningless
 * in another.
 */
export async function suggestTaxVendors(
  company: string,
  taxId: string,
): Promise<TaxVendorCandidate[]> {
  const co = (company ?? "").trim().toUpperCase();
  const tin = (taxId ?? "").replace(/\D/g, "");
  if (!co || tin.length !== 13) return [];

  const pool = await getAppPool(env.MSSQL_ERP_DATA_DATABASE);
  const res = await pool
    .request()
    .input("co", sql.NVarChar, co)
    .input("tin", sql.NVarChar, tin)
    .query(`
      SELECT VendorNo, DisplayName, TaxRegistrationNumber
      FROM [dbo].[ErpVendors]
      WHERE BrandCode = @co
        AND IsActive = 1
        AND (IsBlocked = 0 OR IsBlocked IS NULL)
        -- Punctuation varies between cards, so both sides are reduced to digits.
        AND REPLACE(REPLACE(REPLACE(ISNULL(TaxRegistrationNumber, ''), '-', ''), ' ', ''), '.', '') = @tin
      ORDER BY VendorNo
    `);

  return (res.recordset as Record<string, unknown>[]).map((r) => ({
    vendorNo: String(r.VendorNo ?? ""),
    displayName: (r.DisplayName as string) ?? null,
    taxRegistrationNumber: (r.TaxRegistrationNumber as string) ?? null,
  }));
}
