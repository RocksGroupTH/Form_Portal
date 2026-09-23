import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPath, isFormCode, matchRule, ROUTE_RULES } from "./classify-path";

test("AP-17 admin pages under the accounting prefix win over AP-1", () => {
  assert.equal(classifyPath("/request/accounting/travel-booking"), "AP-17");
  assert.equal(classifyPath("/request/accounting/travel-booking/queue"), "AP-17");
  assert.equal(classifyPath("/request/accounting/travel-booking-report"), "AP-17");
  assert.equal(classifyPath("/request/accounting/travel-booking-settings"), "AP-17");
});

test("AP-17 own routes", () => {
  assert.equal(classifyPath("/api/request/travel-booking/requests/5"), "AP-17");
  assert.equal(classifyPath("/api/request/travel-booking/admin/queue"), "AP-17");
  assert.equal(classifyPath("/request/travel-booking"), "AP-17");
  assert.equal(classifyPath("/request/travel-booking/5"), "AP-17");
});

test("AP-2 (advance) own routes, including its BC-posting queue", () => {
  assert.equal(classifyPath("/request/advance"), "AP-2");
  assert.equal(classifyPath("/request/advance/5"), "AP-2");
  assert.equal(classifyPath("/api/request/advance"), "AP-2");
  assert.equal(classifyPath("/api/request/advance/5"), "AP-2");
  assert.equal(classifyPath("/api/request/advance/work"), "AP-2");
  // the advance erp-prep queue inherits AP-2 from the parent prefix — a single
  // form, never BOTH/null, so the journal and BC target agree on one database.
  assert.equal(classifyPath("/api/request/advance/erp-prep"), "AP-2");
  assert.equal(classifyPath("/api/request/advance/erp-prep/send"), "AP-2");
  // boundary: must not match mid-segment.
  assert.equal(classifyPath("/request/advancesomething"), null);
});

test("AP-3 (clear advance) own routes", () => {
  assert.equal(classifyPath("/request/clear-advance"), "AP-3");
  assert.equal(classifyPath("/request/clear-advance/5"), "AP-3");
  assert.equal(classifyPath("/api/request/clear-advance"), "AP-3");
  assert.equal(classifyPath("/api/request/clear-advance/requests/5"), "AP-3");
  assert.equal(classifyPath("/api/request/clear-advance/pending-advances"), "AP-3");
  // boundary: must not match mid-segment, and must not collide with AP-2's prefix.
  assert.equal(classifyPath("/request/clear-advancesomething"), null);
  assert.equal(classifyPath("/request/advance"), "AP-2");
});

test("AP-1 routes", () => {
  assert.equal(classifyPath("/api/request/accounting/requests/5"), "AP-1");
  assert.equal(classifyPath("/api/request/accounting/requests/drafts"), "AP-1");
  assert.equal(classifyPath("/request/travel-expense"), "AP-1");
  assert.equal(classifyPath("/request/travel-expense/5"), "AP-1");
  assert.equal(classifyPath("/request/accounting"), "AP-1");
  assert.equal(classifyPath("/request/accounting/approvals"), "AP-1");
});

test("aggregate endpoints span both databases", () => {
  // What a person owns or must act on spans both databases: they can have live
  // requests in one and test requests in the other at the same time.
  assert.equal(classifyPath("/api/request/accounting/requests/mine"), "BOTH");
  assert.equal(classifyPath("/api/request/accounting/work"), "BOTH");
  assert.equal(classifyPath("/api/request/accounting/requesters"), "BOTH");
});

test("the AP-1 report follows AP-1, it does not merge", () => {
  // A report is a statement about one set of books. Merging test rows into a
  // production report — or into its Excel export — makes both untrue.
  assert.equal(classifyPath("/api/request/accounting/report"), "AP-1");
  assert.equal(classifyPath("/api/request/accounting/report/export"), "AP-1");
  assert.equal(classifyPath("/request/accounting/report"), "AP-1");
});

