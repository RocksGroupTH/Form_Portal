/**
 * AP-1 asks which **country** the trip was to, and each expense line carries its
 * own currency. These are the rules both halves — the form and the save — must
 * agree on, in one place so they cannot drift.
 *
 * It imports only `@/lib/acc/currency` and `@/lib/acc/country-currency`, which
 * import nothing at all. That matters twice over: the form is a client
 * component, so anything reaching a pool would drag `next/headers` into the
 * browser bundle (the hazard `api-keys/codes.ts` records), and `@/env` validates
 * the whole environment at import time, so anything reachable from a pool cannot
 * be unit-tested either.
 *
 * In particular it does **not** import `@/lib/acc/fx`. `needsRate(c)` there is
 * `!isBaht(c)`, the same predicate — but `fx.ts` pulls in `bot-fx.ts` and the
 * network with it, and neither the picker nor the line's own control needs a rate to
 * know a line is foreign.
 *
 * ── Why a country and not a currency ──
 *
 * The claim used to carry one currency, on the design that a claim is filed in
 * one. It is not: a single Grab section holds a 20 MYR ride and a 20 THB ride
 * and both belong on the same claim. So the currency moved to the line
 * (migration 129) and the **country** took its place on the request — a trip is
 * to one country, and what the country decides is which currencies a line may
 * be entered in.
 *
 * Thailand offers no choice at all: `lineCurrencyOptions` answers `[]`, every
 * line resolves to baht, and the form renders precisely the markup it rendered
 * before any of this existed. That is the promise most likely to be broken by a
 * later edit, so it is one predicate rather than a condition retyped per
 * surface.
 *
 * ── Which country the picker starts on ──
 *
 * Thailand *was* the default by construction — it was hard-coded first and
 * unconditional. Since migration 131 a brand may switch baht off, so there has
 * to be somewhere else to start, and the answer is a **row marked as the
 * brand's default** rather than a second special case beside the Thai one.
 * `defaultClaimCountry` is the single definition: a marked, enabled row wins;
 * otherwise Thailand while it is still offered; otherwise the first country the
 * brand does offer. A brand nobody has configured therefore still answers `TH`
 * through the same code path everything else uses.
 */

import {
  bahtEnabled,
  defaultCurrencyRow,
  enabledForeignCurrencies,
  isBaht,
  toBaht,
  THB,
  type BrandCurrencyEntry,
} from "@/lib/acc/currency";
import { COUNTRIES, currencyForCountry } from "@/lib/acc/country-currency";

/**
 * Thailand — the country almost every claim is filed from, and the fallback
 * every other rule here ends at.
 *
 * It is **no longer unconditional**. A brand configured for nothing but ringgit
 * still files Thai claims, and that is still the default; but migration 131
 * lets an admin say a brand does *not*, by carrying a disabled `THB` row. When
 * they do, `claimCountryOptions` leaves Thailand out and `defaultClaimCountry`
 * starts the picker somewhere the brand actually offers.
 */
export const DEFAULT_COUNTRY = "TH";

/** The shape both halves read a brand as — `RegistryBrand` and `AccBrandOption` both satisfy it. */
export interface ClaimCurrencyBrand {
  currencies: readonly BrandCurrencyEntry[] | null | undefined;
}

/**
 * Everything a line's money controls need, computed once per request and passed
 * down rather than re-derived per row.
 *
 * **`options.length === 0` means render nothing.** It is the Thailand case, and
 * it is also a brand with no currency configured — both must leave the expense
 * rows byte-identical to what they were before this feature shipped, which a
 * one-option control would not.
 */
export interface LineCurrencyContext {
  /** What a line's currency control offers, or empty — see above. */
  options: string[];
  /**
   * The country's own currency — the one the rate below is for, and the one the
   * claim's reference-rate note names. It is **not** a default: a line with no
   * recorded currency is unanswered, not assumed to be in this.
   */
  defaultCurrency: string;
  /**
   * THB per 1 unit of `defaultCurrency`, for the on-screen preview **only**.
   *
   * Null while it is not known — before the lookup answers, or after it fails.
   * The client never posts it: the server fetches its own rate on every save,
   * which is the one part of AP-2's approach deliberately not reused (AP-2
   * stores whatever the browser sent, verified by nothing).
   */
  rate: number | null;
  /**
   * Which day's rate `rate` is, `YYYY-MM-DD` — or null while it is not known.
   *
   * Display only, like the rate it qualifies. It matters because the source
   * publishes on **working days only**: a claim opened on a Saturday previews
   * Friday's rate, and over a long weekend a three-day-old one. That is correct
   * — there is no rate for a day the market did not trade — but the note has to
   * say so, or the requester reads a figure as today's when it is not.
   */
  rateAsOf: string | null;
}

