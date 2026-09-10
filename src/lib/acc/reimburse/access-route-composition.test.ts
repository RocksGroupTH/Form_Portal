import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Proves `GET /api/request/reimburse/access` derives `settingsTabs` from the
 * raw stored grant list through `filterGrantableReimburseTabKeys`, rather
 * than assigning the raw union straight through.
 *
 * The route cannot be imported and exercised directly: `route.ts` imports
 * `resolveReimburseTabsByEmail` from `access-tabs.ts`, which imports
 * `@/lib/acc/pool` → `@/env`, and `@/env` validates the whole environment at
 * import time — it throws in this suite, which has no live database and no
 * `.env.local`. So, following the same technique
 * `settings-route-gates.test.ts` already uses for the other AP-4 settings
 * routes, this reads the route's SOURCE FILE as text and asserts on its
 * contents. That sidesteps the import-time problem WITHOUT a live database
 * dependency — it never runs the handler, it reads what the handler's code
 * actually says.
 *
 * The hazard this guards: `resolveReimburseTabsByEmail` now returns the
 * UNION of settings-tab and menu keys (`filterStorableReimburseKeys`, task 2
 * step 1). If the route assigned that union straight to `settingsTabs` —
 * `const settingsTabs = granted;` — instead of re-narrowing it, a person
 * granted a menu key ALONE would get a non-empty `settingsTabs`, and
 * `canSettings` would flip true, handing them the whole AP-4 settings page.
 * A prior version of this file re-implemented the route's two lines as local
 * helper functions instead of reading the route itself, which meant it could
 * never fail on this regression — reverting the real route line changed
 * nothing the test looked at. Confirmed by actually reverting it locally: see
 * this task's fix report for what was observed.
 */

const ROUTE_PATH = "../../../app/api/request/reimburse/access/route.ts";

async function readRouteSource(): Promise<string> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  return fs.readFile(path.resolve(__dirname, ROUTE_PATH), "utf8");
}

test("settingsTabs is derived through filterGrantableReimburseTabKeys, not the raw union", async () => {
  const source = await readRouteSource();
  assert.match(
    source,
    /const\s+settingsTabs\s*=\s*filterGrantableReimburseTabKeys\(\s*granted\s*\)\s*;/,
    "the route must narrow `granted` through filterGrantableReimburseTabKeys before naming it settingsTabs",
  );
});

test("settingsTabs is never assigned the raw granted list directly — the exact hazard-2 regression", async () => {
  const source = await readRouteSource();
  assert.doesNotMatch(
    source,
    /const\s+settingsTabs\s*=\s*granted\s*;/,
    "settingsTabs must never be the raw union — a menu-only grant would then read as a settings-tab grant",
  );
});

test("canSettings is computed from the narrowed settingsTabs, never from granted directly", async () => {
  const source = await readRouteSource();
  assert.match(
    source,
    /const\s+canSettings\s*=\s*admin\s*\|\|\s*settingsTabs\.length\s*>\s*0\s*;/,
    "canSettings must read settingsTabs.length — reading granted.length would let a menu-only grant flip it on",
  );
  // The narrow settings-tab filter is imported by name, not aliased or
  // reimplemented inline — grep-ability is what lets a reviewer trust the
  // regex above rather than re-deriving it from scratch each time.
  assert.match(
    source,
    /import\s*\{[^}]*\bfilterGrantableReimburseTabKeys\b[^}]*\}\s*from\s*"@\/lib\/acc\/reimburse\/settings-tabs"/,
    "filterGrantableReimburseTabKeys must be imported from settings-tabs, not redefined locally",
  );
});

/**
 * A third call site, `POST /api/request/reimburse/settings/access`, writes
 * the body's `settingsTabs` field (which, despite the name, now carries menu
 * keys too — see that route's docblock) into `AccReimburseAccessTab` through
 * `setReimburseAccessTabs`. That function applies the WIDE filter
 * (`filterStorableReimburseKeys`) itself, so a menu key must reach it intact.
 * Pre-filtering with the NARROW, settings-tab-only filter before the call —
 * `filterGrantableReimburseTabKeys` — strips a menu key before the wide
 * filter downstream ever sees it, so nothing is ever stored: no error, no
 * empty-array edge case, just a tick that silently saves nothing. Confirmed
 * locally the same way as the assertions above: temporarily narrowing this
 * call's filter turned this test red, then it was reverted (see the fix
 * report).
 */
