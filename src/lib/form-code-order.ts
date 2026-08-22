/**
 * The order form cards appear in: by form number, so AP-1 · AP-4 · AP-17.
 *
 * The obvious answer — sort the badge strings — gives AP-1 · AP-17 · AP-4,
 * because "17" sorts before "4" one character at a time. That is what both
 * surfaces used to show, since each was a hand-kept array whose order *was* the
 * page: `ACCOUNTING_FORMS` (`src/features/home/HomeCatalogue.tsx`) for Home and
 * `REQUEST_CARDS` (`src/lib/constants.ts`) for the Request hub and Accounting
 * Admin. Two lists, kept in step by hand, is exactly the arrangement that drifts.
 *
 * So the rule lives here instead and both surfaces sort through it. A new form
 * lands in the right place on every surface by having a badge, with nobody
 * counting rows.
 *
 * Imports nothing, so it is unit-tested without pulling in the app.
 */

/** `AP-17` → `{ prefix: "AP", number: 17 }`. Null for anything else. */
export function parseFormCode(code: string | null | undefined): {
  prefix: string;
  number: number;
} | null {
  if (typeof code !== "string") return null;
  const m = /^([A-Za-z]+)-(\d+)$/.exec(code.trim());
  if (!m) return null;
  const number = Number(m[2]);
  if (!Number.isSafeInteger(number)) return null;
  return { prefix: m[1].toUpperCase(), number };
}

/**
 * Comparator for two form codes: prefix first (so a future `HR-2` never
 * interleaves with the `AP-` forms), then the number as a number.
 *
 * Anything unparseable — a missing badge, a code in some other shape — sorts
 * last and ties at 0 against another unparseable, so `Array.prototype.sort`,
 * which is stable, leaves those in the order the source list had them. A card
 * with no form code is not evidence about where it belongs; the least
 * surprising thing is to leave it where its author put it.
 */
export function compareFormCodes(a: string | null | undefined, b: string | null | undefined): number {
  const pa = parseFormCode(a);
  const pb = parseFormCode(b);
  if (!pa && !pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;
  if (pa.prefix !== pb.prefix) return pa.prefix < pb.prefix ? -1 : 1;
  return pa.number - pb.number;
}

/**
 * `items` sorted by each one's form code, as a new array — callers pass module
 * constants, and sorting one of those in place would reorder it for everybody
 * else that imports it, permanently and at import time.
 */
export function sortByFormCode<T>(items: readonly T[], codeOf: (item: T) => string | null | undefined): T[] {
  return items.slice().sort((x, y) => compareFormCodes(codeOf(x), codeOf(y)));
}
