/**
 * Parsing, validating and diffing one brand's country/currency settings.
 *
 * Imports nothing, so it is unit-tested without a database — anything reachable
 * from a pool drags `@/env` in, which validates the whole environment at import
 * time and throws in the test runner. It is also imported by the settings panel,
 * which is a client component: a module with no imports cannot drag
 * `next/headers` into the browser bundle, the way `api-keys/codes.ts` records.
 *
 * Two jobs, both of which have to be right for the audit trail to mean anything:
 *
 * - **the parse refuses rather than coerces.** `CountryCode` is `CHAR(2)` and
 *   `CurrencyCode` is `CHAR(3)`; SQL Server pads a short value with spaces and
 *   raises on a long one, so a body carrying `"Malaysia"` must be a 400 here and
 *   never a truncated row there.
 * - **the diff decides what gets logged.** One `BrandSettingLog` row per changed
 *   field, so "when was this brand's currency last changed, and by whom" is one
 *   indexed query rather than a scan over saves that changed nothing.
 */

/** One brand's currency configuration, normalised. */
export interface BrandCurrencyPatch {
  /** ISO-3166-1 alpha-2, upper case, or null. */
  countryCode: string | null;
  /** ISO-4217, upper case, or null. Null and "THB" both mean baht. */
  currencyCode: string | null;
  /**
   * Whether a claim against this brand may be entered in `currencyCode`.
   *
   * Setting a currency does **not** switch it on: `brandCurrencyState` in
   * `./currency` requires both halves, and this is the half an admin has to
   * take deliberately.
   */
  currencyEnabled: boolean;
}

export type BrandCurrencyParse =
  | { ok: true; brandCode: string; patch: BrandCurrencyPatch }
  | { ok: false; error: string };

/** The three `BrandSetting` columns this feature writes, spelled as the table spells them. */
export type BrandCurrencyField = "CountryCode" | "CurrencyCode" | "CurrencyEnabled";

export interface BrandCurrencyChange {
  field: BrandCurrencyField;
  oldValue: string | null;
  newValue: string | null;
}

/** Blank, whitespace and the two JSON empties all mean "not set". */
function normalizeCode(raw: unknown, length: number): string | null | "invalid" {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return "invalid";
  const v = raw.trim().toUpperCase();
  if (v === "") return null;
  if (v.length !== length) return "invalid";
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c < 65 || c > 90) return "invalid";
  }
  return v;
}

/**
 * A request body turned into a patch, or the Thai message to answer 400 with.
 *
 * Returns a result rather than throwing so the route can tell a bad body (400)
 * from a failed write (500) without inspecting an error message.
 */
export function parseBrandCurrencyBody(body: unknown): BrandCurrencyParse {
  const b = (body ?? {}) as Record<string, unknown>;

  const brandCode = typeof b.brandCode === "string" ? b.brandCode.trim() : "";
  if (!brandCode) return { ok: false, error: "กรุณาระบุแบรนด์" };
  if (brandCode.length > 40) return { ok: false, error: "รหัสแบรนด์ยาวเกินไป" };

  const country = normalizeCode(b.countryCode, 2);
  if (country === "invalid") {
    return { ok: false, error: "รหัสประเทศต้องเป็นตัวอักษร 2 หลักตามมาตรฐาน ISO-3166-1 (เช่น TH, MY)" };
  }

  const currency = normalizeCode(b.currencyCode, 3);
  if (currency === "invalid") {
    return { ok: false, error: "รหัสสกุลเงินต้องเป็นตัวอักษร 3 หลักตามมาตรฐาน ISO-4217 (เช่น THB, MYR)" };
  }

  const rawEnabled = b.currencyEnabled;
  if (typeof rawEnabled !== "boolean" && rawEnabled !== undefined && rawEnabled !== null) {
    return { ok: false, error: "ค่าเปิดใช้สกุลเงินไม่ถูกต้อง" };
  }
  const currencyEnabled = rawEnabled === true;

  // Refused here rather than left to the form: the flag without a code names
  // nothing, and a row in that state reads as configured to anyone querying the
  // table by hand even though `brandCurrencyState` calls it "none".
  if (currencyEnabled && currency === null) {
    return { ok: false, error: "เลือกสกุลเงินก่อนจึงจะเปิดใช้งานได้" };
  }

  return { ok: true, brandCode, patch: { countryCode: country, currencyCode: currency, currencyEnabled } };
}