const GRANT_ROUTE_PATH =
  "../../../app/api/request/reimburse/settings/access/route.ts";

async function readGrantRouteSource(): Promise<string> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  return fs.readFile(path.resolve(__dirname, GRANT_ROUTE_PATH), "utf8");
}

test("settings/access POST pre-filters settingsTabs with the WIDE filter before storing it", async () => {
  const source = await readGrantRouteSource();
  assert.match(
    source,
    /setReimburseAccessTabs\(\s*accessId,\s*filterStorableReimburseKeys\(/,
    "must pass the union filter into setReimburseAccessTabs, or a ticked menu key is stripped before the wide filter downstream ever sees it",
  );
  assert.doesNotMatch(
    source,
    /setReimburseAccessTabs\(\s*accessId,\s*filterGrantableReimburseTabKeys\(/,
    "must not pre-narrow settingsTabs with the settings-tab-only filter before the call",
  );
});

/**
 * `access-tabs.ts` applies its filter on BOTH sides of the round trip, and
 * both must be the WIDE one — which is exactly the regression the plan quotes
 * from AP-17, where the same filter was narrowed on read and on write and a
 * ticked menu key therefore saved nothing at all.
 *
 * The READ half is the one with no other guard on it, and narrowing it is
 * completely silent: every menu tick would still save (the write half is
 * covered above, and by `setReimburseAccessTabs` applying the union itself),
 * and then render unticked forever — the admin grid, `/access`'s
 * `approvalQueue` flag and the approvals route's gate all read through this
 * one function. Confirmed by measurement, not by reasoning: with
 * `loadReimburseTabsByAccessIds`'s filter reverted to
 * `filterGrantableReimburseTabKeys`, `npm test` reported 1300 pass, 0 fail.
 *
 * Both call sites are asserted by counting, so a THIRD narrowing added later
 * is caught too — checking that the wide name merely appears would pass on a
 * file where one of the two had been swapped.
 */
const ACCESS_TABS_PATH = "./access-tabs.ts";

async function readAccessTabsSource(): Promise<string> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  return fs.readFile(path.resolve(__dirname, ACCESS_TABS_PATH), "utf8");
}

test("loadReimburseTabsByAccessIds narrows the STORED rows with the wide filter, not the grantable one", async () => {
  const source = await readAccessTabsSource();
  assert.match(
    source,
    /map\.set\(\s*id,\s*filterStorableReimburseKeys\(/,
    "the read half of access-tabs.ts must return tabs ∪ menus. Narrowed to " +
      "filterGrantableReimburseTabKeys, every menu tick saves and then reads back missing — the " +
      "settings grid renders it unticked forever, /access reports approvalQueue false, and the " +
      "approvals route refuses the person it was granted to. Nothing errors and no other test " +
      "goes red; this is the AP-17 regression the plan quotes",
  );
});

test("neither half of access-tabs.ts narrows with the grantable-tab filter", async () => {
  const source = await readAccessTabsSource();
  assert.doesNotMatch(
    source,
    /\bfilterGrantableReimburseTabKeys\s*\(/,
    "access-tabs.ts must never CALL the settings-tab-only filter: it is the storage layer, and " +
      "both directions carry the union. Narrowing is the job of each authorization surface, on " +
      "the way out",
  );
  const wideCalls = source.match(/\bfilterStorableReimburseKeys\s*\(/g) ?? [];
  assert.equal(
    wideCalls.length,
    2,
    "access-tabs.ts should apply filterStorableReimburseKeys exactly twice — once on the read " +
      "(loadReimburseTabsByAccessIds) and once on the write (setReimburseAccessTabs). Found " +
      `${wideCalls.length}. If a third legitimate call site was added, raise this number ` +
      "deliberately; if one vanished, that half is no longer filtered at all",
  );
});
