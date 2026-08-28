/**
 * Which brands this application knows about, and what it shows for each.
 *
 * Two sources, joined here so nothing else has to know there are two:
 *
 * - **`Rocks_Codex.dbo.Brand`** is the company brand master. It decides which
 *   brands exist and what they are called, and it is shared with the Rocks Fast
 *   and ACC Portal siblings. This app never writes it.
 * - **`Rocks_Portal_Form.dbo.BrandSetting`** (migration 122) holds what *this*
 *   app decides about a brand: whether to offer it, and its logo. Production
 *   only — see the migration for why there is no UAT twin.
 *
 * **The master is the registry.** The join runs from it, so a `BrandSetting`
 * row for a code the master does not have is inert rather than a phantom brand,
 * and a brand deleted over there simply stops appearing.
 *
 * **A brand with no `BrandSetting` row is enabled.** There is no backfill: the
 * table shipped empty and every brand is offered until an admin turns one off,
 * which is exactly the behaviour that preceded it.
 */
import { getCorePool, getProductionFormPool, sql } from "@/lib/db/mssql";

export interface RegistryBrand {
  code: string;
  name: string;
  /**
   * What to put in an `<img>`, or null.
   *
   * An uploaded logo wins and is served from this app; otherwise the local
   * `public/brandlogo/{code}-200.png` convention, which is **not** checked for
   * existence — a brand added to the master brings no artwork with it, and a
   * disk stat per brand per request to learn that is a poor trade. The callers
   * that render it fall back on the image failing to load (`BrandMark`), which
   * also covers a file deleted after the page was served.
   */
  logo: string | null;
  /** False only where a row says so. */
  isEnabled: boolean;
  /** ISO-3166-1 alpha-2, or null when nobody has set one. */
  countryCode: string | null;
  /** ISO-4217, or null. Null and "THB" both mean baht — see `acc/currency.ts`. */
  currencyCode: string | null;
  /** Whether a claim against this brand may be entered in `currencyCode`. */
  currencyEnabled: boolean;
  /** True when an uploaded logo is stored for this brand. */
  hasUploadedLogo: boolean;
}

interface BrandSettingRow {
  BrandCode: string;
  IsEnabled: boolean;
  HasLogo: number;
  LogoUpdatedAt: Date | null;
  CountryCode: string | null;
  CurrencyCode: string | null;
  CurrencyEnabled: boolean;
}

/**
 * The cache buster on an uploaded logo's URL.
 *
 * `LogoUpdatedAt` and not `UpdatedAt`, so toggling a brand off and on again
 * does not make every viewer re-download an image that did not change.
 */
function uploadedLogoUrl(code: string, updatedAt: Date | null): string {
  const v = updatedAt ? updatedAt.getTime() : 0;
  return `/api/brand-logo/${encodeURIComponent(code)}?v=${v}`;
}

/** The local-file convention, unchanged: the brand switcher uses the same path. */
function localLogoUrl(code: string): string {
  return `/brandlogo/${code.toLowerCase()}-200.png`;
}

/**
 * Every **active** brand in the master, decorated with this app's settings.
 *
 * Includes disabled brands: the settings page has to list what it can turn back
 * on. Callers that offer a brand to a user want `listSelectableBrands`.
 */
export async function listBrandRegistry(): Promise<RegistryBrand[]> {
  const [corePool, formPool] = await Promise.all([getCorePool(), getProductionFormPool()]);

  const [masterRes, settingRes] = await Promise.all([
    corePool.request().query(`
      SELECT Code, Name
      FROM [Rocks_Codex].[dbo].[Brand] WITH (NOLOCK)
      WHERE IsActive = 1 AND Code IS NOT NULL AND LTRIM(RTRIM(Code)) <> ''
      ORDER BY Id
    `),
    // DATALENGTH rather than the bytes: this runs on every page that shows a
    // brand, and the images are only wanted by the route that serves one.
    formPool.request().query(`
      SELECT BrandCode, IsEnabled,
             CASE WHEN LogoBytes IS NULL THEN 0 ELSE 1 END AS HasLogo,
             LogoUpdatedAt,
             CountryCode, CurrencyCode, CurrencyEnabled
      FROM [dbo].[BrandSetting]
    `),
  ]);

  const settings = new Map<string, BrandSettingRow>();
  for (const r of settingRes.recordset as BrandSettingRow[]) {
    settings.set(r.BrandCode, r);
  }

  return (masterRes.recordset as { Code: string; Name: string | null }[]).map((b) => {
    const s = settings.get(b.Code);
    const hasUploadedLogo = !!s && s.HasLogo === 1;
    return {
      code: b.Code,
      name: b.Name ?? b.Code,
      logo: hasUploadedLogo ? uploadedLogoUrl(b.Code, s!.LogoUpdatedAt) : localLogoUrl(b.Code),
      // Absent means enabled — see the module header.
      isEnabled: s ? s.IsEnabled : true,
      hasUploadedLogo,
      // Absent means NO currency, which is the opposite default to isEnabled
      // and deliberately so: a brand nobody has configured claims in baht, and
      // baht is what every row written before this feature holds.
      countryCode: s?.CountryCode ?? null,
      currencyCode: s?.CurrencyCode ?? null,
      currencyEnabled: s ? s.CurrencyEnabled : false,
    };
  });
}

