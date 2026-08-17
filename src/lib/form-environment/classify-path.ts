/**
 * Maps a request path to the form whose database it should use.
 *
 * This table is load-bearing. Per-form routing picks the database from the URL,
 * so a path classified wrongly — or a route added later and never classified —
 * reads or writes the wrong database with no error to reveal it. The settings
 * page at /settings/form-environment runs a coverage check against this same
 * table so an unclassified route surfaces there instead of failing silently.
 *
 * Pure: no I/O, no request context. Exhaustively tested in classify-path.test.ts.
 */

export type FormCode = "AP-1" | "AP-15" | "AP-17";

/** Every form code, as values — the runtime half of the `FormCode` union. */
export const FORM_CODES: readonly FormCode[] = ["AP-1", "AP-15", "AP-17"];

/**
 * Narrow caller-supplied text to a known form code.
 *
 * Anything reaching `getFormSwitchMap()`'s record with an arbitrary string is a
 * lookup into an object the caller half-controls, so a `?form=` query value is
 * checked here before it is used as a key. Unknown text is not an error — the
 * caller drops the hint and falls back to path classification.
 *
 * Pure and client-safe.
 */
export function isFormCode(value: string | null | undefined): value is FormCode {
  return !!value && FORM_CODES.indexOf(value as FormCode) !== -1;
}

/** "BOTH" = an aggregate endpoint that must read every database and merge. */
export type PathClass = FormCode | "BOTH" | null;

export interface RouteRule {
  prefix: string;
  result: PathClass;
}

/**
 * Longest matching prefix wins, so the order below is documentation rather
 * than behaviour — it is kept in specificity order to stay readable.
 *
 * The three AP-17 entries under /request/accounting/ are the subtle ones:
 * AP-17's admin pages live underneath AP-1's prefix, and without them those
 * pages route to the wrong database.
 */
export const ROUTE_RULES: RouteRule[] = [
  // AP-17 admin pages that sit under AP-1's prefix. Listed individually rather
  // than matched by a separator hack, so /request/accounting-anything cannot
  // accidentally match one of them.
  { prefix: "/request/accounting/travel-booking", result: "AP-17" },
  { prefix: "/request/accounting/travel-booking-report", result: "AP-17" },
  { prefix: "/request/accounting/travel-booking-settings", result: "AP-17" },

  // Aggregate endpoints — more specific than the AP-1 catch-all further down.
  // Only what a person owns or must act on merges: they can hold live requests
  // in one database and test requests in the other at the same time.
  { prefix: "/api/request/accounting/requests/mine", result: "BOTH" },
  { prefix: "/api/request/accounting/work", result: "BOTH" },
  { prefix: "/api/request/accounting/requesters", result: "BOTH" },

  // ERP prep is not an aggregate. It is the only path that posts to Business
  // Central, and the send reads its rows from one pool — so the queue, the
  // journal and the BC target have to agree on a database. It follows AP-1,
  // whose travel-expense claims are what the queue is made of.
  { prefix: "/api/request/accounting/erp-prep", result: "AP-1" },

  // Settings read production; dual-write happens in the service layer.
  { prefix: "/api/request/accounting/settings", result: null },

  // New Item Inventory (AP-15) exists only as brand-scoped lookups so far, and
  // those read Fast_Core, never the form database. Listed so the coverage check
  // reports a decision rather than an omission. When the form itself lands and
  // starts writing AccRequest rows, this becomes "AP-15".
  { prefix: "/api/request/new-item-inventory", result: null },

  // AP-17 proper.
  { prefix: "/api/request/travel-booking", result: "AP-17" },
  { prefix: "/request/travel-booking", result: "AP-17" },

  // AP-1 proper.
  { prefix: "/api/request/accounting", result: "AP-1" },
  { prefix: "/request/accounting", result: "AP-1" },
  { prefix: "/request/travel-expense", result: "AP-1" },
];

/** True when `path` is `prefix` itself or a segment below it. */
function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + "/");
}

/**
 * The rule that governs a path, or null when no rule covers it.
 *
 * `classifyPath` collapses two different situations into null: a rule that
 * deliberately says Production (the settings prefix) and a path nothing matches.
 * Routing does not care about the difference, but the coverage check does —
 * flagging the sixteen deliberate settings routes as "unclassified" would bury
 * the one route that genuinely has no rule.
 */
export function matchRule(path: string | null | undefined): RouteRule | null {
  if (!path) return null;

  const p = path.split("?")[0].replace(/\/+$/, "") || "/";

  let best: RouteRule | null = null;
  for (const rule of ROUTE_RULES) {
    if (matchesPrefix(p, rule.prefix)) {
      if (!best || rule.prefix.length > best.prefix.length) best = rule;
    }
  }
  return best;
}

/**
 * Classify a request path.
 *
 * Returns null when the path is not form-specific — Form Builder, settings,
 * dashboards, anything else. Callers treat null as Production.
 */
export function classifyPath(path: string | null | undefined): PathClass {
  const rule = matchRule(path);
  return rule ? rule.result : null;
}
