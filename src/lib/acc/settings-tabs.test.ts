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

const SETTINGS_ROOT = "../../app/api/request/accounting/settings";

/** Every settings route on disk, as a path relative to the settings prefix. */
async function walkSettingsRoutes(): Promise<string[]> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const root = path.resolve(__dirname, SETTINGS_ROOT);

  const walk = async (dir: string, rel: string): Promise<string[]> => {
    const out: string[] = [];
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const next = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), next)));
      // `.tsx` too: a route file is still a route file, and matching only
      // `route.ts` would let one slip past every check below.
      else if (e.name === "route.ts" || e.name === "route.tsx") out.push(rel);
    }
    return out;
  };

  return walk(root, "");
}

/** The `route.ts`/`route.tsx` source for a mapped route. */
async function readRouteFile(route: string): Promise<string> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const root = path.resolve(__dirname, SETTINGS_ROOT);
  for (const name of ["route.ts", "route.tsx"]) {
    try {
      return await fs.readFile(path.join(root, route, name), "utf8");
    } catch {
      /* try the other extension */
    }
  }
  throw new Error(`SETTINGS_ROUTE_TABS maps "${route}", which is not a route on disk`);
}

test("every settings route on disk is mapped", async () => {
  const routes = await walkSettingsRoutes();
  assert.ok(routes.length >= 16, `expected the settings route tree, found ${routes.length}`);
  assert.deepEqual(
    unmappedSettingsRoutes(routes),
    [],
    "add an entry to SETTINGS_ROUTE_TABS for each route listed here",
  );
});

test("SETTINGS_ROUTE_TABS maps nothing that is not a real route", async () => {
  // Without this the loop below passes vacuously on an empty table.
  assert.ok(
    SETTINGS_ROUTE_TABS.length >= 16,
    `expected the settings route table, found ${SETTINGS_ROUTE_TABS.length}`,
  );
  for (const rule of SETTINGS_ROUTE_TABS) {
    await readRouteFile(rule.route);
  }
});

test("the admin-only routes are the ones that must never be granted", () => {
  const adminOnly = SETTINGS_ROUTE_TABS.filter((r) => r.tab === null).map((r) => r.route);
  assert.deepEqual(adminOnly, [
    // Ruled 2026-08-20: the `departments` grant is read-only. This write
    // reaches `DepartmentErpMap` in the shared configuration database, which
    // two sibling applications read to prepare financial journal postings.
    "departments/map",
    "approvers",
    "departments/sync",
    "erp-accounts/sync",
  ]);
  for (const rule of SETTINGS_ROUTE_TABS) {
    if (rule.tab === null) assert.ok(rule.note, `${rule.route} must say why it is admin-only`);
  }
});

/* ── …and the table is a control, not a parallel copy ────────────────────── */

/**
 * The first gate call in a handler body: `requireSettingsTab("<tab>")`, or
 * `requireRole(` for an admin-only route.
 */
const GATE = /await (requireSettingsTab\(\s*"([A-Za-z]+)"\s*\)|requireRole\()/;

/** Each exported HTTP handler in a route file, as `[method, body-from-here]`. */
function splitHandlers(source: string): { method: string; body: string }[] {
  const decl = /export async function (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/g;
  const starts: { method: string; at: number }[] = [];
  let m = decl.exec(source);
  while (m) {
    starts.push({ method: m[1], at: m.index });
    m = decl.exec(source);
  }
  return starts.map((s, i) => ({
    method: s.method,
    body: source.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : source.length),
  }));
}

test("every settings handler opens with the gate its table entry names", async () => {
  // `SETTINGS_ROUTE_TABS` used to be documentation: the tab that governs a
  // route was declared in the route's own literal and copied here, so the
  // detector caught a *new unmapped file* and nothing else — not a route gated
  // with the wrong tab, and not one left ungated. This reads the source and
  // makes the table answer for what each route actually does.
  let handlerCount = 0;

  for (const rule of SETTINGS_ROUTE_TABS) {
    const source = await readRouteFile(rule.route);
    const handlers = splitHandlers(source);
    assert.ok(handlers.length > 0, `${rule.route} exports no HTTP handler`);

    for (const h of handlers) {
      handlerCount += 1;
      const found = GATE.exec(h.body);
      assert.ok(found, `${rule.route} ${h.method} is not gated at all`);

      if (rule.tab === null) {
        assert.ok(
          found[1].indexOf("requireRole(") === 0,
          `${rule.route} ${h.method} is admin-only in the table but does not call requireRole`,
        );
      } else {
        assert.equal(
          found[2],
          rule.tab,
          `${rule.route} ${h.method} is gated on "${found[2]}" but the table says "${rule.tab}"`,
        );
      }

      // The gate must be the handler's first `await`: a check that runs after
      // the work is not a gate. `requireAuth`/`requireRole` inside
      // `requireSettingsTab` is what proves the session, so nothing legitimate
      // needs to precede it.
      assert.equal(
        h.body.indexOf("await "),
        found.index,
        `${rule.route} ${h.method} does something before its gate`,
      );

      // …and the refusal must be returned. Both gates answer with *either* a
      // session or the `Response` to send, so a handler that calls the gate and
      // drops its result is ungated while looking gated — and every assertion
      // above would still pass. All 28 check it today.
      assert.ok(
        h.body.indexOf("instanceof Response) return") !== -1,
        `${rule.route} ${h.method} calls its gate but never returns the refusal`,
      );
    }
  }

  // The review enumerated these by hand. Pinning the count means a new handler
  // on an existing route has to be looked at rather than merged on the strength
  // of the file already having an entry.
  assert.equal(
    handlerCount,
    28,
    "the settings routes gained or lost a handler — check its gate, then update this number",
  );
});

test("no settings route mixes the two gates in one handler", async () => {
  for (const rule of SETTINGS_ROUTE_TABS) {
    const source = await readRouteFile(rule.route);
    for (const h of splitHandlers(source)) {
      const tabbed = h.body.indexOf("requireSettingsTab(") !== -1;
      const roled = h.body.indexOf("requireRole(") !== -1;
      assert.ok(
        tabbed !== roled,
        `${rule.route} ${h.method} calls both gates, or neither`,
      );
    }
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
