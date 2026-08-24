import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GRANTABLE_BOOKING_TABS,
  decideBookingTabAccess,
  filterGrantableBookingTabKeys,
  isGrantableBookingTabKey,
} from "./settings-tabs";

/* ── The list ────────────────────────────────────────────────────────────── */

test("exactly four booking tabs are grantable, in the page's order", () => {
  assert.equal(GRANTABLE_BOOKING_TABS.length, 4);
  assert.deepEqual(
    GRANTABLE_BOOKING_TABS.map((t) => t.key),
    ["reasons", "accommodations", "vehicles", "rent-vehicles"],
  );
});

// The labels come from travel-booking-settings/page.tsx, not from the keys.
// `vehicles` is labelled การเดินทาง there — pinning it stops a later hand
// "correcting" it to พาหนะ and desynchronising the checkbox list from the tabs.
test("the labels are the settings page's own", () => {
  assert.deepEqual(
    GRANTABLE_BOOKING_TABS.map((t) => t.label),
    ["เหตุผลการเดินทาง", "ที่พัก", "การเดินทาง", "เช่ายานพาหนะ"],
  );
});

/* ── `access` is never grantable ─────────────────────────────────────────── */

test("the access tab is never grantable", () => {
  assert.equal(isGrantableBookingTabKey("access"), false);
  assert.deepEqual(filterGrantableBookingTabKeys(["access"]), []);
  for (const t of GRANTABLE_BOOKING_TABS) assert.notEqual(t.key, "access");
});

test("the approvers route is not a grantable tab either", () => {
  assert.equal(isGrantableBookingTabKey("approvers"), false);
  assert.deepEqual(filterGrantableBookingTabKeys(["approvers"]), []);
});

// The grant table has no CHECK on TabKey and is dual-written from more than one
// place, so a row naming `access` can exist. It must stay inert.
test("a non-admin is refused access whatever the grant list says", () => {
  assert.equal(decideBookingTabAccess(false, ["access"], "access"), false);
  assert.equal(
    decideBookingTabAccess(
      false,
      ["reasons", "accommodations", "vehicles", "rent-vehicles", "access"],
      "access",
    ),
    false,
  );
  assert.equal(decideBookingTabAccess(false, ["access"], " access "), false);
});

test("an access row does not poison the real grants beside it", () => {
  assert.equal(decideBookingTabAccess(false, ["access", "vehicles"], "vehicles"), true);
  assert.equal(decideBookingTabAccess(false, ["access", "vehicles"], "access"), false);
});

test("an admin passes access", () => {
  assert.equal(decideBookingTabAccess(true, [], "access"), true);
});

/* ── filterGrantableBookingTabKeys ───────────────────────────────────────── */

test("filterGrantableBookingTabKeys trims, drops unknowns and de-duplicates", () => {
  assert.deepEqual(
    filterGrantableBookingTabKeys([" reasons ", "reasons", "nope", "rent-vehicles"]),
    ["reasons", "rent-vehicles"],
  );
});

test("filterGrantableBookingTabKeys preserves the caller's order", () => {
  assert.deepEqual(
    filterGrantableBookingTabKeys(["vehicles", "reasons"]),
    ["vehicles", "reasons"],
  );
});

test("an empty list stays empty", () => {
  assert.deepEqual(filterGrantableBookingTabKeys([]), []);
});

test("every grantable key survives its own filter", () => {
  const all = GRANTABLE_BOOKING_TABS.map((t) => t.key as string);
  assert.deepEqual(filterGrantableBookingTabKeys(all), all);
});

/* ── decideBookingTabAccess ──────────────────────────────────────────────── */

test("an admin passes every tab", () => {
  for (const t of GRANTABLE_BOOKING_TABS) {
    assert.equal(decideBookingTabAccess(true, [], t.key), true);
  }
});

test("a non-admin with no grants passes nothing", () => {
  for (const t of GRANTABLE_BOOKING_TABS) {
    assert.equal(decideBookingTabAccess(false, [], t.key), false);
  }
  assert.equal(decideBookingTabAccess(false, [], "access"), false);
});

test("a non-admin passes only the tabs they hold", () => {
  assert.equal(decideBookingTabAccess(false, ["vehicles"], "vehicles"), true);
  assert.equal(decideBookingTabAccess(false, ["vehicles"], "reasons"), false);
});

test("an unknown tab is refused however it is spelled", () => {
  assert.equal(decideBookingTabAccess(false, ["vehicles"], "nope"), false);
  assert.equal(decideBookingTabAccess(false, ["vehicles"], ""), false);
  assert.equal(decideBookingTabAccess(false, ["vehicles"], "__proto__"), false);
  assert.equal(decideBookingTabAccess(false, ["vehicles"], "Vehicles"), false);
});

