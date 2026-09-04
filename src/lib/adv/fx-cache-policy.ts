/**
 * What the FX cache is keyed on, and when a cached row may be served.
 *
 * **Imports nothing**, so every rule here is unit-tested without a database —
 * anything reachable from a pool drags `@/env` in, which validates the whole
 * environment at import time. `fx-rate-cache.ts` is the half that needs a pool
 * and holds no decisions of its own.
 *
 * ── The key is the day ASKED FOR, not the day the provider answered with ──
 *
 * Both sources publish on **working days only**. A lookup on a Saturday comes
 * back carrying Friday's rate; over a long weekend, a three-day-old one. Keyed
 * on the provider's `asOf`, a Saturday lookup would search for Saturday, never
 * find it, and call the API again — every time, on exactly the days a cache is
 * supposed to cover. Keyed on the query date, the second Saturday lookup hits.
 *
 * `RateAsOf` is stored beside it and is not redundant: it is the provenance
 * migration 130 exists to preserve, and it is what a claim's own `RateAsOf`
 * column is written from.
 *
 * ── Source is part of the key ──
 *
 * With no `BOT_CURRENCY_RATE` key registered the rate is the keyless ECB
 * mid-market figure. The day somebody registers the real Bank of Thailand
 * credential, cached ECB rows for today would otherwise go on being served —
 * so the operator would configure BOT, see no change, and have nothing to look
 * at. Keyed on source, the switch simply misses and re-fetches.
 */

export type FxCacheSource = "BOT" | "ECB";

export interface FxCacheKey {
  currency: string;
  /** `YYYY-MM-DD` — the day asked about. */
  queryDate: string;
  source: FxCacheSource;
}

/** Local-time `YYYY-MM-DD`. Never `toISOString()`, which is UTC and shifts the day. */
export function fxYmd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * What day a lookup is about — the single authority, with three outcomes.
 *
 * **This replaced a version that silently substituted today for anything it
 * could not parse, and that substitution was a money bug.** The caller's date
 * went two ways at once: to this function for the cache KEY, which demanded
 * `YYYY-MM-DD`, and raw to the provider, which did `new Date(raw)` and accepted
 * far more. So `2026-8-31` — one missing zero — keyed on *today* while asking
 * the bank for *31 August*, and the write stored August's rate under today's
 * row. Every conversion for the rest of that day then used it, including
 * `resolveRate`, which passes no date at all and so reads exactly that key.
 *
 * Two rules follow, and the second is why this returns a union instead of a
 * string:
 *
 * - **A date this cannot parse is a refusal, not a substitution.** Answering
 *   with today's rate for a question about another day is the silent-wrong-value
 *   failure `toBaht` and `resolveRate` exist to refuse.
 * - **A future date is a refusal too.** No provider can quote tomorrow, and
 *   accepting one let any authenticated caller write rows for days nobody has
 *   reached — `CK_FxRateCache_AsOf` permits it, since today's `asOf` is
 *   happily `<=` a future `QueryDate`.
 *
 * `now` is a parameter rather than a `new Date()` inside, so the rule is
 * testable and so a caller resolving several currencies in one request cannot
 * straddle midnight and key half its work to a different day.
 */
export type FxDateResolution =
  /** No date asked for: today, and the provider should be asked for its latest. */
  | { kind: "today"; date: string }
  /** A specific past day, already validated — ask the provider for exactly it. */
  | { kind: "explicit"; date: string }
  /** Unparseable, not a real calendar day, or in the future. */
  | { kind: "invalid" };

export function resolveFxDate(raw: string | null | undefined, now: Date): FxDateResolution {
  const s = (raw ?? "").trim();
  if (!s) return { kind: "today", date: fxYmd(now) };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { kind: "invalid" };
  // `2026-02-30` matches the shape and is not a day. Round-tripping through Date
  // is what catches it: JS rolls it over to 2026-03-02, which no longer equals
  // the input.
  const [y, m, d] = s.split("-").map(Number);
  const probe = new Date(y, m - 1, d);
  if (fxYmd(probe) !== s) return { kind: "invalid" };
  if (s > fxYmd(now)) return { kind: "invalid" };
  return { kind: "explicit", date: s };
}

/**
 * The key, built from an **already-resolved** day.
 *
 * It takes `queryDate` rather than a raw string on purpose: the bug this
 * module now documents was possible only because the key and the provider each
 * interpreted the caller's string for themselves. With the resolution done once
 * and passed in, the two cannot disagree — the mismatch is unrepresentable
 * rather than merely fixed.
 */
export function fxCacheKey(
  currency: string,
  queryDate: string,
  source: FxCacheSource,
): FxCacheKey {
  return { currency: currency.trim().toUpperCase(), queryDate, source };
}

export interface CachedFxRow {
  rate: number;
  asOf: string;
  source: string;
}

/**
 * Whether a row read back from the cache may be served.
 *
 * The source check is the load-bearing one and it is **not** redundant with the
 * query being keyed on source: a row can be read by a query written or changed
 * later, and serving a BOT figure captioned ECB — or the reverse — is a wrong
 * number on a claim, not a cosmetic slip.
 *
 * The rate check mirrors `resolveRate`'s: zero, negative and non-finite are all
 * refusals rather than values. `CK_FxRateCache_Rate` already forbids them at
 * the column, so this is the second of two answers on purpose — a restored
 * backup or a hand-edited row reaches the application through here.
 */
export function canServeCached(row: CachedFxRow | null, intended: FxCacheSource): boolean {
  if (!row) return false;
  if (row.source !== intended) return false;
  return Number.isFinite(row.rate) && row.rate > 0;
}
