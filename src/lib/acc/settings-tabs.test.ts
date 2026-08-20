import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GRANTABLE_SETTINGS_TABS,
  SETTINGS_ROUTE_TABS,
  decideSettingsTabAccess,
  filterGrantableTabKeys,
  isGrantableSettingsTabKey,
  settingsTabRuleForRoute,
  unmappedSettingsRoutes,
} from "./settings-tabs";

test("exactly five tabs are grantable", () => {
  assert.equal(GRANTABLE_SETTINGS_TABS.length, 5);
  assert.deepEqual(
    GRANTABLE_SETTINGS_TABS.map((t) => t.key),
    ["brands", "sameDayBrand", "vehicles", "departments", "erpInterface"],
  );
});

test("the approvers tab is never grantable", () => {
  assert.equal(isGrantableSettingsTabKey("approvers"), false);
  assert.deepEqual(filterGrantableTabKeys(["approvers"]), []);
});

test("filterGrantableTabKeys trims, drops unknowns and de-duplicates", () => {
  assert.deepEqual(
    filterGrantableTabKeys([" brands ", "brands", "nope", "vehicles"]),
    ["brands", "vehicles"],
  );
});

test("filterGrantableTabKeys preserves the caller's order", () => {
  assert.deepEqual(
    filterGrantableTabKeys(["vehicles", "brands"]),
    ["vehicles", "brands"],
  );
});

test("an empty list stays empty", () => {
  assert.deepEqual(filterGrantableTabKeys([]), []);
});

/* ── decideSettingsTabAccess ─────────────────────────────────────────────── */

test("an admin passes every tab, including the one nobody can be granted", () => {
  for (const t of GRANTABLE_SETTINGS_TABS) {
    assert.equal(decideSettingsTabAccess(true, [], t.key), true);
  }
  assert.equal(decideSettingsTabAccess(true, [], "approvers"), true);
});

test("a non-admin passes only the tabs they hold", () => {
  assert.equal(decideSettingsTabAccess(false, ["vehicles"], "vehicles"), true);
  assert.equal(decideSettingsTabAccess(false, ["vehicles"], "brands"), false);
});

test("a non-admin with no grants passes nothing", () => {
  for (const t of GRANTABLE_SETTINGS_TABS) {
    assert.equal(decideSettingsTabAccess(false, [], t.key), false);
  }
});

test("approvers fails for a non-admin however the grant list is spelled", () => {
  assert.equal(decideSettingsTabAccess(false, ["approvers"], "approvers"), false);
  assert.equal(
    decideSettingsTabAccess(false, ["approvers", "vehicles", "brands"], "approvers"),
    false,
  );
  // A row naming any string can reach AccApproverSettingsTab — ACC Portal
  // shares the table and there is no CHECK on TabKey.
  assert.equal(decideSettingsTabAccess(false, ["*"], "approvers"), false);
  assert.equal(decideSettingsTabAccess(false, ["*"], "vehicles"), false);
});

test("an unknown tab is refused even when the grant list names it", () => {
  assert.equal(decideSettingsTabAccess(false, ["nope"], "nope"), false);
});

test("whitespace around the tab does not change the answer", () => {
  assert.equal(decideSettingsTabAccess(false, [" vehicles "], " vehicles "), true);
});

/* ── SETTINGS_ROUTE_TABS ─────────────────────────────────────────────────── */

test("every settings route on disk is mapped", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const root = path.resolve(__dirname, "../../app/api/request/accounting/settings");

  const walk = async (dir: string, rel: string): Promise<string[]> => {
    const out: string[] = [];
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const next = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), next)));
      else if (e.name === "route.ts") out.push(rel);
    }
    return out;
  };

  const routes = await walk(root, "");
  assert.ok(routes.length >= 16, `expected the settings route tree, found ${routes.length}`);
  assert.deepEqual(
    unmappedSettingsRoutes(routes),
    [],
    "add an entry to SETTINGS_ROUTE_TABS for each route listed here",
  );
});

test("SETTINGS_ROUTE_TABS maps nothing that is not a real route", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const root = path.resolve(__dirname, "../../app/api/request/accounting/settings");

  for (const rule of SETTINGS_ROUTE_TABS) {
    const file = path.join(root, rule.route, "route.ts");
    await fs.access(file);
  }
});

test("the three admin-only routes are the ones that must never be granted", () => {
  const adminOnly = SETTINGS_ROUTE_TABS.filter((r) => r.tab === null).map((r) => r.route);
  assert.deepEqual(adminOnly, ["approvers", "departments/sync", "erp-accounts/sync"]);
  for (const rule of SETTINGS_ROUTE_TABS) {
    if (rule.tab === null) assert.ok(rule.note, `${rule.route} must say why it is admin-only`);
  }
});

test("every mapped tab is one an admin can actually tick", () => {
  for (const rule of SETTINGS_ROUTE_TABS) {
    if (rule.tab !== null) assert.equal(isGrantableSettingsTabKey(rule.tab), true);
  }
});

test("a settings route with no rule is reported, by absolute or relative path", () => {
  assert.deepEqual(
    unmappedSettingsRoutes([
      "/api/request/accounting/settings/brands",
      "/api/request/accounting/settings/something-new",
      "vehicles/reorder",
      "/api/request/accounting/requests/mine",
    ]),
    ["something-new"],
  );
});

test("settingsTabRuleForRoute answers for both path shapes and unknowns", () => {
  assert.equal(settingsTabRuleForRoute("erp-journal-template")?.tab, "erpInterface");
  assert.equal(
    settingsTabRuleForRoute("/api/request/accounting/settings/vehicles/reorder")?.tab,
    "vehicles",
  );
  assert.equal(settingsTabRuleForRoute("approvers")?.tab, null);
  assert.equal(settingsTabRuleForRoute("nothing-here"), null);
  assert.equal(settingsTabRuleForRoute("/api/settings/users"), null);
});
