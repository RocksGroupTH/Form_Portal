import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTROL_EXPORT_ORDER,
  CONTROL_OWNS,
  DETAIL_EXPORT_ORDER,
  DETAIL_OWNS,
  controlExportOrder,
  detailExportOrder,
  totalsLabelIndex,
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

/**
 * Ownership itself, not just its effect.
 *
 * Mutation testing found the gap this closes. Take `extraToEmployee` away from
 * `adjustment` and every case above still passed but one: the fallback loop
 * quietly picks the orphan up and appends it, so the file still has all 17
 * columns and the permutation property is still satisfied — it just writes a
 * column somewhere the reader did not put it. The cases above pin the two pairs
 * that exist today; these pin the rule, so a column added later cannot arrive
 * unowned, owned twice, or owned by a screen column the map invented.
 */

test("every export column is owned by exactly one screen column", () => {
  for (const [order, owns] of [
    [CONTROL_EXPORT_ORDER, CONTROL_OWNS],
    [DETAIL_EXPORT_ORDER, DETAIL_OWNS],
  ] as const) {
    const owners = new Map<string, string[]>();
    for (const [screenKey, keys] of Object.entries(owns)) {
      for (const k of keys) owners.set(k, [...(owners.get(k) ?? []), screenKey]);
    }
    for (const k of order) {
      assert.deepEqual(
        owners.get(k)?.length ?? 0,
        1,
        `${k} is owned by ${JSON.stringify(owners.get(k) ?? [])}, expected exactly one screen column`,
      );
    }
    assert.deepEqual(
      // Array.from, not a spread: this repo's tsconfig target makes spreading a
      // Map iterator a TS2802 error.
      Array.from(owners.keys()).filter((k) => !(order as readonly string[]).includes(k)),
      [],
      "a screen column owns a column the export does not have",
    );
  }
});

/**
 * Where the totals row's label goes.
 *
 * Found while reviewing the Control export rewrite: with the label pinned to
 * index 0, a reader who dragged a summed column to the front would have got the
 * word "รวมทั้งหมด" where that column's total belonged, and the total would
 * have been absent from the file.
 */

test("the totals label takes the leftmost cell that has no total", () => {
  const hasTotal = (k: string) => k === "advanceAmount" || k === "actualTotal";
  assert.equal(totalsLabelIndex(["submittedAt", "advanceAmount"], hasTotal), 0);
  assert.equal(totalsLabelIndex(["advanceAmount", "submittedAt"], hasTotal), 1);
  assert.equal(totalsLabelIndex(["advanceAmount", "actualTotal", "requestNo"], hasTotal), 2);
});

test("every column summed -> the label still appears, rather than nowhere", () => {
  assert.equal(totalsLabelIndex(["a", "b"], () => true), 0);
});
