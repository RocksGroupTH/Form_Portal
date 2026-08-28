/**
 * Parsing and validating the three writes AP-1's and AP-17's แบรนด์ที่เบิกได้ tab
 * makes against `BrandCurrency` — add a currency, switch one on or off, remove
 * one.
 *
 * Imports only `./country-currency`, which itself imports nothing, so this is
 * still unit-tested without a database — anything reachable from a pool drags
 * `@/env` in, which validates the whole environment at import time and throws in
 * the test runner. It is also imported by the settings panel, which is a client
 * component: a module whose whole import graph is data cannot drag
 * `next/headers` into the browser bundle, the way `api-keys/codes.ts` records.
 *
 * Two jobs, both of which have to be right for the audit trail to mean anything:
 *
 * - **the parse refuses rather than coerces.** `CountryCode` is `CHAR(2)` and
 *   `CurrencyCode` is `CHAR(3)`; SQL Server pads a short value with spaces and
 *   raises on a long one, so a body carrying `"Malaysia"` must be a 400 here and
 *   never a truncated row there.
 * - **the log value describes the row, not the save.** One `BrandSettingLog` row
 *   per write, holding what the currency row was and what it became, so "when
 *   was this brand's currencies last changed, and by whom" is one indexed query.
 *
 * **Duplicates are not checked here.** `UQ_BrandCurrency_Brand_Currency` is the
 * rule (migration 127) and the handler translates its violation; a check in this
 * module would be a second, weaker answer that two admins on two tabs defeat.
 */
import { isKnownCountry } from "./country-currency";

/** What an add posts: which brand, which currency, and the country it came from. */
export interface BrandCurrencyAdd {
  brandCode: string;
  /** ISO-3166-1 alpha-2, upper case, or null. */
  countryCode: string | null;
  /** ISO-4217, upper case. Required — adding a row names a currency. */
  currencyCode: string;
}

export type BrandCurrencyAddParse =
  | { ok: true; value: BrandCurrencyAdd }
  | { ok: false; error: string };

export type BrandCurrencyToggleParse =
  | { ok: true; id: number; isEnabled: boolean }
  | { ok: false; error: string };

export type BrandCurrencyIdParse =
  | { ok: true; id: number }
  | { ok: false; error: string };

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
 * An add body turned into a value, or the Thai message to answer 400 with.
 *
 * Returns a result rather than throwing so the route can tell a bad body (400)
 * from a failed write (500) without inspecting an error message.
 *
 * **An unknown country is refused rather than stored.** The configured list
 * renders each row as `countryLabel(countryCode)`, which is null for a code
 * `COUNTRIES` does not carry — so an accepted-but-unknown code would show as a
 * row with no country at all, indistinguishable from one that never had one.
 * The currency is not required to be the country's own: a brand registered in
 * one country may genuinely settle in another's money, and the picker fills the
 * currency in from the country anyway.
 */
export function parseBrandCurrencyAdd(body: unknown): BrandCurrencyAddParse {
  const b = (body ?? {}) as Record<string, unknown>;

  const brandCode = typeof b.brandCode === "string" ? b.brandCode.trim() : "";
  if (!brandCode) return { ok: false, error: "กรุณาระบุแบรนด์" };
  if (brandCode.length > 40) return { ok: false, error: "รหัสแบรนด์ยาวเกินไป" };

  const country = normalizeCode(b.countryCode, 2);
  if (country === "invalid") {
    return { ok: false, error: "รหัสประเทศต้องเป็นตัวอักษร 2 หลักตามมาตรฐาน ISO-3166-1 (เช่น TH, GB)" };
  }
  if (country !== null && !isKnownCountry(country)) {
    return { ok: false, error: `ไม่รู้จักประเทศ ${country} — กรุณาเลือกจากรายการ` };
  }

  const currency = normalizeCode(b.currencyCode, 3);
  if (currency === "invalid") {
    return { ok: false, error: "รหัสสกุลเงินต้องเป็นตัวอักษร 3 หลักตามมาตรฐาน ISO-4217 (เช่น THB, GBP)" };
  }
  if (currency === null) return { ok: false, error: "กรุณาเลือกสกุลเงิน" };

  return { ok: true, value: { brandCode, countryCode: country, currencyCode: currency } };
}

/** `BrandCurrency.Id` out of a body or a query string, or the Thai 400. */
function parseId(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : Number.NaN;
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export function parseBrandCurrencyToggle(body: unknown): BrandCurrencyToggleParse {
  const b = (body ?? {}) as Record<string, unknown>;
  const id = parseId(b.id);
  if (id === null) return { ok: false, error: "ไม่พบรายการสกุลเงินที่ต้องการแก้ไข" };
  if (typeof b.isEnabled !== "boolean") {
    return { ok: false, error: "ค่าเปิดใช้สกุลเงินไม่ถูกต้อง" };
  }
  return { ok: true, id, isEnabled: b.isEnabled };
}

export function parseBrandCurrencyId(raw: unknown): BrandCurrencyIdParse {
  const id = parseId(raw);
  if (id === null) return { ok: false, error: "ไม่พบรายการสกุลเงินที่ต้องการลบ" };
  return { ok: true, id };
}

/**
 * How one `BrandCurrency` row is written into `BrandSettingLog`'s `OldValue` /
 * `NewValue`.
 *
 * `MYR (MY) 1` — the currency, the country it was configured from, and whether
 * it was on. All three, because the log has to answer what the row *was* and
 * not merely that something changed: an entry reading only `MYR` cannot tell a
 * currency being switched off from one being removed outright.
 *
 * `-` for an absent country rather than a blank, so the shape is fixed and a
 * value is never mistaken for a truncation. Fits `nvarchar(100)` with room to
 * spare.
 */
export function brandCurrencyLogValue(row: {
  countryCode: string | null;
  currencyCode: string;
  isEnabled: boolean;
}): string {
  const country = (row.countryCode ?? "").trim().toUpperCase() || "-";
  return `${row.currencyCode.trim().toUpperCase()} (${country}) ${row.isEnabled ? "1" : "0"}`;
}

/** The single `BrandSettingLog.Field` value every `BrandCurrency` write uses. */
export const BRAND_CURRENCY_LOG_FIELD = "BrandCurrency";

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

