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
 * network with it, and neither the picker nor the line dropdown needs a rate to
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
 * Thailand is the default and offers no choice at all: `lineCurrencyOptions`
 * answers `[]`, every line resolves to baht, and the form renders precisely the
 * markup it rendered before any of this existed. That is the promise most likely
 * to be broken by a later edit, so it is one predicate rather than a condition
 * retyped per surface.
 */

import { enabledForeignCurrencies, isBaht, toBaht, THB, type BrandCurrencyEntry } from "@/lib/acc/currency";
import { COUNTRIES, currencyForCountry } from "@/lib/acc/country-currency";

/**
 * Thailand. The default country of every claim, and the one that must always be
 * offered — a brand configured for nothing but ringgit still files Thai claims,
 * which are almost all of them.
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
 * one-option dropdown would not.
 */
export interface LineCurrencyContext {
  /** What a line's dropdown offers, or empty — see above. */
  options: string[];
  /** The country's own currency. What a line with no recorded currency is in. */
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
}

function norm(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase();
}

/**
 * The countries a claim against this brand may be filed from: **Thailand first,
 * then every country whose currency the brand actually offers.**
 *
 * A brand only claims where it is set up to claim, so the list is
 * `BrandCurrency` (migration 127) read back through the country table rather
 * than all 249 countries. One configured currency can produce several countries
 * — EUR gives the Netherlands, France, Germany, Spain and Italy — which is the
 * point: the requester names where they went, and the currency follows.
 *
 * Thailand is unconditional and first. A brand with nothing configured
 * therefore offers exactly one country, and `claimCountryOptions(...).length <= 1`
 * is what the form uses to render no picker at all.
 */
export function claimCountryOptions(
  brand: ClaimCurrencyBrand | null | undefined,
): string[] {
  const foreign = enabledForeignCurrencies(brand?.currencies);
  const out: string[] = [DEFAULT_COUNTRY];
  for (let i = 0; i < COUNTRIES.length; i++) {
    const c = COUNTRIES[i];
    if (c.code === DEFAULT_COUNTRY) continue;
    if (foreign.indexOf(c.currency) !== -1) out.push(c.code);
  }
  return out;
}

/**
 * The country a claim is actually filed from, given what the form holds and
 * what the brand offers.
 *
 * **Always Thailand unless the brand still offers exactly this country.** That
 * is what makes an admin switching a `BrandCurrency` row off — or removing it —
 * recoverable rather than a trap: a draft still holding `MY` resolves to `TH`
 * here, every line resolves to baht with it, and the next save succeeds.
 * Without it the form would post a country the server refuses, with no control
 * on screen to change it.
 */
export function effectiveClaimCountry(
  selected: string | null | undefined,
  brand: ClaimCurrencyBrand | null | undefined,
): string {
  const want = norm(selected);
  if (want === "" || want === DEFAULT_COUNTRY) return DEFAULT_COUNTRY;
  return claimCountryOptions(brand).indexOf(want) === -1 ? DEFAULT_COUNTRY : want;
}

/**
 * What one expense line's dropdown offers: **the country's currency, then
 * baht** — and **nothing at all for Thailand**.
 *
 * Two options rather than the brand's whole list, because the country is
 * already the answer to "which foreign money was spent here". A trip to
 * Malaysia buys ringgit and baht, not ringgit and pounds, and offering the
 * brand's other currencies would invite a line filed in one the requester never
 * held.
 *
 * Empty is the Thailand answer and it is load-bearing: no dropdown, no rate
 * column, no conversion note anywhere on the form.
 */
export function lineCurrencyOptions(country: string | null | undefined): string[] {
  const cur = currencyForCountry(country);
  if (cur === null || isBaht(cur)) return [];
  return [cur, THB];
}

/**
 * The currency one line is actually in.
 *
 * **A line with no recorded currency is in the country's currency, not baht.**
 * That is deliberate and it is the opposite of the request-level rule this
 * replaces. A requester who names Malaysia did so because they spent ringgit,
 * and the alternative — every line silently staying baht until each one is
 * changed by hand — is both more work and less visible: a THB line shows no
 * converted figure, so nothing on screen would mark the ones still to be fixed.
 * Switching a single line back to THB is one click, and the example this
 * feature was asked for has exactly that shape (a 20 MYR ride beside a 20 THB
 * ride).
 *
 * The same fallback catches a line holding a currency the country does not
 * offer — a draft whose country was changed, or a hand-shaped request. It
 * resolves to the country's currency rather than to baht for the same reason:
 * calling a foreign figure baht converts nothing and shows nothing, which is
 * the silent failure this whole feature exists to prevent.
 *
 * Thailand answers `THB` for everything, because `lineCurrencyOptions` is empty
 * there and there is no other money to be in.
 */
export function effectiveLineCurrency(
  selected: string | null | undefined,
  country: string | null | undefined,
): string {
  return resolveLineCurrency(selected, lineCurrencyOptions(country));
}

/**
 * The same rule, for a caller that already holds the option list.
 *
 * The form computes the options once per request and passes them down as
 * `LineCurrencyContext`; re-deriving them from the country in every row would be
 * a second path to the same answer, which is how the row and the save come to
 * disagree about what a line is in.
 */
export function resolveLineCurrency(
  selected: string | null | undefined,
  options: readonly string[],
): string {
  if (options.length === 0) return THB;
  const want = norm(selected);
  return options.indexOf(want) === -1 ? options[0] : want;
}

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
 * the other three null. No rate is consulted and no rounding is applied, so a
 * Thai claim's arithmetic is bit-identical to what it was before this feature
 * shipped — the same guarantee `lineFxOrThrow` gives on the server.
 *
 * **An unknown rate previews as 0, never as the unconverted figure.** Returning
 * the figure would show a ringgit number under a baht total. Zero is visibly
 * wrong beside the `—` the converted cell then shows, and it self-corrects: the
 * server fetches its own rate, and the reload after the save brings back the
 * real baht.
 */
export function lineMoney(
  typed: number,
  currency: string,
  rate: number | null,
): LineMoney {
  const n = Number.isFinite(typed) ? typed : 0;
  if (isBaht(currency)) {
    return { amount: n, currency: null, exchangeRate: null, foreignAmount: null };
  }
  return {
    amount: toBaht(n, rate) ?? 0,
    currency: norm(currency),
    exchangeRate: rate,
    foreignAmount: n,
  };
}

/** The figure a line's input shows: what was typed, in whichever field holds it. */
export function typedLineFigure(
  item: { amount: number; currency?: string | null; foreignAmount?: number | null },
  options: readonly string[],
): number {
  if (isBaht(resolveLineCurrency(item.currency, options))) return Number(item.amount) || 0;
  return Number(item.foreignAmount) || 0;
}