function norm(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase();
}

/**
 * The countries a claim against this brand may be filed from: **Thailand first
 * where the brand still claims in baht, then every country whose currency the
 * brand offers.**
 *
 * A brand only claims where it is set up to claim, so the list is
 * `BrandCurrency` (migration 127) read back through the country table rather
 * than all 249 countries. One configured currency can produce several countries
 * — EUR gives the Netherlands, France, Germany, Spain and Italy — which is the
 * point: the requester names where they went, and the currency follows.
 *
 * Thailand leads whenever it is there, and it is there unless a disabled `THB`
 * row says otherwise (`bahtEnabled`, migration 131). A brand with nothing
 * configured therefore offers exactly one country, and
 * `claimCountryOptions(...).length <= 1` is what the form uses to render no
 * picker at all — which is now also the answer for a brand claiming in one
 * foreign currency and no baht.
 *
 * **The list is never empty for a brand the settings editor produced**: those
 * writes refuse to leave a brand with nothing enabled. It can still be empty
 * here — a row edited directly in SQL — and every caller treats that as
 * Thailand rather than as a form with no country at all.
 */
export function claimCountryOptions(
  brand: ClaimCurrencyBrand | null | undefined,
): string[] {
  const foreign = enabledForeignCurrencies(brand?.currencies);
  const out: string[] = [];
  if (bahtEnabled(brand?.currencies)) out.push(DEFAULT_COUNTRY);
  for (let i = 0; i < COUNTRIES.length; i++) {
    const c = COUNTRIES[i];
    if (c.code === DEFAULT_COUNTRY) continue;
    if (foreign.indexOf(c.currency) !== -1) out.push(c.code);
  }
  return out;
}

/**
 * The country a claim against this brand **starts on** — what the picker
 * preselects, and what an unanswered or no-longer-offered choice falls back to.
 *
 * Three steps, in order, and the first two are the whole feature:
 *
 * 1. **A row marked as the brand's default**, while it is still enabled and
 *    still yields a country the brand offers. The row's own `countryCode` wins
 *    — several countries can share a currency and the admin picked one of them
 *    — and its currency is read back through the country table only where that
 *    code is missing or no longer offered.
 * 2. **Thailand**, whenever it is still offered. This is what makes marking a
 *    default *optional*: a brand claiming in baht needs no flag set, and every
 *    brand configured before migration 131 is in exactly that state.
 * 3. **The first country the brand does offer** — the answer once baht is off
 *    and nothing is marked, which the settings editor tries not to leave behind
 *    but a direct SQL edit can.
 *
 * `DEFAULT_COUNTRY` is the last resort rather than a fourth step: it is reached
 * only for a brand offering nothing at all, and a form has to open on some
 * country.
 */
export function defaultClaimCountry(
  brand: ClaimCurrencyBrand | null | undefined,
): string {
  const options = claimCountryOptions(brand);
  if (options.length === 0) return DEFAULT_COUNTRY;

  const marked = defaultCurrencyRow(brand?.currencies);
  if (marked) {
    const own = norm(marked.countryCode);
    if (own !== "" && options.indexOf(own) !== -1) return own;
    const code = norm(marked.currencyCode);
    for (let i = 0; i < options.length; i++) {
      if (currencyForCountry(options[i]) === code) return options[i];
    }
  }

  if (options.indexOf(DEFAULT_COUNTRY) !== -1) return DEFAULT_COUNTRY;
  return options[0];
}

/**
 * The country a claim is actually filed from, given what the form holds and
 * what the brand offers.
 *
 * **The brand's default unless the brand still offers exactly this country.**
 * That is what makes an admin switching a `BrandCurrency` row off — or removing
 * it — recoverable rather than a trap: a draft still holding `MY` resolves to
 * something the brand does offer, every line resolves with it, and the next
 * save succeeds. Without it the form would post a country the server refuses,
 * with no control on screen to change it.
 *
 * **A blank selection is not a choice of Thailand.** It is what a new claim
 * holds before anybody has answered, and it must land on the brand's default —
 * which is why the form seeds its state with `""` rather than with `"TH"`. The
 * two were the same answer until migration 131 and are not any more.
 */
