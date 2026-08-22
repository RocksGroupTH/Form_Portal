import { test } from "node:test";
import assert from "node:assert/strict";
import { isGrantableReimburseTabKey } from "./settings-tabs";

/**
 * What actually gates each AP-4 settings route.
 *
 * The pure `settings-tabs.test.ts` proves the *rule* is right. This proves the
 * routes use it — which is the half that regresses silently, because a route
 * left on `requireRole` still works perfectly for the admins who wrote it and
 * simply never opens for anybody granted a tab, while a route left ungated
 * looks identical to a gated one from the outside.
 *
 * Modelled on AP-1's `settings-tabs.test.ts`, which reads the route sources
 * rather than trusting a table that was copied by hand.
 *
 * Every search below is for `await <gate>(`, never a bare `<gate>(`. A route's
 * comments name the gate it *used* to carry as often as not — this file's first
 * run failed on exactly that, reporting the `rules` GET as still admin-only on
 * the strength of a comment explaining why it no longer is. Prose is not a call.
 */

const SETTINGS_ROOT = "../../../app/api/request/reimburse/settings";

type Gate =
  /** `requireRole(["IT Admin", "System Admin"])` — admin only, never grantable. */
  | { kind: "role"; why: string }
  /** `requireReimburseSettingsTab("<tab>")` — admin, or a holder of that grant. */
  | { kind: "tab"; tab: string };

const ROUTE_GATES: { route: string; gate: Gate; publicRead?: "GET" }[] = [
  {
    route: "approvers",
    gate: {
      kind: "role",
      why: "edits the pool that approves real payments — granting it would be a route from 'may edit the checklist' to 'may approve money'",
    },
  },
  {
    route: "access",
    gate: {
      kind: "role",
      why: "hands out the grants — anyone who could POST here could grant themselves the rest",
    },
  },
  { route: "rules", gate: { kind: "tab", tab: "rules" }, publicRead: "GET" },
  { route: "brands", gate: { kind: "tab", tab: "brands" } },
];

async function readRouteFile(route: string): Promise<string> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const root = path.resolve(__dirname, SETTINGS_ROOT);
  return fs.readFile(path.join(root, route, "route.ts"), "utf8");
}

/**
 * Each exported HTTP handler, as `[method, body-from-here]`.
 *
 * The body runs to the next handler rather than to a closing brace: finding the
 * real end would mean counting braces through strings and comments, and every
 * assertion below only looks at what comes *before* the first `await`.
 */
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

const GATE =
  /await (requireReimburseSettingsTab\(\s*"([A-Za-z-]+)"\s*\)|requireRole\(|requireAuth\()/;

test("every AP-4 settings handler opens with the gate its table entry names", async () => {
  let handlerCount = 0;

  for (const rule of ROUTE_GATES) {
    const source = await readRouteFile(rule.route);
    const handlers = splitHandlers(source);
    assert.ok(handlers.length > 0, `${rule.route} exports no HTTP handler`);

    for (const h of handlers) {
      handlerCount += 1;
      const found = GATE.exec(h.body);
      assert.ok(found, `${rule.route} ${h.method} is not gated at all`);

      // The one documented exception: `rules` GET without `?includeInactive=1`
      // is the checklist every requester has to tick, so it is `requireAuth()`.
      // The same handler still reaches for the tab guard on the editor's read —
      // asserted below — which is why matching either here is not a hole.
      const isPublicRead = rule.publicRead === h.method;

      if (rule.gate.kind === "role") {
        assert.ok(
          found[1].indexOf("requireRole(") === 0,
          `${rule.route} ${h.method} should be admin-only (${rule.gate.why}) but calls ${found[1]}`,
        );
        assert.equal(
          h.body.indexOf("await requireReimburseSettingsTab("),
          -1,
          `${rule.route} ${h.method} is admin-only but reaches for the tab guard`,
        );
      } else if (isPublicRead) {
        assert.ok(
          h.body.indexOf(`await requireReimburseSettingsTab("${rule.gate.tab}")`) !== -1,
          `${rule.route} ${h.method} is the mixed read but never gates its admin branch on "${rule.gate.tab}"`,
        );
        assert.equal(
          h.body.indexOf("await requireRole("),
          -1,
          `${rule.route} ${h.method} still calls requireRole — the grant can never open it`,
        );
      } else {
        assert.equal(
          found[2],
          rule.gate.tab,
          `${rule.route} ${h.method} is gated on "${found[2]}" but the table says "${rule.gate.tab}"`,
        );
      }

      // The gate must be the handler's first `await`: a check that runs after
      // the work is not a gate. `requireAuth` inside `requireReimburseSettingsTab`
      // is what proves the session, so nothing legitimate needs to precede it.
      assert.equal(
        h.body.indexOf("await "),
        found.index,
        `${rule.route} ${h.method} does something before its gate`,
      );

      // …and the refusal must be returned. Every gate answers with *either* a
      // session or the `Response` to send, so a handler that calls the gate and
      // drops its result is ungated while looking gated — and every assertion
      // above would still pass.
      assert.ok(
        h.body.indexOf("instanceof Response) return") !== -1,
        `${rule.route} ${h.method} calls its gate but never returns the refusal`,
      );
    }
  }

  // Pinned so a new handler on an existing route has to be looked at rather
  // than merged on the strength of the file already having an entry.
  assert.equal(
    handlerCount,
    9,
    "the AP-4 settings routes gained or lost a handler — check its gate, then update this number",
  );
});

test("every tab-gated route names a tab an admin can actually tick", () => {
  // A route gated on a key that is not grantable can never open for a
  // non-admin, whatever an admin ticks — so it would be `requireRole` wearing a
  // longer name.
  for (const rule of ROUTE_GATES) {
    if (rule.gate.kind === "tab") {
      assert.equal(
        isGrantableReimburseTabKey(rule.gate.tab),
        true,
        `${rule.route} is gated on "${rule.gate.tab}", which no admin can tick`,
      );
    }
  }
});

test("the two power-handing tabs have a route in this table, and it is admin-only", () => {
  // The table is only a guarantee for the routes it lists. These two are the
  // ones whose absence would matter, so their presence is asserted rather than
  // assumed.
  for (const route of ["approvers", "access"]) {
    const rule = ROUTE_GATES.find((r) => r.route === route);
    assert.ok(rule, `${route} has no entry — its gate is unasserted`);
    assert.equal(rule.gate.kind, "role", `${route} must stay admin-only`);
  }
});

test("every AP-4 settings route on disk has an entry", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const root = path.resolve(__dirname, SETTINGS_ROOT);
  const onDisk = (await fs.readdir(root, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  const mapped = ROUTE_GATES.map((r) => r.route).sort();
  assert.deepEqual(
    onDisk,
    mapped,
    "an AP-4 settings route is not in ROUTE_GATES — add it with the gate it should carry",
  );
});
