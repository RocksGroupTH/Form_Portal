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
import {
  bahtEnabled,
  enabledClaimCurrencies,
  enabledForeignCurrencies,
  type BrandCurrencyEntry,
} from "@/lib/acc/currency";
import {
  brandCurrencyDefaultLogValue,
  brandCurrencyLogValue,
  BRAND_CURRENCY_DEFAULT_LOG_FIELD,
  BRAND_CURRENCY_LOG_FIELD,
  LAST_CLAIM_CURRENCY_ERROR,
  type BrandCurrencyAdd,
} from "@/lib/acc/brand-currency-input";

/**
 * A brand-currency write refused for a reason worth showing the person who made
 * it — an unknown brand code, a currency the brand already carries, or a change
 * that would leave the brand claimable in nothing.
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
 * The refusal when a row named by id is not on the table.
 *
 * **It does not say "somebody deleted it", because nothing in this application
 * can.** A configured currency is never removed — `IsEnabled = 0` is the
 * retired state and the row stays — so the only ways to reach this are a direct
 * SQL edit and a stale screen, and both are answered by reloading. A message
 * naming a deletion would send the reader looking for an act that did not
 * happen.
 */
const MISSING_CURRENCY_ERROR = "ไม่พบสกุลเงินนี้แล้ว — กรุณารีเฟรชหน้าจอแล้วลองใหม่";

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
  IsDefault: boolean;
}

/**
 * `CHAR(2)`/`CHAR(3)` come back space-padded, so every consumer would otherwise
 * compare `"MYR"` against `"MYR "` — trimmed once, here, where the column shape
 * is known. Used by the list read and by every write's own locked re-read, so
 * the two can never disagree about what a row says.
 */
