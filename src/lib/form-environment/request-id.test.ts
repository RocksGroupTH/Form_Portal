import { test } from "node:test";
import assert from "node:assert/strict";
import { requestIdFromPath, environmentFromPath } from "./request-id";

test("finds the request id in every write choke point", () => {
  // The paths that create or move a request, from TravelExpenseForm.tsx:634,704
  // and useTravelBookingForm.ts:528,602.
  assert.equal(requestIdFromPath("/api/request/accounting/requests/900001"), 900001);
  assert.equal(requestIdFromPath("/api/request/accounting/requests/900001/submit"), 900001);
  assert.equal(requestIdFromPath("/api/request/accounting/requests/12/approve"), 12);
  assert.equal(requestIdFromPath("/api/request/travel-booking/requests/900042/submit"), 900042);
  assert.equal(requestIdFromPath("/api/request/travel-booking/admin/requests/900042"), 900042);
});

test("takes the first id-bearing segment, not the last", () => {
  // /requests/900001/items/900456 — the request owns the row, the item is inside it.
  assert.equal(requestIdFromPath("/api/request/accounting/requests/900001/items/900456"), 900001);
  assert.equal(requestIdFromPath("/api/request/accounting/requests/7/files/900456"), 7);
});

test("normalises query strings and trailing slashes like classifyPath", () => {
  // ExpenseRows.tsx:187 sends ?fileId=…, which must not be mistaken for the id.
  assert.equal(requestIdFromPath("/api/request/accounting/requests/900001/files?fileId=900456"), 900001);
  assert.equal(requestIdFromPath("/api/request/accounting/requests/900001/"), 900001);
  assert.equal(requestIdFromPath("/request/travel-expense/900001?brand=PCTH"), 900001);
});

test("literals that sit where an id would go are not ids", () => {
  for (const path of [
    "/api/request/accounting/requests/mine",
    "/api/request/accounting/requests/drafts",
    "/api/request/accounting/requests/blocked-travel-dates",
    "/api/request/travel-booking/requests/group",
    "/api/request/accounting/erp-prep/send",
    "/api/request/accounting/erp-prep/journal-context",
  ]) {
    assert.equal(requestIdFromPath(path), null, path);
  }
});

test("paths that do not belong to a form have no request id", () => {
  // Settings are deliberately unclassified, aggregates span both databases, and
  // new-item-inventory reads Fast_Core — none of them name an AccRequest row.
  assert.equal(requestIdFromPath("/api/request/accounting/settings/vehicles/12"), null);
  assert.equal(requestIdFromPath("/api/request/accounting/work"), null);
  assert.equal(requestIdFromPath("/api/request/new-item-inventory/lookup/12"), null);
  assert.equal(requestIdFromPath("/api/forms/submissions/12"), null);
  assert.equal(requestIdFromPath(null), null);
  assert.equal(requestIdFromPath(""), null);
});

test("environmentFromPath turns the id into the database that holds it", () => {
  assert.equal(environmentFromPath("/api/request/accounting/requests/900001/submit"), "UAT");
  assert.equal(environmentFromPath("/api/request/accounting/requests/12/submit"), "Production");
  // No id in the path: the caller decides by viewer mode and the form's switches.
  assert.equal(environmentFromPath("/api/request/accounting/requests"), null);
  assert.equal(environmentFromPath("/api/request/accounting/settings/vehicles/12"), null);
});
