/**
 * Parsing and validating the three writes AP-1's and AP-17's แบรนด์ที่เบิกได้ tab
 * makes against `BrandCurrency` — add a currency, switch one on or off, and make
 * one the brand's default.
 *
 * **There is no fourth: a configured currency cannot be removed** (the user's
 * rule, 2026-08-29). Switching a row off retires it and switching it back on
 * restores it, so the retired row goes on holding the brand's one slot for that
 * currency under `UQ_BrandCurrency_Brand_Currency` — which is what a re-add
 * collides with, and what the collision's message points at.
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
import { isKnownCountry, isRateSourceCurrency } from "./country-currency";

/** What an add posts: which brand, which currency, and the country it came from. */
export interface BrandCurrencyAdd {
  brandCode: string;
  /** ISO-3166-1 alpha-2, upper case, or null. */
  countryCode: string | null;
  /** ISO-4217, upper case. Required — adding a row names a currency. */
  currencyCode: string;
  /**
   * Whether the new row is live. Defaults to **true** — adding a currency is a
   * deliberate act naming one, which is why `BrandCurrency.IsEnabled` defaults
   * to 1 as well.
   *
   * `false` exists for exactly one gesture, and it is the reason this field is
   * here at all: **switching Thailand off for a brand that has no `THB` row**.
   * Baht is claimable while no row says otherwise (`bahtEnabled`), so turning
   * it off means creating the row already disabled. Doing that as an add
   * followed by a toggle would be two requests, and the brand would be
   * momentarily claimable in a currency the admin had just refused.
   */
  isEnabled: boolean;
  /**
   * Whether the new row becomes the brand's default at the same time.
   *
   * Same argument as `isEnabled`: the settings panel offers Thailand as a
   * default even for a brand with no `THB` row, and choosing it has to create
   * that row *and* mark it in one atomic write rather than leaving a window
   * where the row exists and the default has moved nowhere.
   */
  isDefault: boolean;
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

  // Refused HERE rather than on the requester's form. A currency the reference
  // source will not quote produces a claim that can be started and never
  // converted — `resolveRate` answers null, `toBaht` refuses, and the person is
  // told so only after choosing the country. The admin configuring it is the
  // one who can act on the message, so this is where it belongs. The panel
  // greys such a code out too; this is the rule, that is the courtesy.
  if (!isRateSourceCurrency(currency)) {
    return {
      ok: false,
      error: `ไม่พบ ${currency} ในแหล่งอัตราอ้างอิง — ระบบจะแปลงเป็นเงินบาทให้ไม่ได้ กรุณาเลือกสกุลเงินอื่น`,
    };
  }

  // Absent means live, which is what every add before migration 131 meant.
  const isEnabled = b.isEnabled === undefined || b.isEnabled === null ? true : b.isEnabled === true;
  const isDefault = b.isDefault === true;

  // A disabled default is the dangling pointer this feature exists to remove,
  // so it is refused at the door rather than quietly corrected. Nothing the
  // panel can do produces it — the radio is only offered on a live row — which
  // is exactly why it must be a rule and not a UI habit.
  if (isDefault && !isEnabled) {
    return { ok: false, error: "สกุลเงินที่ปิดใช้งานอยู่ตั้งเป็นค่าเริ่มต้นไม่ได้" };
  }

  return {
    ok: true,
    value: { brandCode, countryCode: country, currencyCode: currency, isEnabled, isDefault },
  };
}

/**
 * The id out of a `{ id, isDefault: true }` PATCH — "make this row the brand's
 * default".
 *
 * **Only `true` is accepted.** There is no "clear the default": a brand always
 * has one, and it is chosen by naming a different row. Accepting `false` would
 * create a state the picker has to invent an answer for, which is exactly the
 * dangling pointer this feature exists to remove.
 */
export function parseBrandCurrencyDefault(body: unknown): BrandCurrencyIdParse {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.isDefault !== true) {
    return { ok: false, error: "ค่าเริ่มต้นของสกุลเงินไม่ถูกต้อง" };
  }
  const id = parseId(b.id);
  if (id === null) return { ok: false, error: "ไม่พบรายการสกุลเงินที่ต้องการตั้งเป็นค่าเริ่มต้น" };
  return { ok: true, id };
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

/**
 * How one `BrandCurrency` row is written into `BrandSettingLog`'s `OldValue` /
 * `NewValue`.
 *
 * `MYR (MY) 1` — the currency, the country it was configured from, and whether
 * it was on. All three, because the log has to answer what the row *was* and
 * not merely that something changed: an entry reading only `MYR` cannot tell an
 * add from a switch.
 *
 * **Entries whose `NewValue` is `NULL` are historical.** They were written by
 * the removal path, which existed between 2026-08-28 and 2026-08-29 and is
 * gone; nothing produces one now. The rows are left exactly as they are — a log
 * that is rewritten when the code changes answers nothing.
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

/** The `BrandSettingLog.Field` value an add or a toggle writes. */
export const BRAND_CURRENCY_LOG_FIELD = "BrandCurrency";

/**
 * The `BrandSettingLog.Field` value a **default** change writes.
 *
 * Its own field rather than a fourth part on `brandCurrencyLogValue`, because
 * the two answer different questions and one of them is asked far more often:
 * "when did this brand's currencies last change" reads `BrandCurrency`, and
 * "why does this form open on Malaysia" reads `BrandCurrencyDefault`. Widening
 * the existing value would also silently change what every row written since
 * 2026-08-28 means.
 */
export const BRAND_CURRENCY_DEFAULT_LOG_FIELD = "BrandCurrencyDefault";

/**
 * How a default change is written into `BrandSettingLog`'s `OldValue` /
 * `NewValue`: `MYR (MY)`, or `-` for none.
 *
 * No enable flag, unlike `brandCurrencyLogValue` — a default is only ever an
 * enabled row, so a third part could carry only one value and would say
 * nothing. `-` covers the honest "nothing was marked", which is where every
 * brand starts and is not the same as Thailand having been chosen.
 */
export function brandCurrencyDefaultLogValue(
  row: { countryCode: string | null; currencyCode: string } | null,
): string {
  if (!row) return "-";
  const country = (row.countryCode ?? "").trim().toUpperCase() || "-";
  return `${row.currencyCode.trim().toUpperCase()} (${country})`;
}

/**
 * The refusal when a change would leave a brand with nothing to claim in.
 *
 * **A brand nobody can file against is a broken configuration, not a valid
 * state**, so this is a refusal rather than a warning: switching off the last
 * enabled currency answers 400 and changes nothing. The alternative —
 * letting it happen and having the forms cope — means every picker downstream
 * needs an answer for "no currencies at all", and each one would invent its
 * own.
 *
 * Note what it is *not*: a rule that Thailand must stay on. A brand may claim
 * in ringgit alone. What it cannot do is claim in nothing.
 */
export const LAST_CLAIM_CURRENCY_ERROR =
  "แบรนด์ต้องมีสกุลเงินที่เปิดใช้งานอย่างน้อยหนึ่งสกุล — กรุณาเปิดใช้งานสกุลเงินอื่นก่อน";

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

