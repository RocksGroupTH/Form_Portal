import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTROL_EXPORT_ORDER,
  DETAIL_EXPORT_ORDER,
  controlExportOrder,
  detailExportOrder,
} from "./report-export-order";

/**
 * The reader drags a column; the Excel file follows.
 *
 * The property that matters is at the bottom: whatever comes in, what comes out
 * is a PERMUTATION of the default export columns. The Control export is not the
 * Control screen — one screen column owns two export columns, two own none — so
 * an off-by-one here does not throw, it silently ships a file with a column
 * missing or doubled.
 */

test("no order given -> the default, unchanged", () => {
  assert.deepEqual(controlExportOrder([]), CONTROL_EXPORT_ORDER);
  assert.deepEqual(detailExportOrder([]), DETAIL_EXPORT_ORDER);
});

test("the reader's order is followed", () => {
  const out = controlExportOrder(["requestNo", "submittedAt"]);
  assert.equal(out[0], "requestNo");
  assert.equal(out[1], "submittedAt");
});

test("a screen column owning two export columns keeps them together, in order", () => {
  const out = controlExportOrder(["adjustment", "submittedAt"]);
  assert.deepEqual(out.slice(0, 3), ["refundToCompany", "extraToEmployee", "submittedAt"]);
  const pv = controlExportOrder(["pvDocNo", "submittedAt"]);
  assert.deepEqual(pv.slice(0, 3), ["pvDocNo", "paymentDate", "submittedAt"]);
});

test("a screen column with no export column contributes nothing", () => {
  const out = controlExportOrder(["requesterPosition", "refundTransferDate", "requestNo"]);
  assert.equal(out[0], "requestNo");
});

test("an unknown key is ignored and a duplicate is taken once", () => {
  const out = controlExportOrder(["nope", "requestNo", "requestNo"]);
  assert.equal(out[0], "requestNo");
  assert.equal(out.filter((k) => k === "requestNo").length, 1);
});

test("columns the reader did not name are appended in the default order", () => {
  const out = controlExportOrder(["overallStatus"]);
  assert.equal(out[0], "overallStatus");
  assert.deepEqual(
    out.slice(1),
    CONTROL_EXPORT_ORDER.filter((k) => k !== "overallStatus"),
  );
});

test("the output is always a permutation of the default columns", () => {
  const inputs: string[][] = [
    [],
    ["requestNo"],
    ["adjustment"],
    ["pvDocNo", "adjustment"],
    ["nope", "", "requestNo", "requestNo", "requesterPosition"],
    [...CONTROL_EXPORT_ORDER].reverse(),
  ];
  for (const input of inputs) {
    const out = controlExportOrder(input);
    assert.deepEqual(
      [...out].sort(),
      [...CONTROL_EXPORT_ORDER].sort(),
      `input ${JSON.stringify(input)}`,
    );
  }
});
