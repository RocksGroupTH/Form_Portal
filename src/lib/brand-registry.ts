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
 * - **`Rocks_Portal_Form.dbo.BrandCurrency`** (migration 127) holds the
 *   currencies a claim against a brand may be entered in — **several per
 *   brand**, each with its own enable flag. Production only, for the same
 *   reason, which is why this module is the one place either table is named:
 *   `currency-pool-guard.test.ts` pins that per file.
 *
 * **`BrandSetting.CountryCode` / `.CurrencyCode` / `.CurrencyEnabled` are dead.**
 * Migration 124 added them on the design that a brand claims in one currency; it
 * does not. 127 replaced them and 128 drops them, and until then the rule is
 * that nothing reads them — two places that could answer "which currency" is
 * exactly the confusion this feature exists to remove.
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
import { enabledForeignCurrencies, type BrandCurrencyEntry } from "@/lib/acc/currency";
import {
  brandCurrencyLogValue,
  BRAND_CURRENCY_LOG_FIELD,
  type BrandCurrencyAdd,
} from "@/lib/acc/brand-currency-input";

/**
 * A brand-currency write refused for a reason worth showing the person who made
 * it — an unknown brand code, a currency the brand already carries, or a row
 * somebody else removed first.
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

/**
 * SQL Server's two "you broke a uniqueness rule" errors — 2627 for a constraint,
 * 2601 for a unique index.
 *
 * **`UQ_BrandCurrency_Brand_Currency` is where "no duplicates" lives** (migration
 * 127), not in a handler and not in the panel: two admins on two tabs, or one
 * request replayed, defeat any check made before the insert. What this function
 * buys is only that the rule reads as a sentence rather than as a 500 — the
 * refusal happens whether or not anybody translates it.
 */
function isUniqueViolation(e: unknown): boolean {
  const n = (e as { number?: unknown } | null)?.number;
  return n === 2627 || n === 2601;
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
  /**
   * Every currency configured for this brand, in `SortOrder` then id order —
   * enabled or not, so the settings editor can list what it may switch back on.
   *
   * **A list, not a code.** `BrandSetting` carried one `CountryCode` /
   * `CurrencyCode` / `CurrencyEnabled` triple until 2026-08-28 and cannot say
   * what KSI needs: Thailand (THB) *and* England (GBP), and more later. Those
   * three columns still exist — migration 128 drops them — and **nothing reads
   * them any more**; `BrandCurrency` is the only source of truth.
   *
   * Consumers wanting "what may a claim be entered in" call
   * `enabledForeignCurrencies` or `brandCurrencyState` rather than filtering
   * this by hand, so the rule has one definition.
   */
  currencies: BrandCurrencyEntry[];
  /** True when an uploaded logo is stored for this brand. */
  hasUploadedLogo: boolean;
}

interface BrandSettingRow {
  BrandCode: string;
  IsEnabled: boolean;
  HasLogo: number;
  LogoUpdatedAt: Date | null;
}

interface BrandCurrencyRow {
  Id: number;
  BrandCode: string;
  CountryCode: string | null;
  CurrencyCode: string;
  IsEnabled: boolean;
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

  const [masterRes, settingRes, currencyRes] = await Promise.all([
    corePool.request().query(`
      SELECT Code, Name
      FROM [Rocks_Codex].[dbo].[Brand] WITH (NOLOCK)
      WHERE IsActive = 1 AND Code IS NOT NULL AND LTRIM(RTRIM(Code)) <> ''
      ORDER BY Id
    `),
    // DATALENGTH rather than the bytes: this runs on every page that shows a
    // brand, and the images are only wanted by the route that serves one.
    //
    // `CountryCode`, `CurrencyCode` and `CurrencyEnabled` are deliberately NOT
    // selected. They still exist on the table until migration 128 drops them,
    // and reading them here is how two answers to "which currency" would come
    // back into existence — the confusion `BrandCurrency` was created to end.
    formPool.request().query(`
      SELECT BrandCode, IsEnabled,
             CASE WHEN LogoBytes IS NULL THEN 0 ELSE 1 END AS HasLogo,
             LogoUpdatedAt
      FROM [dbo].[BrandSetting]
    `),
    // One query for every brand's currencies rather than one per brand: this
    // list is read on every page that shows a brand picker.
    formPool.request().query(`
      SELECT Id, BrandCode, CountryCode, CurrencyCode, IsEnabled
      FROM [dbo].[BrandCurrency]
      ORDER BY BrandCode, SortOrder, Id
    `),
  ]);