test("a padded tab name is still matched against a padded grant", () => {
  assert.equal(decideBookingTabAccess(false, [" vehicles "], " vehicles "), true);
});

/* ── The routes are gated, and gated in the right order ──────────────────── */

/*
 * A route-shape control, the same kind `@/lib/acc/settings-tabs.test.ts` runs
 * over AP-1's settings tree. It reads the source of every route under
 * `/api/request/travel-booking/settings/` and fails on a handler with no gate —
 * the failure it exists to prevent is a fifth settings route added later with
 * neither `requireBookingSettingsTab` nor `requireRole` on it, which no unit
 * test of the pure decision could ever notice.
 *
 * It also pins the thing that is specific to AP-17: the tab comes from the URL,
 * so the gate must be handed the value `isSettingsKind` narrowed, and the only
 * `await` allowed before it is `await params`.
 */

const SETTINGS_ROOT = "../../../app/api/request/travel-booking/settings";

/** Every settings route on disk, as a path relative to the settings prefix. */
async function walkBookingSettingsRoutes(): Promise<string[]> {
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

  return (await walk(root, "")).sort();
}

async function readBookingRouteFile(route: string): Promise<string> {
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
  throw new Error(`"${route}" is not a route on disk`);
}

/**
 * The first gate call in a handler body: `requireBookingSettingsTab(<ident>)`
 * for a per-tab route, or `requireRole(` for an admin-only one.
 *
 * The argument is captured as an *identifier* on purpose — a string literal
 * would not match, and a literal is exactly what a raw `params.kind` inlined by
 * a later hand is not. What it must be is checked below.
 */
const BOOKING_GATE =
  /await (requireBookingSettingsTab\(\s*([A-Za-z_$][\w$]*)\s*\)|requireRole\()/;

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

test("every AP-17 settings handler is gated, and approvers is the admin-only one", async () => {
  const routes = await walkBookingSettingsRoutes();
  assert.ok(routes.length >= 3, `expected the settings route tree, found ${routes.length}`);

  const roleGated: string[] = [];
  let handlerCount = 0;

  for (const route of routes) {
    const source = await readBookingRouteFile(route);
    const handlers = splitHandlers(source);
    assert.ok(handlers.length > 0, `${route} exports no HTTP handler`);

    for (const h of handlers) {
      handlerCount += 1;
      const found = BOOKING_GATE.exec(h.body);
      assert.ok(found, `${route} ${h.method} is not gated at all`);

      // The refusal must be *returned*. Both gates answer with either a session
      // or the `Response` to send, so a handler that calls the gate and drops
      // its result is ungated while looking gated.
      assert.ok(
        h.body.indexOf("instanceof Response) return") !== -1,
        `${route} ${h.method} calls its gate but never returns the refusal`,
      );

      // One gate per handler, never both and never neither.
      const tabbed = h.body.indexOf("requireBookingSettingsTab(") !== -1;
      const roled = h.body.indexOf("requireRole(") !== -1;
      assert.ok(tabbed !== roled, `${route} ${h.method} calls both gates, or neither`);

      if (roled) {
        if (roleGated.indexOf(route) === -1) roleGated.push(route);
        continue;
      }

      // The tab reaching the gate must be the value `isSettingsKind` narrowed,
      // in that order — never a raw path segment, and never a hand-written
      // string. `isSettingsKind` is what refuses `__proto__`.
      const narrowAt = h.body.indexOf("if (!isSettingsKind(");
      assert.ok(narrowAt !== -1, `${route} ${h.method} gates on a tab it never narrowed`);
      assert.ok(
        narrowAt < found.index,
        `${route} ${h.method} narrows the kind after gating on it`,
      );
      assert.equal(
        h.body.indexOf(`if (!isSettingsKind(${found[2]}))`),
        narrowAt,
        `${route} ${h.method} gates on "${found[2]}", which is not what it narrowed`,
      );

      // Nothing may run before the gate but resolving the route params. AP-1's
      // control demands the gate be the handler's *first* await; here the
      // narrowing has to come first, so `await params` is the one exemption.
      const before = h.body.slice(0, found.index);
      const priorAwaits = before.match(/await [A-Za-z_$][\w$]*/g) ?? [];
      for (const a of priorAwaits) {
        assert.equal(a, "await params", `${route} ${h.method} does ${a} before its gate`);
      }
    }
  }

  // สิทธิ์เข้าถึง hands out the grants, so it can never be opened by one.
  assert.deepEqual(
    roleGated,
    ["approvers"],
    "only settings/approvers may stay on requireRole",
  );

  // Pinning the count means a new handler on an existing route has to be looked
  // at rather than merged on the strength of the file already being gated.
  assert.equal(
    handlerCount,
    6,
    "the AP-17 settings routes gained or lost a handler — check its gate, then update this number",
  );
});
