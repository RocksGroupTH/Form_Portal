import { isBaht } from "./currency";

/**
 * Whether a group of expense lines can be described by one foreign figure.
 *
 * **Imports only `@/lib/acc/currency`, which imports nothing at all.** Same
 * constraint `claim-currency.ts` records: these render inside a client
 * component, so anything reaching a pool would drag `next/headers` into the
 * browser bundle, and `@/env` validates the whole environment at import, so
 * anything reachable from a pool cannot be unit-tested either.
 *
 * ── Why a header may not simply show the first line's currency ──
 *
 * `AccTravelExpenseItem.Amount` is always Thai baht, so baht sums at every
 * level — a day, a vehicle cluster, a claim. A *foreign* figure does not.
 * Pairing one line's `20.00 MYR` with a three-line baht total reads as an
 * exchange rate nobody used, and it is the reader's own arithmetic that turns
 * it into a wrong number.
 *
 * So the rule is all-or-nothing: a group summarises **only** when every line in
 * it carries the same foreign currency and a figure to add. Anything else —
 * a foreign line beside a baht one, two currencies, a figure whose currency the
 * receipt read could not determine — answers null, and the caller falls back to
 * naming the vehicle alone while each line states its own currency.
 *
 * The claim-level design keeps this from being restrictive in practice:
 * `lineCurrencyOptions` offers the trip country's currency and THB and nothing
 * else, so a claim holds at most one foreign code.
 */

export interface LineCurrencySummary {
  /** The single foreign code every line shares, or null if there is not one. */
  currency: string | null;
  /** Σ of those lines' `foreignAmount`, or null when they cannot be summed. */
  foreignTotal: number | null;
}

const NONE: LineCurrencySummary = { currency: null, foreignTotal: null };

function code(raw: string | null | undefined): string {
  return (raw ?? "").trim().toUpperCase();
}

export function summariseLineCurrency(
  lines: ReadonlyArray<{ foreignAmount?: number | null; currency?: string | null }>,
): LineCurrencySummary {
  if (lines.length === 0) return NONE;

  let currency: string | null = null;
  let total = 0;

  for (const line of lines) {
    const c = code(line.currency);
    // A baht line is not foreign, and one of them in the group is enough to
    // make the group unsummarisable — the total below it includes that line.
    if (!c || isBaht(c)) return NONE;
    if (currency === null) currency = c;
    else if (currency !== c) return NONE;

    const n = Number(line.foreignAmount);
    // A foreign line with no figure cannot be added, and guessing zero would
    // under-report the header against the baht total beside it.
    if (line.foreignAmount == null || !Number.isFinite(n)) return NONE;
    total += n;
  }

  if (currency === null) return NONE;
  return { currency, foreignTotal: Math.round(total * 100) / 100 };
}
