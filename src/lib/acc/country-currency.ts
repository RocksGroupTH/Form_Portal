/**
 * Countries and the currency each one uses, so picking a country fills the
 * currency in rather than asking somebody to know ISO-4217.
 *
 * **Data, not logic**, and deliberately a short list rather than all 249
 * countries: it covers where this business actually operates and the places it
 * plausibly travels to. Adding one is a line here — the tests hold whoever adds
 * it to the shape (two-letter country, three-letter currency, both labels, no
 * duplicate, list stays sorted).
 *
 * A country the list does not know resolves to **null**, never to a guess. The
 * caller then leaves the currency for a person to type, which is the same answer
 * `admitModelCurrency` gives for a currency it cannot trust.
 *
 * Import-free, so it is unit-tested without a database and safe in a client
 * component.
 */

/**
 * The currencies the reference-rate source will actually quote.
 *
 * Measured 2026-08-29 from `GET https://api.frankfurter.dev/v1/currencies` — the
 * ECB's own list, which is what `bot-fx.ts` falls back to while
 * `BOT_API_CLIENT_ID` is unprovisioned. Refresh it by running that call again.
 *
 * **This is why the country list is filtered rather than complete.** The list
 * below once carried Cambodia, Laos, Vietnam, Myanmar, Taiwan, Brunei, Qatar,
 * Bahrain, Russia and the UAE — ten countries the ECB does not quote, several of
 * them next door. Offering one produced a claim that could be started and never
 * converted: `resolveRate` returns null, `toBaht` refuses, and the person is
 * told "ไม่พบ KHR ในแหล่งอัตราอ้างอิง" only after choosing. A country that cannot
 * be converted must not be on the menu.
 *
 * A currency here is **quotable, not necessarily right**: these are ECB
 * mid-market reference rates, not what a bank settles at, which is why
 * accounting can correct the rate at the ACCOUNT step.
 */
const RATE_SOURCE_CURRENCIES = [
  "AUD", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP", "HKD",
  "HUF", "IDR", "ILS", "INR", "ISK", "JPY", "KRW", "MXN", "MYR", "NOK",
  "NZD", "PHP", "PLN", "RON", "SEK", "SGD", "THB", "TRY", "USD", "ZAR",
];

export interface CountryCurrency {
  /** ISO-3166-1 alpha-2. */
  code: string;
  /** ISO-4217. Several countries may share one (EUR). */
  currency: string;
  nameTh: string;
  nameEn: string;
}

/** Sorted by Thai name, so a picker can render it as-is. */
export const COUNTRIES: readonly CountryCurrency[] = [
  { code: "KR", currency: "KRW", nameTh: "เกาหลีใต้", nameEn: "South Korea" },
  { code: "CN", currency: "CNY", nameTh: "จีน", nameEn: "China" },
  { code: "CZ", currency: "CZK", nameTh: "เช็กเกีย", nameEn: "Czechia" },
  { code: "JP", currency: "JPY", nameTh: "ญี่ปุ่น", nameEn: "Japan" },
  { code: "DK", currency: "DKK", nameTh: "เดนมาร์ก", nameEn: "Denmark" },
  { code: "TR", currency: "TRY", nameTh: "ตุรกี", nameEn: "Türkiye" },
  { code: "TH", currency: "THB", nameTh: "ไทย", nameEn: "Thailand" },
  { code: "NO", currency: "NOK", nameTh: "นอร์เวย์", nameEn: "Norway" },
  { code: "NZ", currency: "NZD", nameTh: "นิวซีแลนด์", nameEn: "New Zealand" },
  { code: "NL", currency: "EUR", nameTh: "เนเธอร์แลนด์", nameEn: "Netherlands" },
  { code: "FR", currency: "EUR", nameTh: "ฝรั่งเศส", nameEn: "France" },
  { code: "PH", currency: "PHP", nameTh: "ฟิลิปปินส์", nameEn: "Philippines" },
  { code: "MY", currency: "MYR", nameTh: "มาเลเซีย", nameEn: "Malaysia" },
  { code: "DE", currency: "EUR", nameTh: "เยอรมนี", nameEn: "Germany" },
  { code: "ES", currency: "EUR", nameTh: "สเปน", nameEn: "Spain" },
  { code: "CH", currency: "CHF", nameTh: "สวิตเซอร์แลนด์", nameEn: "Switzerland" },
  { code: "SE", currency: "SEK", nameTh: "สวีเดน", nameEn: "Sweden" },
  { code: "US", currency: "USD", nameTh: "สหรัฐอเมริกา", nameEn: "United States" },
  { code: "SG", currency: "SGD", nameTh: "สิงคโปร์", nameEn: "Singapore" },
  { code: "AU", currency: "AUD", nameTh: "ออสเตรเลีย", nameEn: "Australia" },
  { code: "GB", currency: "GBP", nameTh: "อังกฤษ", nameEn: "United Kingdom" },
  { code: "IT", currency: "EUR", nameTh: "อิตาลี", nameEn: "Italy" },
  { code: "IN", currency: "INR", nameTh: "อินเดีย", nameEn: "India" },
  { code: "ID", currency: "IDR", nameTh: "อินโดนีเซีย", nameEn: "Indonesia" },
  { code: "HK", currency: "HKD", nameTh: "ฮ่องกง", nameEn: "Hong Kong" },
];

