/**
 * Exchange-rate lookup for AP-2 foreign-currency advances.
 *
 * Uses the official Bank of Thailand API when a `BOT_CURRENCY_RATE` key is
 * registered on the settings page —
 * the bank's **selling** rate, because an advance in a foreign currency means the
 * company buys that currency. Without a key it falls back to a keyless ECB source
 * (frankfurter) — a mid-market rate, close but not the official BOT rate, so
 * accounting may adjust at payment time.
 *
 * The response carries `source` ("BOT" or "ECB"); screens caption the figure from
 * that field rather than assuming either one.
 */

// Host and path from the BOT OpenAPI spec (Average Exchange Rate v2.0.2). The
// previous value pointed at `apigw1.bot.or.th`, a host that does not resolve at
// all — which nothing caught, because without a key this path was never taken.
const BOT_URL =
  "https://gateway.api.bot.or.th/Stat-ExchangeRate/v2/DAILY_AVG_EXG_RATE/";
const FRANKFURTER_URL = "https://api.frankfurter.dev/v1";

/** The registry code accounting manages this under, on the settings page. */
const BOT_KEY_CODE = "BOT_CURRENCY_RATE";

/**
 * How long any FX call may take before it is abandoned.
 *
 * Every fetch below carries it, including the currency list — that one is on
 * AP-2's picker and hangs its page exactly as the rate calls hang a save. A
 * provider that stops answering without closing the socket otherwise hangs
 * whatever called it, for as long as the platform allows.
 */
const FX_TIMEOUT_MS = 8000;

export type FxSource = "BOT" | "ECB";

export interface FxRate {
  currency: string;
  rate: number;   // THB per 1 unit
  asOf: string;   // YYYY-MM-DD
  source: FxSource;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Currencies supported by the FX source (ECB list via Frankfurter). Cached per process. */
let currencyCache: { code: string; name: string }[] | null = null;
export async function fetchSupportedCurrencies(): Promise<{ code: string; name: string }[]> {
  if (currencyCache) return currencyCache;
  const res = await fetch(`${FRANKFURTER_URL}/currencies`, { signal: AbortSignal.timeout(FX_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`FX currencies ${res.status}`);
  const json = (await res.json()) as Record<string, string>;
  const list = Object.entries(json)
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.code.localeCompare(b.code));
  currencyCache = list;
  return list;
}

interface BotDetail {
  period?: string;
  selling?: string;
  buying_transfer?: string;
  buying_sight?: string;
  mid_rate?: string;
}

async function fetchBotRate(cur: string, key: string, date?: string): Promise<FxRate> {
  const end = date ? new Date(date) : new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 10);
  const url = `${BOT_URL}?start_period=${ymd(start)}&end_period=${ymd(end)}&currency=${encodeURIComponent(cur)}`;
  const res = await fetch(url, {
    // The spec's securityScheme is an apiKey in the `Authorization` header, not
    // the `X-IBM-Client-Id` this used to send.
    headers: { Authorization: key, Accept: "application/json" },
    signal: AbortSignal.timeout(FX_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`BOT API ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  const json = (await res.json()) as { result?: { data?: { data_detail?: BotDetail[] } } };
  const detail = json.result?.data?.data_detail ?? [];
  if (detail.length === 0) throw new Error(`ไม่พบอัตราแลกเปลี่ยน ${cur} จาก ธปท.`);
  const latest = detail.reduce((a, b) => ((a.period ?? "") >= (b.period ?? "") ? a : b));
  // The bank's SELLING rate: an advance in a foreign currency means the company
  // buys that currency, and selling is what it pays. The buying rates are what a
  // bank pays to take currency off you — the wrong side of the spread here, and
  // about 0.32 THB per USD adrift from it (decision: accounting, 2026-09-04).
  const rate = Number(latest.selling ?? latest.mid_rate ?? latest.buying_transfer);
  if (!rate || Number.isNaN(rate)) throw new Error("อัตราแลกเปลี่ยนจาก ธปท. ไม่ถูกต้อง");
  return { currency: cur, rate, asOf: latest.period ?? ymd(end), source: "BOT" };
}

async function fetchEcbRate(cur: string, date?: string): Promise<FxRate> {
  const path = date ? date : "latest";
  const url = `${FRANKFURTER_URL}/${path}?base=${encodeURIComponent(cur)}&symbols=THB`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FX_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`FX API ${res.status}`);
  const json = (await res.json()) as { date?: string; rates?: Record<string, number> };
  const rate = json.rates?.THB;
  if (!rate || Number.isNaN(rate)) throw new Error(`ไม่พบอัตราแลกเปลี่ยน ${cur}→THB`);
  return { currency: cur, rate, asOf: json.date ?? (date ?? ymd(new Date())), source: "ECB" };
}

/**
 * BOT rate when a key is registered, otherwise the keyless ECB fallback.
 *
 * The key comes from the portal's API-key registry under `BOT_CURRENCY_RATE`,
 * the same rail as every other credential — so accounting rotates it from the
 * settings page rather than by editing a file and restarting the server.
 * `resolveApiKey` still falls back to `.env` for codes it knows there, so a
 * deployment that has not been migrated keeps working.
 *
 * A registry lookup that throws is treated as "no key": the ECB figure is worth
 * more to the person filling the form than an error, and `source` tells them
 * which one they got.
 */
export async function fetchFxRate(currency: string, date?: string): Promise<FxRate> {
  const cur = currency.trim().toUpperCase();
  if (!cur || cur === "THB") throw new Error("THB ไม่ต้องแปลงอัตรา");
  const key = await resolveBotKey();
  return key ? fetchBotRate(cur, key, date) : fetchEcbRate(cur, date);
}

async function resolveBotKey(): Promise<string | null> {
  try {
    const { resolveApiKey } = await import("@/lib/api-keys/service");
    const { value } = await resolveApiKey(BOT_KEY_CODE);
    return value?.trim() || null;
  } catch {
    return null;
  }
}
