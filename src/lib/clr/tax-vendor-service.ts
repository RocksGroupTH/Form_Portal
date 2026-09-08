import { getAppPool, sql } from "@/lib/db/mssql";
import { env } from "@/env";
import { buildVendorNameTerms, likePattern } from "./tax-vendor-core";

/** A name search returns a list to choose from, so it is capped rather than paged. */
const NAME_SEARCH_LIMIT = 50;

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

/**
 * The vendor cards in one BC company whose name contains every search word.
 *
 * The second way in, and not a lesser one. 155 active trade vendors in PCTH
 * carry no tax registration number on their card at all — VTD, PCT, VOH and VTO
 * numbers, real suppliers — and no tax-id search will ever reach them. It also
 * narrows the opposite case: when one tax id answers with 24 Central Pattana
 * cards, the thing that tells them apart ("[CTW]", "[CMI]") is in the name.
 *
 * Words are ANDed, so pasting the whole name off the invoice and typing two
 * words both work. It stays an exact-substring search — no fuzzy matching, no
 * model — because the accountant is choosing from what comes back, and a list
 * that quietly includes near-misses is harder to trust than a short one.
 */
export async function searchTaxVendorsByName(
  company: string,
  name: string,
): Promise<TaxVendorCandidate[]> {
  const co = (company ?? "").trim().toUpperCase();
  const terms = buildVendorNameTerms(name);
  if (!co || terms.length === 0) return [];

  const pool = await getAppPool(env.MSSQL_ERP_DATA_DATABASE);
  const req = pool.request().input("co", sql.NVarChar, co).input("top", sql.Int, NAME_SEARCH_LIMIT);
  terms.forEach((t, i) => req.input(`t${i}`, sql.NVarChar, likePattern(t)));
  // Compared byte-wise, and upper-cased so English names stay case-insensitive.
  //
  // DisplayName is Thai_CI_AS, where LIKE matches collation elements rather than
  // characters: a Thai consonant and the mark above it are one element, so
  // '%พิษณุพจน%' does not match "พิษณุพจน์". The OCR drops that mark routinely —
  // it read this seller as "ภาสพงษ์ พิษณุพจน" — and the search then reported the
  // vendor as not existing while the card sat there under one extra mark.
  const where = terms
    .map(
      (_, i) =>
        `AND UPPER(DisplayName) COLLATE Latin1_General_BIN2 LIKE UPPER(@t${i}) COLLATE Latin1_General_BIN2 ESCAPE '\\'`,
    )
    .join("\n        ");

  const res = await req.query(`
      SELECT TOP (@top) VendorNo, DisplayName, TaxRegistrationNumber
      FROM [dbo].[ErpVendors]
      WHERE BrandCode = @co
        AND IsActive = 1
        AND (IsBlocked = 0 OR IsBlocked IS NULL)
        ${where}
      ORDER BY DisplayName, VendorNo
    `);

  return (res.recordset as Record<string, unknown>[]).map((r) => ({
    vendorNo: String(r.VendorNo ?? ""),
    displayName: (r.DisplayName as string) ?? null,
    taxRegistrationNumber: (r.TaxRegistrationNumber as string) ?? null,
  }));
}
