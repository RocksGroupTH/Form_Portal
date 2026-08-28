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
 * **Every rate here is an ECB mid-market reference rate.** `BOT_API_CLIENT_ID`
 * will not be provisioned, so `bot-fx` always takes its keyless fallback. That
 * is not the rate a bank settles at, which is why accounting can override it and
 * why no screen may caption it as a Bank of Thailand rate — `อัตราอ้างอิง`.
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
