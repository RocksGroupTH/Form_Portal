/**
 * Which AP-1 settings tabs an admin may hand to an individual approver, and
 * which settings route each grant actually opens.
 *
 * `approvers` — the สิทธิ์เข้าถึง tab itself — is deliberately absent. Granting
 * it would let a non-admin approver grant themselves the rest.
 *
 * This module imports nothing so it can be unit-tested: anything reachable from
 * a database pool drags `@/env` in, which validates the whole environment at
 * import time and throws in the test runner. The half that needs a pool is
 * `./require-settings-tab`.
 */

/** The five keys an admin can tick. A literal union so a route cannot pass a
 *  string it built at runtime — see `requireSettingsTab`. */
export type GrantableSettingsTabKey =
  | "brands"
  | "sameDayBrand"
  | "vehicles"
  | "departments"
  | "erpInterface";

export const GRANTABLE_SETTINGS_TABS: readonly {
  key: GrantableSettingsTabKey;
  label: string;
}[] = [
  { key: "brands", label: "แบรนด์ที่เบิก" },
  { key: "sameDayBrand", label: "เบิกวันซ้ำข้ามแบรนด์" },
  { key: "vehicles", label: "พาหนะ & เรท" },
  { key: "departments", label: "แผนก (HR ↔ ERP)" },
  { key: "erpInterface", label: "Interface ERP" },
];

export function isGrantableSettingsTabKey(key: string): boolean {
  const k = key.trim();
  for (const t of GRANTABLE_SETTINGS_TABS) if (t.key === k) return true;
  return false;
}

/** Keep only known keys, trimmed, de-duplicated, in the caller's order. */
export function filterGrantableTabKeys(keys: string[]): string[] {
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (const raw of keys) {
    const k = String(raw).trim();
    if (isGrantableSettingsTabKey(k) && !seen[k]) {
      seen[k] = true;
      out.push(k);
    }
  }
  return out;
}

/* ── The decision ────────────────────────────────────────────────────────── */

/**
 * May this caller open this settings tab?
 *
 * Pure on purpose: the guard around it needs a session and a pool, and this is
 * the part worth pinning in tests.
 *
 * - an admin passes everything, `approvers` included — that is the role the
 *   grants are handed out from;
 * - a non-admin passes only a tab that is *both* grantable and in their list,
 *   so `approvers` fails even if a row for it somehow exists. `AccApproverSettingsTab`
 *   is shared with ACC Portal and has no CHECK constraint on `TabKey`, so a row
 *   naming any string can appear; the grantable test is what makes that inert.
 */
export function decideSettingsTabAccess(
  isAdmin: boolean,
  grantedTabs: string[],
  tab: string,
): boolean {
  if (isAdmin) return true;
  const wanted = String(tab).trim();
  if (!isGrantableSettingsTabKey(wanted)) return false;
  return filterGrantableTabKeys(grantedTabs).indexOf(wanted) !== -1;
}

/* ── Which route belongs to which tab ────────────────────────────────────── */

export const SETTINGS_ROUTE_PREFIX = "/api/request/accounting/settings";

export interface SettingsRouteTabRule {
  /** Path below `SETTINGS_ROUTE_PREFIX`, e.g. `"vehicles/reorder"`. */
  route: string;
  /** The grant that opens it, or `null` when it stays admin-only. */
  tab: GrantableSettingsTabKey | null;
  /** Why — required for every admin-only entry, and for anything non-obvious. */
  note?: string;
}

/**
 * Every route under `SETTINGS_ROUTE_PREFIX` and the grant that opens it.
 *
 * This is the same idea as `ROUTE_RULES` in `@/lib/form-environment/classify-path`:
 * a route with no entry here is a decision nobody has made, and
 * `unmappedSettingsRoutes` is what makes it visible instead of leaving it
 * silently admin-only forever. `settings-tabs.test.ts` walks the route tree and
 * fails on any gap, so adding a settings route without an entry breaks the test
 * run rather than shipping.
 *
 * A `null` entry is a deliberate decision, not an omission — say why in `note`.
 */