  const settings = new Map<string, BrandSettingRow>();
  for (const r of settingRes.recordset as BrandSettingRow[]) {
    settings.set(r.BrandCode, r);
  }

  // CHAR(2)/CHAR(3) come back space-padded, so every consumer would otherwise
  // be comparing `"MYR"` against `"MYR"` with no padding on one side and some
  // on the other. Trimmed once, here, where the column shape is known.
  const currencies = new Map<string, BrandCurrencyEntry[]>();
  for (const r of currencyRes.recordset as BrandCurrencyRow[]) {
    const list = currencies.get(r.BrandCode) ?? [];
    list.push({
      id: r.Id,
      countryCode: (r.CountryCode ?? "").trim().toUpperCase() || null,
      currencyCode: (r.CurrencyCode ?? "").trim().toUpperCase(),
      isEnabled: !!r.IsEnabled,
    });
    currencies.set(r.BrandCode, list);
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
      // No rows means NO currency, which is the opposite default to isEnabled
      // and deliberately so: a brand nobody has configured claims in baht, and
      // baht is what every row written before this feature holds.
      currencies: currencies.get(b.Code) ?? [],
    };
  });
}

/** The brands a user may pick. */
export async function listSelectableBrands(): Promise<RegistryBrand[]> {
  return (await listBrandRegistry()).filter((b) => b.isEnabled);
}

/**
 * The foreign currencies a claim against this brand may be entered in.
 *
 * **Empty covers every way of having no choice**: no brand code, a code the
 * master does not carry, nothing configured, rows staged but switched off, and
 * a brand whose only configured currency is baht. `enabledForeignCurrencies`
 * owns that rule and this defers to it rather than re-deriving it — the same
 * function the two forms' pickers reach through, so what a document read may be
 * trusted with and what the picker offers can never disagree.
 *
 * **This is what the AI document reads resolve server-side.** They must never
 * take a currency from the caller: a body shaped by hand would otherwise have a
 * currency accepted that the brand does not offer. And it must be read here
 * rather than through `getAccPool()`, which resolves `Rocks_Portal_Form_UAT`
 * where neither `BrandSetting` nor `BrandCurrency` has an object at all.
 */