test("ERP prep is not an aggregate — it follows AP-1", () => {
  // The prep queue reads rows, builds a journal from them and posts it to
  // Business Central. Reading a merged list and sending from one pool would
  // post whichever half the pool happened to hold.
  assert.equal(classifyPath("/api/request/accounting/erp-prep"), "AP-1");
  assert.equal(classifyPath("/api/request/accounting/erp-prep/send"), "AP-1");
  assert.equal(classifyPath("/api/request/accounting/erp-prep/journal-context"), "AP-1");
  assert.equal(classifyPath("/api/request/accounting/erp-prep/42"), "AP-1");
  assert.equal(classifyPath("/request/accounting/erp-prep"), "AP-1");
});

test("settings read production; dual-write is handled in the service layer", () => {
  assert.equal(classifyPath("/api/request/accounting/settings/vehicles"), null);
  assert.equal(classifyPath("/api/request/accounting/settings/approvers"), null);
  assert.equal(classifyPath("/api/request/travel-booking/settings/reason"), "AP-17");
  // AP-2 settings carry a config-row id, not an AccRequest id — Production + dual-write.
  assert.equal(classifyPath("/api/request/advance/settings/tiers"), null);
  assert.equal(classifyPath("/api/request/advance/settings/erp-interface"), null);
});

test("Form Builder and everything else is production", () => {
  assert.equal(classifyPath("/api/forms/submissions"), null);
  assert.equal(classifyPath("/forms/admin"), null);
  assert.equal(classifyPath("/settings/users"), null);
  assert.equal(classifyPath("/"), null);
  assert.equal(classifyPath(""), null);
  assert.equal(classifyPath(null), null);
  assert.equal(classifyPath(undefined), null);
});

test("more specific rules beat less specific ones regardless of table order", () => {
  assert.equal(classifyPath("/api/request/accounting/requests/mine"), "BOTH");
  assert.equal(classifyPath("/api/request/accounting/requests/123"), "AP-1");
});

test("query strings and trailing slashes do not change the answer", () => {
  assert.equal(classifyPath("/api/request/accounting/report?from=2026-01-01"), "AP-1");
  assert.equal(classifyPath("/api/request/accounting/work?from=2026-01-01"), "BOTH");
  assert.equal(classifyPath("/request/accounting/travel-booking/"), "AP-17");
  assert.equal(classifyPath("/api/request/travel-booking/requests/5/"), "AP-17");
});

test("matchRule separates a deliberate Production rule from no rule at all", () => {
  // classifyPath answers null for both of these; the coverage check must not.
  const settings = matchRule("/api/request/accounting/settings/vehicles");
  assert.equal(settings?.prefix, "/api/request/accounting/settings");
  assert.equal(settings?.result, null);

  const lookup = matchRule("/api/request/new-item-inventory/lookup/brands");
  assert.equal(lookup?.prefix, "/api/request/new-item-inventory");
  assert.equal(lookup?.result, null);

  assert.equal(matchRule("/api/forms/submissions"), null);
  assert.equal(matchRule("/api/request/something-nobody-classified"), null);
});

test("matchRule returns the longest matching rule, like classifyPath", () => {
  assert.equal(matchRule("/api/request/accounting/requests/mine")?.result, "BOTH");
  assert.equal(matchRule("/api/request/accounting/requests/123")?.prefix, "/api/request/accounting");
  assert.equal(matchRule("/request/accounting/travel-booking/queue")?.result, "AP-17");
  assert.equal(matchRule(null), null);
  assert.equal(matchRule(""), null);
});

test("a prefix must match on a boundary, never mid-segment", () => {
  // /request/accounting-archive is not /request/accounting
  assert.equal(classifyPath("/request/accountingsomething"), null);
  assert.equal(classifyPath("/api/request/travel-bookingsomething"), null);
});

test("no BC-posting route may be an aggregate or unclassified", () => {
  // The send builds a journal from rows read through one pool and posts it to
  // one BC instance. BOTH would merge two databases into one journal; null
  // would pin the queue to production while the form is flagged UAT.
  for (const rule of ROUTE_RULES) {
    if (rule.prefix.includes("/erp-prep")) {
      assert.ok(rule.result !== "BOTH" && rule.result !== null,
        `${rule.prefix} must resolve to a single form, got ${rule.result}`);
    }
  }
  assert.ok(matchRule("/api/request/accounting/erp-prep/send"),
    "the send path must be covered by a rule at all");
});