/** How a BIT is written into the log's nvarchar column — as the column stores it. */
function bit(on: boolean): string {
  return on ? "1" : "0";
}

/**
 * The fields that actually changed, in column order.
 *
 * An empty array means the save is a no-op and writes neither the row nor a log
 * entry: a log that records saves rather than changes cannot answer "when did
 * this last change".
 */
export function brandCurrencyChanges(
  before: BrandCurrencyPatch,
  after: BrandCurrencyPatch,
): BrandCurrencyChange[] {
  const out: BrandCurrencyChange[] = [];
  if (before.countryCode !== after.countryCode) {
    out.push({ field: "CountryCode", oldValue: before.countryCode, newValue: after.countryCode });
  }
  if (before.currencyCode !== after.currencyCode) {
    out.push({ field: "CurrencyCode", oldValue: before.currencyCode, newValue: after.currencyCode });
  }
  if (before.currencyEnabled !== after.currencyEnabled) {
    out.push({
      field: "CurrencyEnabled",
      oldValue: bit(before.currencyEnabled),
      newValue: bit(after.currencyEnabled),
    });
  }
  return out;
}

/**
 * The currency list to offer when the FX source cannot be reached.
 *
 * These are the ISO-4217 codes `bot-fx.ts`'s keyless ECB fallback actually
 * quotes, plus THB itself. Offering a currency no rate can be had for is a trap:
 * a foreign claim in it fails closed at submit (spec §5), and the admin who
 * picked it would have no way to know why.
 */
export const FALLBACK_CURRENCIES: readonly { code: string; name: string }[] = [
  { code: "AUD", name: "Australian Dollar" },
  { code: "CAD", name: "Canadian Dollar" },
  { code: "CHF", name: "Swiss Franc" },
  { code: "CNY", name: "Chinese Renminbi Yuan" },
  { code: "DKK", name: "Danish Krone" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British Pound" },
  { code: "HKD", name: "Hong Kong Dollar" },
  { code: "IDR", name: "Indonesian Rupiah" },
  { code: "INR", name: "Indian Rupee" },
  { code: "JPY", name: "Japanese Yen" },
  { code: "KRW", name: "South Korean Won" },
  { code: "MYR", name: "Malaysian Ringgit" },
  { code: "NZD", name: "New Zealand Dollar" },
  { code: "PHP", name: "Philippine Peso" },
  { code: "SEK", name: "Swedish Krona" },
  { code: "SGD", name: "Singapore Dollar" },
  { code: "THB", name: "Thai Baht" },
  { code: "USD", name: "United States Dollar" },
  { code: "ZAR", name: "South African Rand" },
];

/**
 * Suggestions for the country box — **not** a closed list.
 *
 * Nothing in this repository has a country concept: no master table, no
 * registry, and nothing reads `CountryCode` yet. So the column is edited as what
 * it is — a two-letter ISO-3166-1 alpha-2 code — with these offered through a
 * `datalist` rather than a select, and any other valid pair of letters accepted.
 * A curated dropdown would be a country master invented as a side effect of a
 * currency feature, and the first brand outside it would need a code change.
 */
export const COMMON_COUNTRY_CODES: readonly string[] = [
  "AE", "AU", "CA", "CH", "CN", "DE", "DK", "FR", "GB", "HK",
  "ID", "IN", "JP", "KH", "KR", "LA", "MM", "MY", "NZ", "PH",
  "SE", "SG", "TH", "TW", "US", "VN", "ZA",
];
