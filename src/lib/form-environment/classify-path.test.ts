import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPath } from "./classify-path";

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
  assert.equal(classifyPath("/api/request/accounting/requests/mine"), "BOTH");
  assert.equal(classifyPath("/api/request/accounting/work"), "BOTH");
  assert.equal(classifyPath("/api/request/accounting/report"), "BOTH");
  assert.equal(classifyPath("/api/request/accounting/report/export"), "BOTH");
  assert.equal(classifyPath("/api/request/accounting/erp-prep"), "BOTH");
  assert.equal(classifyPath("/api/request/accounting/erp-prep/send"), "BOTH");
  assert.equal(classifyPath("/api/request/accounting/requesters"), "BOTH");
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
  assert.equal(classifyPath("/api/request/accounting/report?from=2026-01-01"), "BOTH");
  assert.equal(classifyPath("/request/accounting/travel-booking/"), "AP-17");
  assert.equal(classifyPath("/api/request/travel-booking/requests/5/"), "AP-17");
});

test("a prefix must match on a boundary, never mid-segment", () => {
  // /request/accounting-archive is not /request/accounting
  assert.equal(classifyPath("/request/accountingsomething"), null);
  assert.equal(classifyPath("/api/request/travel-bookingsomething"), null);
});