export const SETTINGS_ROUTE_TABS: readonly SettingsRouteTabRule[] = [
  { route: "brands", tab: "brands" },
  { route: "same-day-brand", tab: "sameDayBrand" },
  { route: "vehicles", tab: "vehicles" },
  { route: "vehicles/reorder", tab: "vehicles" },
  { route: "departments", tab: "departments", note: "the read half; the write below is not granted" },
  {
    route: "departments/map",
    tab: null,
    // The `departments` grant is read-only, ruled 2026-08-20. This was the one
    // granted route that wrote outside the form database, and what it writes is
    // not ours alone: `saveDepartmentMappings` opens the core pool and writes
    // `DepartmentErpMap`, which the Rocks Fast and ACC Portal siblings both read
    // from their own `erp-prep-service.ts` — the path that prepares financial
    // journal postings. A settings-tab grant should not decide where two other
    // applications post money, so the tab lists mappings and an admin saves them.
    note:
      "writes DepartmentErpMap in the shared configuration database, which two sibling "
      + "applications read to prepare financial journal postings",
  },
  { route: "erp-config", tab: "erpInterface", note: "repoints where financial journals land" },
  { route: "gl-accounts", tab: "erpInterface" },
  { route: "bank-accounts", tab: "erpInterface" },
  { route: "journal-batches", tab: "erpInterface" },
  { route: "branch-codes", tab: "erpInterface" },
  { route: "erp-accounts", tab: "erpInterface", note: "GET only" },
  {
    route: "erp-journal-template",
    tab: "erpInterface",
    // Its owner is not readable from the path: there is no `erpJournalTemplate`
    // tab. `ErpJournalTemplateSettings` renders inside `BrandErpInterfaceSettings`,
    // which is the Interface ERP tab, so that is the grant that must open it.
    note: "no tab of its own — renders inside BrandErpInterfaceSettings (Interface ERP)",
  },

  // Admin-only, whatever the viewer's tabs say.
  {
    route: "approvers",
    tab: null,
    note: "the tab that hands out access — granting it would let a non-admin grant themselves everything else",
  },
  {
    route: "departments/sync",
    tab: null,
    note: "pulls BC dimension values into the ERP reporting database shared with Rocks Fast",
  },
  {
    route: "erp-accounts/sync",
    tab: null,
    note: "pulls BC accounts, bank cards, journal batches and branches into the ERP reporting database shared with Rocks Fast",
  },
];

/**
 * A route path reduced to the form `SETTINGS_ROUTE_TABS` keys on, or `null` if
 * it names nothing under the settings prefix.
 *
 * Two input shapes, deliberately:
 *
 * - **absolute** — anything starting with `/` must be `SETTINGS_ROUTE_PREFIX`
 *   or below it, and everything else answers `null`. That is what lets a caller
 *   hand over the whole route tree;
 * - **relative** — anything else is taken as *already* below the prefix, which
 *   is the shape the filesystem walk in `settings-tabs.test.ts` produces
 *   (`"vehicles/reorder"`). It is not validated further: a relative path this
 *   module has never heard of is exactly what `unmappedSettingsRoutes` is for.
 *
 * The query string and any trailing slash are stripped from both.
 */
function normalizeSettingsRoute(routePath: string): string | null {
  const p = String(routePath).split("?")[0].replace(/\/+$/, "");
  if (p === SETTINGS_ROUTE_PREFIX) return "";
  if (p.indexOf(SETTINGS_ROUTE_PREFIX + "/") === 0) {
    return p.slice(SETTINGS_ROUTE_PREFIX.length + 1);
  }
  // Already relative — `"vehicles/reorder"`.
  if (p.charAt(0) !== "/") return p;
  return null;
}

/** The rule for a settings route, or `null` when nobody has mapped it. */
export function settingsTabRuleForRoute(routePath: string): SettingsRouteTabRule | null {
  const rel = normalizeSettingsRoute(routePath);
  if (rel === null) return null;
  for (const rule of SETTINGS_ROUTE_TABS) if (rule.route === rel) return rule;
  return null;
}

/**
 * Of the given route paths, the ones under `SETTINGS_ROUTE_PREFIX` that
 * `SETTINGS_ROUTE_TABS` says nothing about.
 *
 * An **absolute** path outside the prefix is not this module's business and is
 * ignored, so a caller can hand it the whole route tree. A **relative** path is
 * taken as already being below the prefix — see `normalizeSettingsRoute` — so
 * `"something-new"` is reported rather than skipped.
 */
export function unmappedSettingsRoutes(routePaths: string[]): string[] {
  const out: string[] = [];
  for (const raw of routePaths) {
    const rel = normalizeSettingsRoute(raw);
    if (rel === null) continue;
    if (settingsTabRuleForRoute(rel)) continue;
    if (out.indexOf(rel) === -1) out.push(rel);
  }
  return out;
}