export async function getBrandClaimCurrencies(
  code: string | null | undefined,
): Promise<string[]> {
  const want = (code ?? "").trim();
  if (want === "") return [];

  const brands = await listBrandRegistry();
  for (let i = 0; i < brands.length; i++) {
    if (brands[i].code !== want) continue;
    return enabledForeignCurrencies(brands[i].currencies);
  }
  return [];
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
 * The three writes against `BrandCurrency`, and the audit rows that commit with
 * them.
 *
 * **They live here rather than in `@/lib/acc/settings-service`, and they must
 * stay here.** Neither `BrandSetting` nor `BrandCurrency` has a row in
 * `Rocks_Portal_Form_UAT` — neither has an *object* there — so a statement
 * naming either from `getAccPool()`/`getFormPool()` throws `Invalid object
 * name` for a UAT tester and for nobody else. `settings-service.ts` imports
 * `getAccPool` on its first line, and `@/lib/acc/currency-pool-guard.test.ts`
 * is per **file**, not per statement: the moment one of these statements landed
 * there the test would go red. The fix would be to move it back, never to
 * weaken the guard.
 *
 * **Each change and its audit row commit together**, one transaction on one
 * connection, the shape `createApiKey` uses. The audit is a requirement rather
 * than tidiness: the values are stored once per brand while the permission to
 * change them is per form (spec §9.3), so an AP-17 booking approver holding the
 * `brands` grant can change what an AP-1 travel claim converts at, on a roster
 * AP-1's admins do not control. That is a decision the user took knowingly and
 * cannot be expressed as a constraint, so `BrandSettingLog` — with the
 * `FormCode` of the tab the change came from — is how it is traced instead.
 *
 * `AccActivityLog` cannot hold these rows: its `RequestId` is `int NOT NULL`
 * with an FK to `AccRequest`, and a brand change has no request.
 *
 * There is no diff-and-skip step of the kind the old single-currency save
 * needed. Each of these is one deliberate act on one row — add it, switch it,
 * remove it — so a call that reaches the database is a change, and one that
 * finds nothing to change refuses or returns rather than logging a save.
 */
export interface BrandCurrencyContext {
  /** Which form's tab the change was made from — `AP-1` or `AP-17`. */
  formCode: string;
  userId: number;
}

/** The audit row, on the same connection and inside the same transaction. */
async function logBrandCurrency(
  tx: sql.Transaction,
  brandCode: string,
  oldValue: string | null,
  newValue: string | null,
  context: BrandCurrencyContext,
): Promise<void> {
  await tx
    .request()
    .input("code", sql.NVarChar(40), brandCode)
    .input("field", sql.NVarChar(40), BRAND_CURRENCY_LOG_FIELD)
    .input("old", sql.NVarChar(100), oldValue)
    .input("new", sql.NVarChar(100), newValue)
    .input("form", sql.NVarChar(20), context.formCode)
    .input("user", sql.Int, context.userId || null)
    .query(`
      INSERT INTO [dbo].[BrandSettingLog]
        (BrandCode, Field, OldValue, NewValue, FormCode, ChangedBy)
      VALUES (@code, @field, @old, @new, @form, @user)
    `);
}

/**
 * Add one currency to a brand. New rows arrive **enabled** — the table's own
 * default — because adding one is a deliberate act naming a currency, unlike
 * `BrandSetting.CurrencyEnabled`, which sat on every brand whether anybody had
 * configured it or not.
 *
 * **Duplicates are refused by `UQ_BrandCurrency_Brand_Currency`**, not by a
 * read-then-write here. A check made first is a rule two admins on two tabs
 * defeat, and one replayed request defeats on its own; the constraint cannot be.
 * All this does is turn its violation into a sentence somebody can act on.
 */
export async function addBrandCurrency(
  add: BrandCurrencyAdd,
  context: BrandCurrencyContext,
): Promise<void> {
  // The master is the registry (see the module header), so a row written for a
  // code it does not have would be inert — and invisible, since every read
  // joins from the master. Refuse instead of storing something nothing can show.
  const known = await listBrandRegistry();
  if (!known.some((b) => b.code === add.brandCode)) {
    throw new BrandCurrencyError(`ไม่พบแบรนด์ ${add.brandCode}`);
  }

  const pool = await getProductionFormPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    await tx
      .request()
      .input("code", sql.NVarChar(40), add.brandCode)
      .input("country", sql.Char(2), add.countryCode)
      .input("currency", sql.Char(3), add.currencyCode)
      .query(`
        INSERT INTO [dbo].[BrandCurrency]
          (BrandCode, CountryCode, CurrencyCode, IsEnabled, SortOrder)
        SELECT @code, @country, @currency, 1,
               ISNULL((SELECT MAX(SortOrder) + 1 FROM [dbo].[BrandCurrency] WHERE BrandCode = @code), 0)
      `);

    await logBrandCurrency(
      tx,
      add.brandCode,
      null,
      brandCurrencyLogValue({
        countryCode: add.countryCode,
        currencyCode: add.currencyCode,
        isEnabled: true,
      }),
      context,
    );

    await tx.commit();
  } catch (e) {
    await tx.rollback();
    if (isUniqueViolation(e)) {
      throw new BrandCurrencyError(
        `แบรนด์ ${add.brandCode} มีสกุลเงิน ${add.currencyCode} อยู่แล้ว`,
      );
    }
    throw e;
  }
}

