import type { TravelExpenseDetail } from "@/features/accounting/types";
import { allDayItems } from "@/features/accounting/lib/travel-sections";
import { TRAVEL_ITEM_TYPE_LABEL_TH } from "@/features/accounting/constants";
import { isBaht } from "@/lib/acc/currency";

/**
 * **Which rates a filed AP-1 claim was actually converted at**, read back off
 * the claim rather than fetched again.
 *
 * The detail page is what an approver reads before deciding to pay. Migration
 * 130 stores, per expense line, the rate used and *which day's rate it was*, and
 * this is the module that reads those two facts back out. Nothing here consults
 * a provider: a rate fetched today, printed beside a figure converted three
 * weeks ago, is two numbers that silently disagree, and the reader has no way to
 * tell which one the claim is worth. That is the whole reason 130 exists.
 *
 * It imports only pure modules — the types, `travel-sections`, the label map and
 * `@/lib/acc/currency`, none of which import anything that reaches a pool. So
 * every rule here is unit-tested without a database and is safe in the client
 * bundle the detail page ships in, the same constraint `claim-currency.ts`
 * records.
 *
 * ── Why a *list* of rates, and not one ──
 *
 * Since migration 129 the currency lives on the **expense line**, not on the
 * request, and a line is converted when it is written. So one claim can hold
 * more than one rate with nothing wrong: a draft saved on the 3rd and submitted
 * on the 10th converts its old lines at the 3rd's rate and its new ones at the
 * 10th's, and an accounting override (`RATE_SOURCE_OVERRIDE`) rewrites a single
 * line's rate on purpose. Printing any one of them as though it governed the
 * claim would state something false about every other line.
 *
 * Hence a fact per distinct `(currency, rate, asOf, source)` and, on each, the
 * lines it actually governs. One rate collapses to one row, which is the common
 * case and reads exactly like the single sentence it replaces; two rates read as
 * two, each naming what it applies to.
 */

/** One rate, and every expense line converted at it. */
export interface ClaimRateFact {
  /** Upper-cased ISO code. Never `THB` — a baht line is not converted. */
  currency: string;
  /**
   * THB per 1 unit, as stored. **Null is a real state, not a gap**: a foreign
   * line whose rate the provider never answered is on the claim, and saying so
   * is the point — the figure beside it is not a converted one.
   */
  rate: number | null;
  /**
   * Which day's rate that was, `YYYY-MM-DD`, or null where nobody recorded it —
   * every line written before migration 130, which backfilled nothing.
   * Null prints no date rather than an invented one.
   */
  asOf: string | null;
  /** `"ECB"`, or `RATE_SOURCE_OVERRIDE` once accounting has corrected the line. */
  source: string | null;
  /** The lines this rate converted, in read order. `"วันที่ 2 · ค่าโดยสาร"`. */
  lines: string[];
}

function norm(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase();
}

/**
 * Every distinct rate on the claim, in the order the lines are read.
 *
 * A **baht line contributes nothing**, so a Thai claim answers `[]` and every
 * surface built on this renders exactly the markup it rendered before the
 * currency existed. That is the promise most easily broken by a later edit, and
 * one predicate — `isBaht` — is what keeps it checkable.
 *
 * Lines are named with their day number only on a multi-day claim; on a
 * single-day one the number is noise, since there is only one day it could be.
 */
export function claimRateFacts(
  days: TravelExpenseDetail[] | null | undefined,
): ClaimRateFact[] {
  const list = days ?? [];
  const multiDay = list.length > 1;
  const facts: ClaimRateFact[] = [];
  const indexByKey = new Map<string, number>();

  for (let di = 0; di < list.length; di++) {
    for (const it of allDayItems(list[di])) {
      if (isBaht(it.currency)) continue;
      const currency = norm(it.currency);
      const rate = it.exchangeRate == null || !Number.isFinite(it.exchangeRate)
        ? null
        : Number(it.exchangeRate);
      const asOf = it.rateAsOf ?? null;
      const source = (it.rateSource ?? "").trim() || null;
      const label = TRAVEL_ITEM_TYPE_LABEL_TH[it.itemType] ?? it.itemType;
      const line = multiDay ? `วันที่ ${di + 1} · ${label}` : label;

      // The key carries all four, because two lines converted at the same
      // number on different days are two different facts about the claim —
      // which is exactly what an approver is entitled to see.
      const key = `${currency}|${rate === null ? "" : String(rate)}|${asOf ?? ""}|${source ?? ""}`;
      const at = indexByKey.get(key);
      if (at != null) {
        facts[at].lines.push(line);
      } else {
        indexByKey.set(key, facts.length);
        facts.push({ currency, rate, asOf, source, lines: [line] });
      }
    }
  }

  return facts;
}

/**
 * The currencies the claim converted at **more than one** rate.
 *
 * Two currencies on one claim is ordinary — a trip that bought a ringgit taxi
 * and a Singapore-dollar hotel — and needs no explaining. The same currency
 * twice does: it means two lines of the same money were priced on different
 * days, or one of them has been corrected by hand. Without a word saying so the
 * second row reads as a contradiction rather than as a fact about the claim.
 */
export function multiRateCurrencies(facts: ClaimRateFact[]): string[] {
  const seen = new Map<string, number>();
  for (const f of facts) seen.set(f.currency, (seen.get(f.currency) ?? 0) + 1);
  const out: string[] = [];
  // `Array.from`, never a spread — the build targets ES5.
  for (const code of Array.from(seen.keys())) {
    if ((seen.get(code) ?? 0) > 1) out.push(code);
  }
  return out;
}
