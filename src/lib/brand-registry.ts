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
import {
  brandCurrencyChanges,
  type BrandCurrencyPatch,
} from "@/lib/acc/brand-currency-input";

/**
 * A brand-currency save refused for a reason worth showing the person who made
 * it — an unknown brand code, today.
 *
 * Its own class so a route answers 400 rather than 500 without matching on a
 * message, the way `AccForbiddenError` and friends work in `acc/request-errors`.
 */
export class BrandCurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrandCurrencyError";
  }
}

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

/**
 * One brand's country, claim currency and the switch that turns it on.
 *
 * **This lives here rather than in `@/lib/acc/settings-service`, and it must
 * stay here.** `BrandSetting` has no row in `Rocks_Portal_Form_UAT` — it has no
 * *object* there — so a statement naming it from `getAccPool()`/`getFormPool()`
 * throws `Invalid object name` for a UAT tester and for nobody else.
 * `settings-service.ts` imports `getAccPool` on its first line, and
 * `@/lib/acc/currency-pool-guard.test.ts` is per **file**, not per statement:
 * the moment this statement landed there the test would go red. The fix would
 * be to move it back, never to weaken the guard.
 *
 * **The change and its audit rows commit together**, one transaction on one
 * connection, the shape `createApiKey` uses. The audit is a requirement rather
 * than tidiness: the value is stored once per brand while the permission to
 * change it is per form (spec §9.3), so an AP-17 booking approver holding the
 * `brands` grant can change what an AP-1 travel claim converts at, on a roster
 * AP-1's admins do not control. That is a decision the user took knowingly and
 * cannot be expressed as a constraint, so `BrandSettingLog` — with the
 * `FormCode` of the tab the change came from — is how it is traced instead.
 *
 * `AccActivityLog` cannot hold these rows: its `RequestId` is `int NOT NULL`
 * with an FK to `AccRequest`, and a brand change has no request.
 *
 * A save that changes nothing writes nothing — neither the row nor a log entry.
 * A log recording *saves* rather than *changes* cannot answer "when did this
 * last change", which is the only question it exists for.
 */
export async function saveBrandCurrency(
  code: string,
  patch: BrandCurrencyPatch,
  context: { formCode: string; userId: number },
): Promise<void> {
  // The master is the registry (see the module header), so a row written for a
  // code it does not have would be inert — and invisible, since every read
  // joins from the master. Refuse instead of storing something nothing can show.
  const known = await listBrandRegistry();
  if (!known.some((b) => b.code === code)) {
    throw new BrandCurrencyError(`ไม่พบแบรนด์ ${code}`);
  }

  const pool = await getProductionFormPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const cur = await tx
      .request()
      .input("code", sql.NVarChar(40), code)
      .query(`
        SELECT CountryCode, CurrencyCode, CurrencyEnabled
        FROM [dbo].[BrandSetting] WITH (UPDLOCK, HOLDLOCK)
        WHERE BrandCode = @code
      `);
    const row = cur.recordset[0] as
      | { CountryCode: string | null; CurrencyCode: string | null; CurrencyEnabled: boolean }
      | undefined;

    // No row is not "unknown": the column defaults are what such a brand
    // behaves as today, so they are what the change is measured against.
    // CHAR(n) comes back space-padded, which would otherwise read as a change
    // on every save.
    const before: BrandCurrencyPatch = {
      countryCode: (row?.CountryCode ?? "").trim() || null,
      currencyCode: (row?.CurrencyCode ?? "").trim() || null,
      currencyEnabled: row ? !!row.CurrencyEnabled : false,
    };

    const changes = brandCurrencyChanges(before, patch);
    if (changes.length === 0) {
      await tx.commit();
      return;
    }

    await tx
      .request()
      .input("code", sql.NVarChar(40), code)
      .input("country", sql.Char(2), patch.countryCode)
      .input("currency", sql.Char(3), patch.currencyCode)
      .input("enabled", sql.Bit, patch.currencyEnabled)
      .input("userId", sql.Int, context.userId || null)
      .query(`
        MERGE [dbo].[BrandSetting] AS t
        USING (SELECT @code AS BrandCode) AS s ON t.BrandCode = s.BrandCode
        WHEN MATCHED THEN UPDATE SET
          CountryCode     = @country,
          CurrencyCode    = @currency,
          CurrencyEnabled = @enabled,
          UpdatedAt       = SYSDATETIME(),
          UpdatedBy       = @userId
        WHEN NOT MATCHED THEN INSERT
          (BrandCode, IsEnabled, CountryCode, CurrencyCode, CurrencyEnabled, UpdatedAt, UpdatedBy)
          VALUES (@code, 1, @country, @currency, @enabled, SYSDATETIME(), @userId);
      `);
    // IsEnabled = 1 on the insert is not a new grant: a brand with no row is
    // already enabled (module header), so this is the value that leaves the
    // picker exactly as it was. Setting a currency must not change who can see
    // the brand — that is why CurrencyEnabled is its own column.

    for (const c of changes) {
      await tx
        .request()
        .input("code", sql.NVarChar(40), code)
        .input("field", sql.NVarChar(40), c.field)
        .input("old", sql.NVarChar(100), c.oldValue)
        .input("new", sql.NVarChar(100), c.newValue)
        .input("form", sql.NVarChar(20), context.formCode)
        .input("user", sql.Int, context.userId || null)
        .query(`
          INSERT INTO [dbo].[BrandSettingLog]
            (BrandCode, Field, OldValue, NewValue, FormCode, ChangedBy)
          VALUES (@code, @field, @old, @new, @form, @user)
        `);
    }

    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}