export function effectiveClaimCountry(
  selected: string | null | undefined,
  brand: ClaimCurrencyBrand | null | undefined,
): string {
  const want = norm(selected);
  if (want !== "" && claimCountryOptions(brand).indexOf(want) !== -1) return want;
  return defaultClaimCountry(brand);
}

/**
 * What one expense line's currency control offers: **the country's currency, then
 * baht** — and **nothing at all for Thailand**.
 *
 * Two options rather than the brand's whole list, because the country is
 * already the answer to "which foreign money was spent here". A trip to
 * Malaysia buys ringgit and baht, not ringgit and pounds, and offering the
 * brand's other currencies would invite a line filed in one the requester never
 * held.
 *
 * Empty is the Thailand answer and it is load-bearing: no control, no rate
 * column, no conversion note anywhere on the form.
 */
export function lineCurrencyOptions(country: string | null | undefined): string[] {
  const cur = currencyForCountry(country);
  if (cur === null || isBaht(cur)) return [];
  return [cur, THB];
}

/**
 * The currency one line is actually in — or **null, meaning nobody has said
 * yet**.
 *
 * Null is a real and expected state, not an error. Attaching a receipt asks the
 * model which currency the document is in, and *"I cannot tell"* is an answer it
 * is required to give rather than guess at; the amount is still filled in, the
 * currency is left blank, and the requester chooses. `lineNeedsCurrency` marks
 * such a line and `validateForSubmit` refuses the claim until it is answered,
 * because a line whose worth in baht nobody knows must not be filed.
 *
 * **Thailand answers `THB` for everything**, since `lineCurrencyOptions` is
 * empty there and there is no other money to be in. That is what keeps the
 * blank state off an ordinary Thai claim altogether: no control, so nothing to
 * leave unanswered.
 *
 * This replaces a rule that resolved an unrecorded currency to the **country's**
 * own. That was a defensible default while nothing could fill the field in, and
 * it is the wrong one now that the read can: it made a line nobody had priced
 * indistinguishable from one deliberately entered in ringgit, so a `20` typed
 * under an unanswered question would have been converted as though somebody had
 * answered it. A currency the country does not offer lands in the same place
 * and for the same reason — a draft whose country was changed, or a code the
 * brand carries but this trip could not have been in, is a question to ask, not
 * a fact to assume.
 */
export function effectiveLineCurrency(
  selected: string | null | undefined,
  country: string | null | undefined,
): string | null {
  return resolveLineCurrency(selected, lineCurrencyOptions(country));
}

/**
 * The same rule, for a caller that already holds the option list.
 *
 * The form computes the options once per request and passes them down as
 * `LineCurrencyContext`; re-deriving them from the country in every row would be
 * a second path to the same answer, which is how the row and the save come to
 * disagree about what a line is in.
 *
 * It doubles as the admission gate for whatever the receipt read answered: a
 * code this line was never offered — the brand carries GBP, the trip was to
 * Malaysia — is not a discovery, so it comes back null and the requester
 * chooses, exactly as an illegible one does.
 */
export function resolveLineCurrency(
  selected: string | null | undefined,
  options: readonly string[],
): string | null {
  if (options.length === 0) return THB;
  const want = norm(selected);
  return options.indexOf(want) === -1 ? null : want;
}

/** The three money fields both the row and the submit validation read a line by. */
export interface LineCurrencyItem {
  amount: number;
  currency?: string | null;
  foreignAmount?: number | null;
}

/**
 * Whether this line claims money whose currency nobody has stated.
 *
 * **An empty row is not one.** Rows are added freely and sit blank until a
 * receipt is attached, so the question is only asked of a line that carries a
 * figure — the same shape as the long-standing "an amount needs a receipt"
 * rule, which likewise says nothing about an empty row.
 */
export function lineNeedsCurrency(
  item: LineCurrencyItem,
  options: readonly string[],
): boolean {
  if (options.length === 0) return false;
  if (resolveLineCurrency(item.currency, options) !== null) return false;
  return typedLineFigure(item, options) > 0;
}

/**
 * How many currencies a **segmented control** can show before it stops being
 * readable and has to become a dropdown again.
 *
 * A line's money control sits in a cell 192px wide on a phone, sharing the row
 * with the receipt tile and the delete button. Two codes take half of that each
 * and read as two buttons; three still read as three. A fourth gives every
 * segment about 45px — a strip of abbreviations nobody can hit accurately, and
 * worse than the dropdown it replaced.
 *
 * **Today nothing reaches it**: `lineCurrencyOptions` answers the country's own
 * currency and baht, and never more. The threshold exists because that is a
 * property of one function rather than of the design — a country offering three
 * currencies is a plausible next change, and a control that silently degrades
 * is better than one that has to be remembered about.
 */