/** The brands a user may pick. */
export async function listSelectableBrands(): Promise<RegistryBrand[]> {
  return (await listBrandRegistry()).filter((b) => b.isEnabled);
}

/** One brand's uploaded logo, or null. Read by the serving route only. */
export async function getUploadedBrandLogo(
  code: string,
): Promise<{ bytes: Buffer; contentType: string } | null> {
  const pool = await getProductionFormPool();
  const r = await pool
    .request()
    .input("code", sql.NVarChar(40), code)
    .query(`SELECT LogoBytes, LogoContentType FROM [dbo].[BrandSetting] WHERE BrandCode = @code`);
  const row = r.recordset[0] as { LogoBytes: Buffer | null; LogoContentType: string | null } | undefined;
  if (!row?.LogoBytes) return null;
  return {
    bytes: row.LogoBytes,
    // Never echoed to the client as-is — the serving route re-sniffs the bytes.
    // Kept because it is what the upload decided from those same bytes.
    contentType: row.LogoContentType ?? "application/octet-stream",
  };
}

/**
 * Upsert one brand's row.
 *
 * `undefined` leaves a field alone; that is what lets the enable toggle and the
 * logo upload share one row without either clearing the other. Passing `null`
 * for `logo` clears it.
 */
export async function saveBrandSetting(
  code: string,
  patch: {
    isEnabled?: boolean;
    logo?: { bytes: Buffer; contentType: string; fileName: string } | null;
  },
  userId: number,
): Promise<void> {
  const pool = await getProductionFormPool();
  const req = pool
    .request()
    .input("code", sql.NVarChar(40), code)
    .input("userId", sql.Int, userId || null)
    .input("isEnabled", sql.Bit, patch.isEnabled ?? null);

  const touchLogo = patch.logo !== undefined;
  req.input("logoBytes", sql.VarBinary(sql.MAX), patch.logo ? patch.logo.bytes : null);
  req.input("logoType", sql.NVarChar(100), patch.logo ? patch.logo.contentType : null);
  req.input("logoName", sql.NVarChar(260), patch.logo ? patch.logo.fileName : null);

  // One statement, so a row created by the toggle and a row created by the
  // upload cannot race into a duplicate-key error.
  await req.query(`
    MERGE [dbo].[BrandSetting] AS t
    USING (SELECT @code AS BrandCode) AS s ON t.BrandCode = s.BrandCode
    WHEN MATCHED THEN UPDATE SET
      IsEnabled       = COALESCE(@isEnabled, t.IsEnabled),
      LogoBytes       = ${touchLogo ? "@logoBytes" : "t.LogoBytes"},
      LogoContentType = ${touchLogo ? "@logoType" : "t.LogoContentType"},
      LogoFileName    = ${touchLogo ? "@logoName" : "t.LogoFileName"},
      LogoUpdatedAt   = ${touchLogo ? "CASE WHEN @logoBytes IS NULL THEN NULL ELSE SYSDATETIME() END" : "t.LogoUpdatedAt"},
      UpdatedAt       = SYSDATETIME(),
      UpdatedBy       = @userId
    WHEN NOT MATCHED THEN INSERT
      (BrandCode, IsEnabled, LogoBytes, LogoContentType, LogoFileName, LogoUpdatedAt, UpdatedAt, UpdatedBy)
      VALUES (@code, COALESCE(@isEnabled, 1), @logoBytes, @logoType, @logoName,
              CASE WHEN @logoBytes IS NULL THEN NULL ELSE SYSDATETIME() END, SYSDATETIME(), @userId);
  `);
}
