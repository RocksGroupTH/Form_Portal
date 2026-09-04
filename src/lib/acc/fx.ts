import { fetchFxRate } from "@/lib/adv/bot-fx";
import { isBaht, THB } from "@/lib/acc/currency";

/**
 * Resolving an exchange rate, server-side.
 *
 * **The client never posts a rate.** AP-2 does — its browser fetches the rate
 * and posts it, and nothing verifies it (`advance-request-service.ts:438`), so a
 * requester could choose their own. This is the one part of AP-2's approach
 * deliberately not reused.
 *
 * **The rate is whichever feed `bot-fx` resolves.** Since a `BOT_CURRENCY_RATE`
 * key was registered on 2026-09-04 that is the Bank of Thailand selling rate;
 * every claim converted before that day holds the keyless ECB mid-market
 * fallback instead. Neither is the rate the company's own bank finally settled
 * at, which is why accounting can override it — and why no screen may caption a
 * stored figure with a feed's name, since the screens show rows from both sides
 * of that day. `อัตราอ้างอิง`.
 */

/**
 * Whether a claim in this currency has to look a rate up.
 *
 * Baht never does. That is what keeps an FX outage from stopping ordinary work:
 * the refuse-on-failure rule at submit applies only to a foreign claim, so a
 * provider being down cannot block the Thai claims that are almost all of them.
 */
export function needsRate(currency: string | null | undefined): boolean {
  return !isBaht(currency);
}

export interface ResolvedRate {
  /** THB per 1 unit. Exactly 1 for baht. */
  rate: number;
  /** The provider's date, or "" for baht, which needs none. */
  asOf: string;
  source: string;
}

/**
 * Today's rate, or **null when it cannot be had**.
 *
 * Null is a refusal, not a zero and not a one. A caller that treats it as 1
 * would store a foreign figure as though it were baht, which is the failure
 * `toBaht` exists to make impossible — so callers must refuse the write, and the
 * submit path must refuse the submit.
 *
 * AP-1 shares `fetchFxRate` with AP-2 on purpose, so it moved to the Bank of
 * Thailand selling rate with it on 2026-09-04 (decision: user). The three forms
 * settle the same money — an advance, its clearing and a travel claim — and
 * converting them on different bases would only show up later as a reconciling
 * difference nobody could explain. Claims stored before that date used the ECB
 * mid-market fallback; `rateSource` on the row is what tells the two apart.
 */
export async function resolveRate(currency: string | null): Promise<ResolvedRate | null> {
  if (!needsRate(currency)) return { rate: 1, asOf: "", source: THB };
  try {
    const fx = await fetchFxRate(String(currency).trim().toUpperCase());
    if (!fx || !Number.isFinite(fx.rate) || fx.rate <= 0) return null;
    return { rate: fx.rate, asOf: fx.asOf, source: fx.source };
  } catch {
    // A timeout, an outage, a currency the provider does not carry. All the
    // same answer: we do not know, so nothing may be written.
    return null;
  }
}
