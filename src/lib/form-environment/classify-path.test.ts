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
