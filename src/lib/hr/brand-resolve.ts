import { sql } from "@/lib/db/mssql";
import { getHrPool } from "@/lib/hr/pool";
import type { HrBrandInfo } from "@/lib/hr/types";

interface HrBrandRow {
  Id: number;
  Code: string;
  Name: string;
  Color: string | null;
  CompanyName: string | null;
  CompanyAddress: string | null;
  CompanyTaxId: string | null;
  CompanyPhone: string | null;
  LogoPath: string | null;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const brandCache = new Map<string, { data: HrBrandInfo; expiresAt: number }>();

function rowToBrand(row: HrBrandRow): HrBrandInfo {
  return {
    id: row.Id,
    code: row.Code,
    name: row.Name,
    color: row.Color,
    companyName: row.CompanyName,
    companyAddress: row.CompanyAddress,
    companyTaxId: row.CompanyTaxId,
    companyPhone: row.CompanyPhone,
    logoPath: row.LogoPath,
  };
}

/** Resolve Rocks Fast brand code (UNO, KSI, …) to HrBrand row. */
export async function resolveHrBrand(brandCode: string): Promise<HrBrandInfo | null> {
  const code = brandCode.trim().toUpperCase();
  if (!code) return null;

  const now = Date.now();
  const cached = brandCache.get(code);
  if (cached && now < cached.expiresAt) return cached.data;

  const pool = await getHrPool();
  const result = await pool
    .request()
    .input("code", sql.NVarChar, code)
    .query<HrBrandRow>(`
      SELECT Id, Code, Name, Color, CompanyName, CompanyAddress, CompanyTaxId, CompanyPhone, LogoPath
      FROM dbo.HrBrand
      WHERE Code = @code AND IsActive = 1
    `);

  const row = result.recordset[0];
  if (!row) return null;

  const brand = rowToBrand(row);
  brandCache.set(code, { data: brand, expiresAt: now + CACHE_TTL_MS });
  return brand;
}

export function clearHrBrandCache(brandCode?: string): void {
  if (brandCode) brandCache.delete(brandCode.trim().toUpperCase());
  else brandCache.clear();
}
