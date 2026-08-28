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
  { code: "KH", currency: "KHR", nameTh: "กัมพูชา", nameEn: "Cambodia" },
  { code: "QA", currency: "QAR", nameTh: "กาตาร์", nameEn: "Qatar" },
  { code: "KR", currency: "KRW", nameTh: "เกาหลีใต้", nameEn: "South Korea" },
  { code: "CN", currency: "CNY", nameTh: "จีน", nameEn: "China" },
  { code: "CZ", currency: "CZK", nameTh: "เช็กเกีย", nameEn: "Czechia" },
  { code: "JP", currency: "JPY", nameTh: "ญี่ปุ่น", nameEn: "Japan" },
  { code: "DK", currency: "DKK", nameTh: "เดนมาร์ก", nameEn: "Denmark" },
  { code: "TR", currency: "TRY", nameTh: "ตุรกี", nameEn: "Türkiye" },
  { code: "TW", currency: "TWD", nameTh: "ไต้หวัน", nameEn: "Taiwan" },
  { code: "TH", currency: "THB", nameTh: "ไทย", nameEn: "Thailand" },
  { code: "NO", currency: "NOK", nameTh: "นอร์เวย์", nameEn: "Norway" },
  { code: "NZ", currency: "NZD", nameTh: "นิวซีแลนด์", nameEn: "New Zealand" },
  { code: "NL", currency: "EUR", nameTh: "เนเธอร์แลนด์", nameEn: "Netherlands" },
  { code: "BN", currency: "BND", nameTh: "บรูไน", nameEn: "Brunei" },
  { code: "BH", currency: "BHD", nameTh: "บาห์เรน", nameEn: "Bahrain" },
  { code: "FR", currency: "EUR", nameTh: "ฝรั่งเศส", nameEn: "France" },
  { code: "PH", currency: "PHP", nameTh: "ฟิลิปปินส์", nameEn: "Philippines" },
  { code: "MY", currency: "MYR", nameTh: "มาเลเซีย", nameEn: "Malaysia" },
  { code: "MM", currency: "MMK", nameTh: "เมียนมา", nameEn: "Myanmar" },
  { code: "DE", currency: "EUR", nameTh: "เยอรมนี", nameEn: "Germany" },
  { code: "RU", currency: "RUB", nameTh: "รัสเซีย", nameEn: "Russia" },
  { code: "LA", currency: "LAK", nameTh: "ลาว", nameEn: "Laos" },
  { code: "VN", currency: "VND", nameTh: "เวียดนาม", nameEn: "Vietnam" },
  { code: "ES", currency: "EUR", nameTh: "สเปน", nameEn: "Spain" },
  { code: "CH", currency: "CHF", nameTh: "สวิตเซอร์แลนด์", nameEn: "Switzerland" },
  { code: "SE", currency: "SEK", nameTh: "สวีเดน", nameEn: "Sweden" },
  { code: "US", currency: "USD", nameTh: "สหรัฐอเมริกา", nameEn: "United States" },
  { code: "AE", currency: "AED", nameTh: "สหรัฐอาหรับเอมิเรตส์", nameEn: "United Arab Emirates" },
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

/** `ไทย (THB)` — how the picker and the configured list both read. */
export function countryLabel(code: string | null | undefined): string | null {
  const c = BY_CODE.get(norm(code));
  return c ? `${c.nameTh} (${c.currency})` : null;
}
