/**
 * Which country an OpenRouteService place search is bounded to.
 *
 * **Imports nothing, and must stay that way.** `ors.ts` reaches the API-key
 * registry and therefore a pool; `@/env` validates the whole environment at
 * import. Keeping the rule here is what lets it be unit-tested with no
 * environment at all, and it is the same constraint `codes.ts` and
 * `country-currency.ts` record for themselves.
 *
 * AP-17's place fields went worldwide on 2026-08-31; AP-1's map picker did
 * not — its fuel distances are Thai routes and a London result in that
 * autocomplete would be noise. So "no country given" has to keep meaning
 * Thailand, which is why the default is a value rather than `null`.
 */

/** What a caller that says nothing gets: today's behaviour, unchanged. */
export const ORS_DEFAULT_COUNTRY = "TH";

/**
 * Ask for no boundary at all. Not a country code, so it cannot collide with
 * one, and not the empty string, which a query string cannot tell from absent.
 */
export const ORS_WORLDWIDE = "*";

/**
 * The country to bound a search to, or `null` for the whole world.
 *
 * The country arrives from a query string and is interpolated into an upstream
 * URL, so this is a gate, not a formatter: **anything not positively recognised
 * becomes `TH`**. That narrows a search rather than widening one, and it never
 * forwards arbitrary text to OpenRouteService. A caller asking for the world
 * has to say so with the sentinel.
 */
export function resolveOrsCountry(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (v === ORS_WORLDWIDE) return null;
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  return ORS_DEFAULT_COUNTRY;
}