function toEntry(r: BrandCurrencyRow): BrandCurrencyEntry {
  return {
    id: r.Id,
    countryCode: (r.CountryCode ?? "").trim().toUpperCase() || null,
    currencyCode: (r.CurrencyCode ?? "").trim().toUpperCase(),
    isEnabled: !!r.IsEnabled,
    isDefault: !!r.IsDefault,
  };
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
      SELECT Id, BrandCode, CountryCode, CurrencyCode, IsEnabled, IsDefault
      FROM [dbo].[BrandCurrency]
      ORDER BY BrandCode, SortOrder, Id
    `),
  ]);

  const settings = new Map<string, BrandSettingRow>();
  for (const r of settingRes.recordset as BrandSettingRow[]) {
    settings.set(r.BrandCode, r);
  }

  const currencies = new Map<string, BrandCurrencyEntry[]>();
  for (const r of currencyRes.recordset as BrandCurrencyRow[]) {
    const list = currencies.get(r.BrandCode) ?? [];
    list.push(toEntry(r));
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
 * them: add a currency, switch one on or off, and make one the brand's default.
 *
 * **There is no fourth. A configured currency cannot be removed** — the user's
 * rule, 2026-08-29 — so `IsEnabled` is the whole lifecycle: switching a row off
 * retires it, switching it back on restores it, and the row itself stays for
 * good. That is why the enable flag was never merely a convenience, and why
 * there is no soft-delete column to go with it: two states, not three, so no
 * read anywhere has to decide which of "off" and "gone" it is looking at.
 *
 * The slot a retired row keeps under `UQ_BrandCurrency_Brand_Currency` is the
 * point rather than the cost. Re-adding a currency the brand already carries is
 * refused, and the refusal names the row that is already there — which is the
 * row to switch back on.
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
 * mark it — so a call that reaches the database is a change, and one that
 * finds nothing to change refuses or returns rather than logging a save.
 */
export interface BrandCurrencyContext {
  /** Which form's tab the change was made from — `AP-1` or `AP-17`. */
  formCode: string;
  userId: number;
}

/**
 * The audit row, on the same connection and inside the same transaction.
 *
 * `field` distinguishes the two things that get logged here: a currency row
 * changing (`BrandCurrency`) and the brand's default moving
 * (`BrandCurrencyDefault`). One write can produce both — disabling the default
 * currency changes that row *and* moves the default — and they are two separate
 * facts, so they are two rows rather than one composite value nobody can query.
 */
async function logBrandCurrency(
  tx: sql.Transaction,
  brandCode: string,
  field: string,
  oldValue: string | null,
  newValue: string | null,
  context: BrandCurrencyContext,
): Promise<void> {
  await tx
    .request()
    .input("code", sql.NVarChar(40), brandCode)
    .input("field", sql.NVarChar(40), field)
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
 * Every row of one brand, locked for the rest of the transaction, in the order
 * `listBrandRegistry` returns them.
 *
 * **The whole brand, not the one row being changed**, because every rule here
 * is about the set: whether anything is left to claim in, and which row is the
 * default. `UPDLOCK, HOLDLOCK` over that range is also what serialises two
 * admins editing the same brand from AP-1's tab and AP-17's at once — without
 * it, both could read "MYR is still enabled" and each disable a different last
 * currency.
 */
async function lockBrandRows(
  tx: sql.Transaction,
  brandCode: string,
): Promise<BrandCurrencyEntry[]> {
  const res = await tx
    .request()
    .input("code", sql.NVarChar(40), brandCode)
    .query(`
      SELECT Id, BrandCode, CountryCode, CurrencyCode, IsEnabled, IsDefault
      FROM [dbo].[BrandCurrency] WITH (UPDLOCK, HOLDLOCK)
      WHERE BrandCode = @code
      ORDER BY SortOrder, Id
    `);
  return (res.recordset as BrandCurrencyRow[]).map(toEntry);
}

/** The brand a row belongs to, locked, or null if no such row is on the table. */
async function lockBrandCodeOf(tx: sql.Transaction, id: number): Promise<string | null> {
  const res = await tx
    .request()
    .input("id", sql.Int, id)
    .query(`
      SELECT BrandCode FROM [dbo].[BrandCurrency] WITH (UPDLOCK, HOLDLOCK) WHERE Id = @id
    `);
  const row = res.recordset[0] as { BrandCode: string } | undefined;
  return row ? row.BrandCode : null;
}

/**
 * Refuse a change that would leave the brand with nothing to claim in.
 *
 * Applied to the **simulated** result rather than to what is on the table, so
 * the refusal happens before the write instead of being noticed after it. See
 * `LAST_CLAIM_CURRENCY_ERROR` for why this is a refusal and not a warning.
 */
function assertStillClaimable(next: readonly BrandCurrencyEntry[]): void {
  if (enabledClaimCurrencies(next).length === 0) {
    throw new BrandCurrencyError(LAST_CLAIM_CURRENCY_ERROR);
  }
}

/** The row currently marked as the brand's default, enabled or not. */
function markedRow(rows: readonly BrandCurrencyEntry[]): BrandCurrencyEntry | null {
  for (let i = 0; i < rows.length; i++) if (rows[i].isDefault) return rows[i];
  return null;
}

/**
 * Put the brand's default back in step with what is now enabled, and log the
 * move if it moved.
 *
 * Called after **every** write, with `rows` describing the brand as it now is
 * and `previous` naming whatever carried the flag before. It is passed in
 * rather than looked for because `rows` is mutated in place by the caller and
 * again here: by the time this runs, the flag may already have moved, and the
 * log needs the value it moved *from*.
 *
 * Two rules, in this order:
 *
 * 1. **A default that is no longer enabled loses the flag.** Disabling the row
 *    the form opens on must move the default, not leave it pointing at a
 *    country the picker will not offer. `defaultCurrencyRow` ignores such a row
 *    on read as well, so a flag that outlives this by way of a direct SQL edit
 *    still cannot mislead a requester — this is what keeps the *stored* state
 *    honest, so the settings page shows what is actually in force.
 * 2. **With baht switched off, something has to be marked.** Rule 2 of
 *    `defaultClaimCountry` — "Thailand, whenever it is still offered" — is what
 *    lets a default be optional, and it is gone the moment a brand stops
 *    claiming in baht. The first enabled row takes it, which is the same row
 *    that function would have fallen through to anyway; writing it down makes
 *    the choice visible on the settings page instead of implicit in a sort
 *    order.
 *
 * With baht still on, nothing is marked in its place: no flag *is* Thailand,
 * and inventing a marker for the state every brand has been in since migration
 * 127 would make the log unreadable.
 */
async function reconcileDefault(
  tx: sql.Transaction,
  brandCode: string,
  rows: BrandCurrencyEntry[],
  previous: BrandCurrencyEntry | null,
  context: BrandCurrencyContext,
): Promise<void> {
  let cleared = false;
  for (const r of rows) {
    if (r.isDefault && !r.isEnabled) {
      r.isDefault = false;
      cleared = true;
    }
  }
  if (cleared) {
    await tx
      .request()
      .input("code", sql.NVarChar(40), brandCode)
      .query(`
        UPDATE [dbo].[BrandCurrency]
        SET IsDefault = 0, UpdatedAt = SYSDATETIME()
        WHERE BrandCode = @code AND IsDefault = 1 AND IsEnabled = 0
      `);
  }

  let marked: BrandCurrencyEntry | null = null;
  for (const r of rows) if (r.isDefault && r.isEnabled) { marked = r; break; }

  if (!marked && !bahtEnabled(rows)) {
    for (const r of rows) if (r.isEnabled) { marked = r; break; }
    if (marked) {
      marked.isDefault = true;
      await tx
        .request()
        .input("id", sql.Int, marked.id)
        .query(`
          UPDATE [dbo].[BrandCurrency]
          SET IsDefault = 1, UpdatedAt = SYSDATETIME()
          WHERE Id = @id
        `);
    }
  }

  const was = brandCurrencyDefaultLogValue(previous);
  const now = brandCurrencyDefaultLogValue(marked);
  if (was !== now) {
    await logBrandCurrency(tx, brandCode, BRAND_CURRENCY_DEFAULT_LOG_FIELD, was, now, context);
  }
}

/**
 * Add one currency to a brand. New rows arrive **enabled and not the default**
 * unless the caller says otherwise — the table's own defaults — because adding
 * one is a deliberate act naming a currency, unlike
 * `BrandSetting.CurrencyEnabled`, which sat on every brand whether anybody had
 * configured it or not.
 *
 * **The two exceptions are both about Thailand**, which has no row until
 * somebody makes one. Switching baht off, and marking baht as the default, each
 * have to create that row in the state they want in a single write — see
 * `BrandCurrencyAdd.isEnabled`.
 *
 * **Duplicates are refused by `UQ_BrandCurrency_Brand_Currency`**, not by a
 * read-then-write here. A check made first is a rule two admins on two tabs
 * defeat, and one replayed request defeats on its own; the constraint cannot be.
 * All this does is turn its violation into a sentence somebody can act on.
 *
 * **A retired row is one of the things that violation now means**, and the
 * message says so. Currencies are never deleted, so a brand that once carried
 * `GBP` still carries it, disabled — and the answer is to switch that row back
 * on, not to add a second one the index would refuse anyway. The panel greys
 * out every configured code, live or retired, so this is the rare path rather
 * than the usual one.
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
    const before = await lockBrandRows(tx, add.brandCode);
    const previous = markedRow(before);

    // What the brand looks like once this row exists. The guard runs against
    // that rather than against the table, so a disabled THB row that would
    // leave nothing claimable is refused before it is written.
    const after = before.concat([
      {
        id: 0,
        countryCode: add.countryCode,
        currencyCode: add.currencyCode,
        isEnabled: add.isEnabled,
        isDefault: add.isDefault,
      },
    ]);
    assertStillClaimable(after);

    const ins = await tx
      .request()
      .input("code", sql.NVarChar(40), add.brandCode)
      .input("country", sql.Char(2), add.countryCode)
      .input("currency", sql.Char(3), add.currencyCode)
      .input("enabled", sql.Bit, add.isEnabled)
      .query(`
        INSERT INTO [dbo].[BrandCurrency]
          (BrandCode, CountryCode, CurrencyCode, IsEnabled, SortOrder)
        OUTPUT INSERTED.Id
        SELECT @code, @country, @currency, @enabled,
               ISNULL((SELECT MAX(SortOrder) + 1 FROM [dbo].[BrandCurrency] WHERE BrandCode = @code), 0)
      `);
    const newId = Number((ins.recordset[0] as { Id: number }).Id);
    after[after.length - 1].id = newId;

    await logBrandCurrency(
      tx,
      add.brandCode,
      BRAND_CURRENCY_LOG_FIELD,
      null,
      brandCurrencyLogValue({
        countryCode: add.countryCode,
        currencyCode: add.currencyCode,
        isEnabled: add.isEnabled,
      }),
      context,
    );

    if (add.isDefault) {
      // Cleared first: `UQ_BrandCurrency_Brand_Default` refuses two, and the
      // index is the rule rather than this ordering — which is what makes the
      // ordering checkable instead of merely believed.
      await tx
        .request()
        .input("code", sql.NVarChar(40), add.brandCode)
        .query(`
          UPDATE [dbo].[BrandCurrency]
          SET IsDefault = 0, UpdatedAt = SYSDATETIME()
          WHERE BrandCode = @code AND IsDefault = 1
        `);
      for (const r of after) r.isDefault = false;
      await tx
        .request()
        .input("id", sql.Int, newId)
        .query(`
          UPDATE [dbo].[BrandCurrency]
          SET IsDefault = 1, UpdatedAt = SYSDATETIME()
          WHERE Id = @id
        `);
      after[after.length - 1].isDefault = true;
    }

    // Adding a disabled THB row switches baht off, which can strand the
    // default on Thailand — nothing having been marked. This is what moves it.
    await reconcileDefault(tx, add.brandCode, after, previous, context);

    await tx.commit();
  } catch (e) {
    await tx.rollback();
    if (isUniqueViolation(e)) {
      throw new BrandCurrencyError(
        `แบรนด์ ${add.brandCode} มีสกุลเงิน ${add.currencyCode} อยู่แล้ว — ` +
          "หากรายการเดิมปิดใช้งานอยู่ ให้เปิดใช้งานรายการนั้นแทนการเพิ่มใหม่",
      );
    }
    throw e;
  }
}

/**
 * Switch one configured currency on or off.
 *
 * **This is the whole lifecycle.** Off is as far as a currency goes: the row
 * stays, the forms stop offering it, and switching it back on restores it
 * exactly as it was, default flag apart — `reconcileDefault` will have moved
 * that, because a default the picker does not offer is the one state this
 * feature exists to prevent.
 *
 * The brand's rows are read under `UPDLOCK, HOLDLOCK` first because the log
 * needs what the row *was*, and a value read outside the lock could be stale by
 * the time the update lands — an audit trail stating a transition that never
 * happened is worse than no audit trail. A row already in the requested state
 * writes nothing and logs nothing: a log recording *saves* rather than *changes*
 * cannot answer "when did this last change", which is the only question it
 * exists for.
 *
 * **Two rules apply to the whole brand rather than to this row**, which is why
 * every row is read and not just this one: the change is refused if it would
 * leave nothing to claim in, and the default moves if this was it.
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
    const brandCode = await lockBrandCodeOf(tx, id);
    if (!brandCode) {
      throw new BrandCurrencyError(MISSING_CURRENCY_ERROR);
    }
    const rows = await lockBrandRows(tx, brandCode);
    const row = rows.find((r) => r.id === id) ?? null;
    if (!row) {
      throw new BrandCurrencyError(MISSING_CURRENCY_ERROR);
    }

    const before = { ...row };
    // Read before anything is mutated. Only `isEnabled` changes below, so the
    // marked row is the same either way — computing it up front makes that true
    // by construction rather than by inspection.
    const previous = markedRow(rows);
    if (before.isEnabled === isEnabled) {
      await tx.commit();
      return;
    }

    row.isEnabled = isEnabled;
    assertStillClaimable(rows);

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
      brandCode,
      BRAND_CURRENCY_LOG_FIELD,
      brandCurrencyLogValue(before),
      brandCurrencyLogValue({
        countryCode: before.countryCode,
        currencyCode: before.currencyCode,
        isEnabled,
      }),
      context,
    );

    await reconcileDefault(tx, brandCode, rows, previous, context);

    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

/**
 * Make one configured currency the brand's default — the country AP-1's form
 * opens on.
 *
 * **Only an enabled row may be it.** The alternative is a default the picker
 * does not offer, which is the dangling pointer this whole flag exists to
 * remove. Clearing the old one and setting the new one happen in one
 * transaction, and `UQ_BrandCurrency_Brand_Default` refuses a second live flag
 * whatever this code does.
 *
 * A row that is already the default writes nothing and logs nothing, for the
 * reason the enable toggle gives.
 */
export async function setBrandCurrencyDefault(
  id: number,
  context: BrandCurrencyContext,
): Promise<void> {
  const pool = await getProductionFormPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const brandCode = await lockBrandCodeOf(tx, id);
    if (!brandCode) {
      throw new BrandCurrencyError(MISSING_CURRENCY_ERROR);
    }
    const rows = await lockBrandRows(tx, brandCode);
    const row = rows.find((r) => r.id === id) ?? null;
    if (!row) {
      throw new BrandCurrencyError(MISSING_CURRENCY_ERROR);
    }
    if (!row.isEnabled) {
      throw new BrandCurrencyError(
        `กรุณาเปิดใช้งาน ${row.currencyCode} ก่อนตั้งเป็นค่าเริ่มต้น`,
      );
    }
    if (row.isDefault) {
      await tx.commit();
      return;
    }

    const previous = markedRow(rows);

    await tx
      .request()
      .input("code", sql.NVarChar(40), brandCode)
      .query(`
        UPDATE [dbo].[BrandCurrency]
        SET IsDefault = 0, UpdatedAt = SYSDATETIME()
        WHERE BrandCode = @code AND IsDefault = 1
      `);
    await tx
      .request()
      .input("id", sql.Int, id)
      .query(`
        UPDATE [dbo].[BrandCurrency]
        SET IsDefault = 1, UpdatedAt = SYSDATETIME()
        WHERE Id = @id
      `);

    for (const r of rows) r.isDefault = r.id === id;

    await logBrandCurrency(
      tx,
      brandCode,
      BRAND_CURRENCY_DEFAULT_LOG_FIELD,
      brandCurrencyDefaultLogValue(previous),
      brandCurrencyDefaultLogValue(row),
      context,
    );

    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}