/**
 * Switch one configured currency on or off.
 *
 * The row is read under `UPDLOCK, HOLDLOCK` first because the log needs what it
 * *was*, and a value read outside the lock could be stale by the time the update
 * lands — an audit trail stating a transition that never happened is worse than
 * no audit trail. A row already in the requested state writes nothing and logs
 * nothing: a log recording *saves* rather than *changes* cannot answer "when did
 * this last change", which is the only question it exists for.
 */
export async function setBrandCurrencyEnabled(
  id: number,
  isEnabled: boolean,
  context: BrandCurrencyContext,
): Promise<void> {
  const pool = await getProductionFormPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const cur = await tx
      .request()
      .input("id", sql.Int, id)
      .query(`
        SELECT Id, BrandCode, CountryCode, CurrencyCode, IsEnabled
        FROM [dbo].[BrandCurrency] WITH (UPDLOCK, HOLDLOCK)
        WHERE Id = @id
      `);
    const row = cur.recordset[0] as BrandCurrencyRow | undefined;
    if (!row) {
      await tx.rollback();
      throw new BrandCurrencyError("ไม่พบสกุลเงินนี้แล้ว — อาจถูกลบไปก่อนหน้านี้");
    }

    const before = {
      countryCode: (row.CountryCode ?? "").trim().toUpperCase() || null,
      currencyCode: (row.CurrencyCode ?? "").trim().toUpperCase(),
      isEnabled: !!row.IsEnabled,
    };
    if (before.isEnabled === isEnabled) {
      await tx.commit();
      return;
    }

    await tx
      .request()
      .input("id", sql.Int, id)
      .input("enabled", sql.Bit, isEnabled)
      .query(`
        UPDATE [dbo].[BrandCurrency]
        SET IsEnabled = @enabled, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    await logBrandCurrency(
      tx,
      row.BrandCode,
      brandCurrencyLogValue(before),
      brandCurrencyLogValue({
        countryCode: before.countryCode,
        currencyCode: before.currencyCode,
        isEnabled,
      }),
      context,
    );

    await tx.commit();
  } catch (e) {
    if (!(e instanceof BrandCurrencyError)) await tx.rollback();
    throw e;
  }
}

/**
 * Remove one configured currency.
 *
 * **A hard delete**, unlike `UatTester` or `AccApprover`, and for a reason those
 * two do not have: the row *is* the configuration, `IsEnabled = 0` already
 * expresses "keep it but do not claim in it", and a soft-deleted row would go on
 * occupying the brand's one slot for that currency under
 * `UQ_BrandCurrency_Brand_Currency` — so re-adding it would be refused as a
 * duplicate of something nobody can see. Nothing is lost either: the log row
 * records the currency, the country it carried and whether it was live, which is
 * why `BrandSettingLog` carries no FK to this table.
 *
 * Requests already submitted keep their own `AccRequest.Currency` and
 * `ExchangeRate`. Nothing here reprices anything.
 */
export async function removeBrandCurrency(
  id: number,
  context: BrandCurrencyContext,
): Promise<void> {
  const pool = await getProductionFormPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const cur = await tx
      .request()
      .input("id", sql.Int, id)
      .query(`
        SELECT Id, BrandCode, CountryCode, CurrencyCode, IsEnabled
        FROM [dbo].[BrandCurrency] WITH (UPDLOCK, HOLDLOCK)
        WHERE Id = @id
      `);
    const row = cur.recordset[0] as BrandCurrencyRow | undefined;
    if (!row) {
      await tx.rollback();
      throw new BrandCurrencyError("ไม่พบสกุลเงินนี้แล้ว — อาจถูกลบไปก่อนหน้านี้");
    }

    await tx.request().input("id", sql.Int, id).query(`
      DELETE FROM [dbo].[BrandCurrency] WHERE Id = @id
    `);

    await logBrandCurrency(
      tx,
      row.BrandCode,
      brandCurrencyLogValue({
        countryCode: (row.CountryCode ?? "").trim().toUpperCase() || null,
        currencyCode: (row.CurrencyCode ?? "").trim().toUpperCase(),
        isEnabled: !!row.IsEnabled,
      }),
      null,
      context,
    );

    await tx.commit();
  } catch (e) {
    if (!(e instanceof BrandCurrencyError)) await tx.rollback();
    throw e;
  }
}