export const LINE_CURRENCY_SEGMENT_MAX = 3;

/**
 * Whether this line's currency is asked as **segments** rather than a dropdown.
 *
 * False for an empty list too, which is the Thailand answer: there is no
 * control at all there, not an empty one. Callers still test
 * `options.length > 0` first — this only decides *which* control, never
 * *whether*.
 */
export function usesCurrencySegments(options: readonly string[]): boolean {
  return options.length > 0 && options.length <= LINE_CURRENCY_SEGMENT_MAX;
}

/** The submit-time refusal. A control absent from a page is not a rule. */
export const LINE_CURRENCY_MISSING_ERROR =
  "กรุณาเลือกสกุลเงินของรายการค่าใช้จ่ายที่กรอกจำนวนเงิน";

/** The same thing said on the row itself, where it can actually be fixed. */
export const LINE_CURRENCY_MISSING_NOTE =
  "ยังไม่ได้ระบุสกุลเงินของรายการนี้ — กรุณาเลือกสกุลเงินก่อนส่งคำขอ";

/** One line's four money fields, as the form holds them between saves. */
export interface LineMoney {
  /** Baht. On screen this is a **preview**; the server recomputes it on save. */
  amount: number;
  currency: string | null;
  exchangeRate: number | null;
  foreignAmount: number | null;
}

/**
 * A typed figure and a currency turned into the four fields a line carries.
 *
 * Used by the form to keep the day and claim totals live while somebody types —
 * they sum `amount`, which has to be baht for the figure on screen to mean
 * anything. **It is not the authority.** `request-service.ts` recomputes all
 * four on every save from `foreignAmount` and a rate it fetches itself, so a
 * browser cannot choose the rate its own claim is converted at (AP-2's design,
 * deliberately not reused).
 *
 * A baht line takes the identity branch: the typed figure straight through, and
 * the other three null **on a claim that offers no choice**. On one that does,
 * the same line records `"THB"` — because there the absence of a currency is
 * how an *unanswered* line is written down, and a baht line that recorded
 * nothing would be indistinguishable from one nobody has priced. A Thai claim
 * still writes all three null, so its arithmetic and its rows are bit-identical
 * to what they were before this feature shipped — the same guarantee
 * `lineFxOrThrow` gives on the server, which reproduces this split.
 *
 * **An unanswered currency banks the typed figure and no baht at all**: the
 * figure goes to `foreignAmount`, `amount` is 0, and the submit refuses. It is
 * the one state where 0 is not a preview failure but the truth — the line's
 * worth in baht is not a number anybody has.
 *
 * **An unknown rate previews as 0, never as the unconverted figure.** Returning
 * the figure would show a ringgit number under a baht total. Zero is visibly
 * wrong beside the `—` the converted cell then shows, and it self-corrects: the
 * server fetches its own rate, and the reload after the save brings back the
 * real baht.
 */
export function lineMoney(
  typed: number,
  currency: string | null,
  rate: number | null,
  options: readonly string[],
): LineMoney {
  const n = Number.isFinite(typed) ? typed : 0;
  if (currency === null) {
    return { amount: 0, currency: null, exchangeRate: null, foreignAmount: n };
  }
  if (isBaht(currency)) {
    return {
      amount: n,
      currency: options.length === 0 ? null : THB,
      exchangeRate: null,
      foreignAmount: null,
    };
  }
  return {
    amount: toBaht(n, rate) ?? 0,
    currency: norm(currency),
    exchangeRate: rate,
    foreignAmount: n,
  };
}

/**
 * The figure a line's input shows: what was typed, in whichever field holds it.
 *
 * An unanswered line reads `foreignAmount` first and falls back to `amount`,
 * which covers both of the ways one arises: the receipt read banking a figure
 * whose currency it could not tell, and a row written before this claim was
 * foreign at all — whose typed figure is the baht in `amount`. Falling back is
 * safe here and nowhere else: this decides what to *show* in an input, never
 * what a line is worth.
 */
export function typedLineFigure(
  item: LineCurrencyItem,
  options: readonly string[],
): number {
  const cur = resolveLineCurrency(item.currency, options);
  if (cur === null) return Number(item.foreignAmount ?? item.amount) || 0;
  if (isBaht(cur)) return Number(item.amount) || 0;
  return Number(item.foreignAmount) || 0;
}