function norm(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase();
}

const BY_CODE = new Map<string, CountryCurrency>();
for (const c of COUNTRIES) BY_CODE.set(c.code, c);

/** The country's currency, or null when the list does not know it. */
export function currencyForCountry(code: string | null | undefined): string | null {
  return BY_CODE.get(norm(code))?.currency ?? null;
}

export function isKnownCountry(code: string | null | undefined): boolean {
  return BY_CODE.has(norm(code));
}

/**
 * `ไทย (THB)` — how the **settings** list reads it.
 *
 * The currency belongs in the label there and only there: that page is where a
 * brand's currencies are configured, so the code beside the country is the very
 * thing being chosen. On the claim form it is noise — the requester is naming
 * where they went, not picking money — and each expense line asks for its own
 * currency a few centimetres below. Use `countryName` there.
 */
export function countryLabel(code: string | null | undefined): string | null {
  const c = BY_CODE.get(norm(code));
  return c ? `${c.nameTh} (${c.currency})` : null;
}

/**
 * `ไทย` — the country's Thai name alone, with no currency suffix.
 *
 * What AP-1's ประเทศ picker shows. It is a **separate function rather than a
 * flag on `countryLabel`**, because the two surfaces want different things
 * permanently: a boolean parameter reads at each call site as a styling choice
 * and gets flipped by whoever preferred the other, where two names cannot be.
 */
export function countryName(code: string | null | undefined): string | null {
  return BY_CODE.get(norm(code))?.nameTh ?? null;
}

/**
 * Whether the reference-rate source will quote this currency at all.
 *
 * Exported so the settings editor can refuse a currency nobody can convert,
 * rather than storing it and letting the requester discover the dead end.
 */
export function isRateSourceCurrency(code: string | null | undefined): boolean {
  const c = norm(code);
  return c !== "" && RATE_SOURCE_CURRENCIES.indexOf(c) !== -1;
}

/**
 * The country's flag as an emoji, or null.
 *
 * **Arithmetic on the two letters, not a lookup and not an image.** Each ASCII
 * letter maps to its regional indicator symbol, and a pair of those is what a
 * flag emoji is — so this needs no asset, no CDN request, and no entry to
 * maintain beside `COUNTRIES`. A code the list has never heard of still gets a
 * flag, which is right: the code is what the claim was filed against.
 *
 * Anything that is not exactly two letters returns null rather than a pair of
 * stray symbols, which is what a naive version renders for `THA` or `12`.
 *
 * Rendering is the caller's business: some Windows builds ship no flag glyphs
 * and show the two letters instead, which is legible and needs no fallback.
 */
export function countryFlag(code: string | null | undefined): string | null {
  const c = norm(code);
  if (!/^[A-Z]{2}$/.test(c)) return null;
  const A = 0x1f1e6; // REGIONAL INDICATOR SYMBOL LETTER A
  return String.fromCodePoint(A + (c.charCodeAt(0) - 65), A + (c.charCodeAt(1) - 65));
}

/**
 * The country in both languages — `"มาเลเซีย · Malaysia"` — or null.
 *
 * Both, because the two readerships are different and both are real: the person
 * filling the form reads Thai, and the figure they produce is checked against a
 * rate source, a bank statement and a Business Central company that all name the
 * country in English. A claim that says only มาเลเซีย makes somebody translate
 * before they can reconcile.
 *
 * The English half is dropped where it would only repeat the Thai, so a country
 * added with one name for both never renders "X · X".
 */
export function countryNameBoth(code: string | null | undefined): string | null {
  const c = BY_CODE.get(norm(code));
  if (!c) return null;
  return c.nameEn === c.nameTh ? c.nameTh : `${c.nameTh} · ${c.nameEn}`;
}
