import { test } from "node:test";
import assert from "node:assert/strict";
import { GRANTABLE_REIMBURSE_TABS, isGrantableReimburseTabKey } from "./settings-tabs";

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
    route: "access",
    gate: {
      kind: "role",
      why: "hands out the grants — anyone who could POST here could grant themselves the rest — and, since 2026-09-10, the per-brand approval ticks the former settings/approvers route used to gate on its own",
    },
  },
  { route: "rules", gate: { kind: "tab", tab: "rules" }, publicRead: "GET" },
  { route: "brands", gate: { kind: "tab", tab: "brands" } },
  // The three opened on 2026-09-22 (user: "ของ AP-3,4 ก็ต้อง เปิด check box
  // ทุกอัน"). Each was `requireRole` until that day for a reason this table
  // used to carry, and each reason was put to the user and accepted — see
  // `settings-tabs.ts`, which now records them as what a tick REACHES rather
  // than as why it cannot be given:
  //  - erp-interface: gated but NOT brand-scoped, so a holder sets any brand's
  //    bank account, Journal Batch and Branch Code;
  //  - gl-accounts / bu-gl-map: the rows are AP-3's as much as AP-4's
  //    (AccClearAdvanceGl / AccClearAdvanceGlCompany, AccClrBuGlMap /
  //    AccClrBranchGlMap — no FormCode column), so a grant reaches another
  //    form's configuration and posting rules.
  { route: "erp-interface", gate: { kind: "tab", tab: "erpInterface" } },
  { route: "gl-accounts", gate: { kind: "tab", tab: "glAccounts" } },
  { route: "bu-gl-map", gate: { kind: "tab", tab: "buGlMap" } },
  {
    route: "erp-sync",
    gate: {
      kind: "role",
      why: "writes Rocks_ERP_Data — the Business Central mirror Rocks Fast also writes and ACC Portal reads through Fast_Data's synonyms; the same rule AP-1's erp-accounts/sync and AP-3's locations/sync carry. It is the sync button INSIDE the two G/L tabs, so a grant holder works those tabs and this button alone answers 403 — the one deliberately partial grant here, and it stayed that way when the tabs opened",
    },
  },
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
  //
  // Was 11. `settings/approvers` (GET + POST) is gone with the tab it
  // belonged to — its job (adding/reactivating an `AccReimburseApprover` row)
  // is now a side effect of ticking a brand on `settings/access`'s own POST —
  // so the count dropped by two handlers, to 9. SDD Task 7 then added
  // `erp-interface`'s `DELETE` (un-mapping a claim brand from its group,
  // standalone from the grouped `POST` — see that route's own docblock for
  // why), which is +1, to 10. Then `bu-gl-map` (GET + POST) — AP-4's own door
  // onto AP-3's BU/branch account rules, admin-only because those rows carry
  // no FormCode and are therefore another form's posting rules too — +2, to 12.
  // Then AP-4's own doors onto AP-3's G/L categories: `gl-accounts` (GET +
  // POST) and `erp-sync` (POST), +3, to 15.
  assert.equal(
    handlerCount,
    15,
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

test("every tab an admin can tick has a route that honours the tick", () => {
  // The OTHER direction, and the one this file was missing until 2026-09-22 —
  // the direction that matters for the bug that prompted the change. A key in
  // `GRANTABLE_REIMBURSE_TABS` whose route is still `requireRole` renders a
  // tickable column that grants nothing: the holder sees the tab and its data
  // 403s. CLAUDE.md names that exact shape as the thing this codebase
  // deliberately did not copy from ACC Portal, and nothing here noticed it.
  //
  // `GRANTABLE_REIMBURSE_TABS` is now `everything but access`, so this is also
  // what keeps a NEW tab from defaulting into a tick with no gate behind it.
  const gatedTabs: string[] = [];
  for (const rule of ROUTE_GATES) {
    if (rule.gate.kind === "tab") gatedTabs.push(rule.gate.tab);
  }
  for (const t of GRANTABLE_REIMBURSE_TABS) {
    assert.ok(
      gatedTabs.indexOf(t.key) !== -1,
      `"${t.key}" can be ticked but no route in this table is gated on it — the grant would open a tab whose every request 403s`,
    );
  }
});

test("the power-handing tab has a route in this table, and it is admin-only", () => {
  // The table is only a guarantee for the routes it lists. This is the one
  // whose absence would matter, so its presence is asserted rather than
  // assumed. `settings/approvers` used to be a second entry here; deleting the
  // route deleted the power it handed out too — see `settings/access`'s own
  // POST, which now derives an `AccReimburseApprover` row from brand ticks.
  for (const route of ["access"]) {
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
