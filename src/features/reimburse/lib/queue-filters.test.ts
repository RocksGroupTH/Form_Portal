import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_REIMBURSE_QUEUE_FILTERS,
  applyReimburseQueueFilters,
  hasReimburseQueueFilters,
  type ReimburseFilterableRow,
} from "./queue-filters";
import { MULTI_SELECT_NONE } from "@/features/accounting/components/ApprovalQueueFilters";

const row = (over: Partial<ReimburseFilterableRow> = {}): ReimburseFilterableRow => ({
  requestNo: "RBM26-09001",
  submittedAt: "2026-09-10T09:00:00.000Z",
  requesterName: "Sattawat Jaiyen",
  requesterDepartmentName: "Information Technology",
  brandCode: "ROCKS",
  ...over,
});

test("no filters lets everything through", () => {
  const rows = [row(), row({ requestNo: "RBM26-09002" })];
  assert.equal(applyReimburseQueueFilters(rows, EMPTY_REIMBURSE_QUEUE_FILTERS).length, 2);
  assert.equal(hasReimburseQueueFilters(EMPTY_REIMBURSE_QUEUE_FILTERS), false);
});

test("the number matches on a fragment, and ignores case", () => {
  const rows = [row(), row({ requestNo: "RBM26-09002" })];
  const f = { ...EMPTY_REIMBURSE_QUEUE_FILTERS, requestNo: "9002" };
  assert.deepEqual(
    applyReimburseQueueFilters(rows, f).map((r) => r.requestNo),
    ["RBM26-09002"],
  );
  assert.equal(hasReimburseQueueFilters(f), true);
});

test("the requester matches on a fragment of the name", () => {
  const rows = [row(), row({ requesterName: "Nipaporn Suklap" })];
  const f = { ...EMPTY_REIMBURSE_QUEUE_FILTERS, requesterName: "nipaporn" };
  assert.deepEqual(
    applyReimburseQueueFilters(rows, f).map((r) => r.requesterName),
    ["Nipaporn Suklap"],
  );
});

test("a blank or whitespace term is not a filter", () => {
  // Otherwise typing a space empties the queue and reads as "nothing pending".
  const rows = [row()];
  assert.equal(
    applyReimburseQueueFilters(rows, { ...EMPTY_REIMBURSE_QUEUE_FILTERS, requestNo: "   " }).length,
    1,
  );
  assert.equal(
    hasReimburseQueueFilters({ ...EMPTY_REIMBURSE_QUEUE_FILTERS, requestNo: "   " }),
    false,
  );
});

test("the submitted range is inclusive at both ends", () => {
  const rows = [
    row({ requestNo: "a", submittedAt: "2026-09-09T23:00:00.000Z" }),
    row({ requestNo: "b", submittedAt: "2026-09-10T09:00:00.000Z" }),
    row({ requestNo: "c", submittedAt: "2026-09-11T01:00:00.000Z" }),
  ];
  const f = {
    ...EMPTY_REIMBURSE_QUEUE_FILTERS,
    submittedFrom: "2026-09-09",
    submittedTo: "2026-09-11",
  };
  assert.equal(applyReimburseQueueFilters(rows, f).length, 3);
});

test("a row with no submitted date is dropped by a date range, not kept", () => {
  // A draft cannot be in this queue, so a null here means the column was never
  // written. Keeping it would put a row with no date inside a date range.
  const rows = [row({ submittedAt: null })];
  const f = { ...EMPTY_REIMBURSE_QUEUE_FILTERS, submittedFrom: "2026-09-01" };
  assert.equal(applyReimburseQueueFilters(rows, f).length, 0);
});

test("department and brand are multi-select: empty means all", () => {
  const rows = [row(), row({ requesterDepartmentName: "Operations", brandCode: "PCTH" })];
  assert.equal(applyReimburseQueueFilters(rows, EMPTY_REIMBURSE_QUEUE_FILTERS).length, 2);
  assert.deepEqual(
    applyReimburseQueueFilters(rows, {
      ...EMPTY_REIMBURSE_QUEUE_FILTERS,
      departmentNames: ["Operations"],
    }).map((r) => r.brandCode),
    ["PCTH"],
  );
});

test("the explicit none marker selects nothing, which is not the same as all", () => {
  // The distinction the shared multi-select carries: a control cleared to
  // "none" must empty the list rather than silently reverting to "all".
  const rows = [row(), row({ brandCode: "PCTH" })];
  assert.equal(
    applyReimburseQueueFilters(rows, {
      ...EMPTY_REIMBURSE_QUEUE_FILTERS,
      brandCodes: [MULTI_SELECT_NONE],
    }).length,
    0,
  );
});

test("a row with no department still answers a department filter", () => {
  // Measured 2026-09-10: every AP-4 request carries one. A row written before
  // the column did would be null, and it must not crash or match everything.
  const rows = [row({ requesterDepartmentName: null })];
  assert.equal(
    applyReimburseQueueFilters(rows, {
      ...EMPTY_REIMBURSE_QUEUE_FILTERS,
      departmentNames: ["Operations"],
    }).length,
    0,
  );
});

test("filters compose — every one must pass, not any", () => {
  const rows = [
    row({ requestNo: "RBM26-09001", brandCode: "ROCKS" }),
    row({ requestNo: "RBM26-09002", brandCode: "PCTH" }),
  ];
  const f = {
    ...EMPTY_REIMBURSE_QUEUE_FILTERS,
    requestNo: "09001",
    brandCodes: ["PCTH"],
  };
  assert.equal(applyReimburseQueueFilters(rows, f).length, 0);
});
