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
  { route: "departments", tab: "departments" },
  {
    route: "departments/map",
    tab: "departments",
    // NOTE: this is the one granted route that writes outside the form
    // database — `saveDepartmentMappings` opens the core pool and writes
    // `DepartmentErpMap`, which lives in the database shared with the Rocks
    // Fast sibling. The plan's table grants it deliberately (a `departments`
    // tab that cannot save is the grant-that-grants-nothing this whole task
    // exists to remove), but it is the entry to revisit first if the shared
    // database ever needs protecting from a non-admin.
    note: "writes DepartmentErpMap in the shared core database — see the report",
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

/** Strip the query, any trailing slash and the settings prefix. */
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
 * Paths outside the prefix are not this module's business and are ignored, so
 * a caller can hand it the whole route tree.
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
