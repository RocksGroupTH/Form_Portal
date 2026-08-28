/**
 * Exchange-rate lookup for AP-2 foreign-currency advances.
 *
 * Uses the official Bank of Thailand API when BOT_API_CLIENT_ID is configured
 * (buying-transfer rate, matches the Excel form). Without a key it falls back to
 * a keyless ECB source (frankfurter.app) — a mid-market rate, close but not the
 * official BOT rate, so accounting may adjust at payment time.
 */

const BOT_URL =
  "https://apigw1.bot.or.th/bot/public/Stat-ExchangeRate/v2/DAILY_AVG_EXG_RATE/";
const FRANKFURTER_URL = "https://api.frankfurter.dev/v1";

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
  buying_transfer?: string;
  buying_sight?: string;
  mid_rate?: string;
}

async function fetchBotRate(cur: string, date?: string): Promise<FxRate> {
  const key = process.env.BOT_API_CLIENT_ID!;
  const end = date ? new Date(date) : new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 10);
  const url = `${BOT_URL}?start_period=${ymd(start)}&end_period=${ymd(end)}&currency=${encodeURIComponent(cur)}`;
  const res = await fetch(url, {
    headers: { "X-IBM-Client-Id": key, Accept: "application/json" },
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
  const rate = Number(latest.buying_transfer ?? latest.mid_rate ?? latest.buying_sight);
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

/** BOT rate when a key is set, otherwise the keyless ECB fallback. */
export async function fetchFxRate(currency: string, date?: string): Promise<FxRate> {
  const cur = currency.trim().toUpperCase();
  if (!cur || cur === "THB") throw new Error("THB ไม่ต้องแปลงอัตรา");
  return process.env.BOT_API_CLIENT_ID ? fetchBotRate(cur, date) : fetchEcbRate(cur, date);
}