test("AP-4's own paths classify to AP-4, not to AP-1's catch-all", () => {
  assert.equal(classifyPath("/request/reimburse"), "AP-4");
  assert.equal(classifyPath("/request/reimburse/123"), "AP-4");
  assert.equal(classifyPath("/api/request/reimburse/requests/123/submit"), "AP-4");
  // The สิทธิ์เข้าถึง roster and the viewer's-capabilities endpoint are covered
  // by the same prefix — no rule of their own, and none needed. Pinned because
  // "no rule at all" is the failure that silently falls through to Production.
  assert.equal(classifyPath("/api/request/reimburse/settings/access"), "AP-4");
  assert.equal(classifyPath("/api/request/reimburse/access"), "AP-4");
});

test("AP-4 is a known form code", () => {
  assert.equal(isFormCode("AP-4"), true);
});

/**
 * **The Business Central mirror follows the viewer's environment; the settings
 * rows beside it stay pinned to Production.**
 *
 * Reported 2026-09-23: a tester pressed Sync ERP in UAT mode and it pulled
 * production's data and stored it as Production. The sync routes sit under
 * `/api/request/accounting/settings` and `/api/request/advance/settings`, both
 * pinned `null`, and `null` is Production outright — the viewer's UAT mode is
 * never consulted. Measured in `ErpSyncLog`: four brands, `[Production]`, while
 * the operator was in UAT.
 *
 * **The pin's own argument does not cover the mirror.** Its comment reads
 * *"settings read production; dual-write happens in the service layer"* — true
 * of `AccApprover` and the rest, and false of `Rocks_ERP_Data`, which is one
 * physical copy, not dual-written, not in `MASTER_TABLES`, and not in the form
 * database at all. Since migration 159 it holds both environments' rows and the
 * environment decides which half is touched.
 *
 * Both halves are asserted here, and the second is the one that matters more:
 * the pin exists so a config-row id in the PATH is not read as an
 * `AccRequest.Id`, and widening it would route a tier id to a database.
 */
test("the ERP mirror routes follow their form, not the Production pin", () => {
  for (const p of [
    "/api/request/accounting/settings/erp-accounts",
    "/api/request/accounting/settings/erp-accounts/sync",
    "/api/request/accounting/settings/departments/sync",
  ]) {
    assert.equal(
      classifyPath(p),
      "AP-1",
      `${p} reads and writes Rocks_ERP_Data, which is split by environment — pinned to ` +
        "Production a tester syncs from the real BC and stores the rows as production's",
    );
  }
  for (const p of [
    "/api/request/advance/settings/erp-master",
    "/api/request/advance/settings/erp-batches",
    "/api/request/advance/settings/vendors/sync",
  ]) {
    assert.equal(classifyPath(p), "AP-2", `${p} reads or writes the BC mirror`);
  }
});

test("the settings pin still covers every route it was written for", () => {
  /* The narrow rules above must not have widened the pin. A route carrying a
     config-row id in its path — a tier, an approver, a bank — must stay `null`,
     or the resolver reads that id as an `AccRequest.Id` and picks a database
     from it. That is the hazard the pin exists for and it is unrelated to the
     mirror. */
  for (const p of [
    "/api/request/advance/settings/tiers/12",
    "/api/request/advance/settings/approvers/7",
    "/api/request/advance/settings/banks/3",
    "/api/request/advance/settings/erp-interface",
    "/api/request/advance/settings/access",
    "/api/request/accounting/settings/approvers",
    "/api/request/accounting/settings/departments",
    "/api/request/accounting/settings/departments/map",
    "/api/request/accounting/settings/vehicles",
  ]) {
    assert.equal(
      classifyPath(p),
      null,
      `${p} is no longer pinned to Production. These carry config-row ids and dual-written ` +
        "rows; routing them by form is how a tier id becomes a database selector",
    );
  }
});
