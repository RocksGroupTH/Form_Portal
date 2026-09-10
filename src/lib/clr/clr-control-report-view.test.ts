import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_VISIBLE_KEYS,
  controlAdjustment,
  csvValues,
  stackedAxisCombos,
  mergeControlRows,
  singleStackedValue,
  type Adjustment,
} from "./clr-control-report-view";
import type { ClrControlRow } from "./clear-advance-report-service";

/** Every ClrControlRow field the merge/combo logic doesn't care about, defaulted to null. */
function fixtureRow(overrides: Partial<ClrControlRow> & Pick<ClrControlRow, "id">): ClrControlRow {
  return {
    submittedAt: null,
    requestNo: null,
    staffId: null,
    advanceRequestNo: null,
    requesterFullName: null,
    requesterPosition: null,
    requesterDepartmentName: null,
    advanceAmount: null,
    expenseOf: null,
    actualTotal: null,
    refundToCompany: null,
    extraToEmployee: null,
    refundTransferDate: null,
    pvDocNo: null,
    paymentDate: null,
    managerApprovedName: null,
    managerApprovedAt: null,
    accountActionedName: null,
    accountActionedAt: null,
    headApprovedName: null,
    headApprovedAt: null,
    pendingOn: null,
    overallStatus: "Submitted",
    ...overrides,
  };
}

/**
 * UAT-shaped fixture (design doc §"Testing"): 7 rows, 5 อนุมัติแล้ว (Approved,
 * ids 1-5) + 2 รออนุมัติ (Submitted, ids 6-7). ids 1,2,3,6 also carry a brand —
 * `ClrControlRow` has no brand field (§"Already correct" / row data is
 * untouched), so brand membership lives only in this test's own map, standing
 * in for what a real `listControlRows({ brandCode: "PCTH", ... })` call would
 * have already filtered to before the row ever reaches the client.
 */
const UAT_ROWS: readonly ClrControlRow[] = [
  fixtureRow({ id: 1, overallStatus: "Approved" }),
  fixtureRow({ id: 2, overallStatus: "Approved" }),
  fixtureRow({ id: 3, overallStatus: "Approved" }),
  fixtureRow({ id: 4, overallStatus: "Approved" }),
  fixtureRow({ id: 5, overallStatus: "Approved" }),
  fixtureRow({ id: 6, overallStatus: "Submitted" }),
  fixtureRow({ id: 7, overallStatus: "Submitted" }),
];
const PCTH_ROW_IDS = new Set([1, 2, 3, 6]);

/** Only the two fields controlAdjustment reads — the rest of ClrControlRow is irrelevant to it. */
function adjRow(overrides: Partial<Pick<ClrControlRow, "refundToCompany" | "extraToEmployee">>): Pick<
  ClrControlRow,
  "refundToCompany" | "extraToEmployee"
> {
  return { refundToCompany: 0, extraToEmployee: 0, ...overrides };
}

test("DEFAULT_VISIBLE_KEYS has exactly the 10 columns the design specifies", () => {
  assert.equal(DEFAULT_VISIBLE_KEYS.length, 10);
  assert.deepEqual(
    [...DEFAULT_VISIBLE_KEYS].sort(),
    [
      "submittedAt",
      "requestNo",
      "advanceRequestNo",
      "requesterFullName",
      "advanceAmount",
      "actualTotal",
      "adjustment",
      "pvDocNo",
      "pendingOn",
      "overallStatus",
    ].sort(),
  );
});

test("controlAdjustment: a refund to the company reads as direction=refund with its amount", () => {
  const adj: Adjustment = controlAdjustment(adjRow({ refundToCompany: 500, extraToEmployee: 0 }));
  assert.deepEqual(adj, { direction: "refund", amount: 500 });
});

test("controlAdjustment: extra paid to the employee reads as direction=extra with its amount", () => {
  const adj: Adjustment = controlAdjustment(adjRow({ refundToCompany: 0, extraToEmployee: 300 }));
  assert.deepEqual(adj, { direction: "extra", amount: 300 });
});

test("controlAdjustment: neither non-zero reads as direction=none, amount 0", () => {
  const adj: Adjustment = controlAdjustment(adjRow({ refundToCompany: 0, extraToEmployee: 0 }));
  assert.deepEqual(adj, { direction: "none", amount: 0 });
});

test("controlAdjustment: null fields (no linked clearing yet) read as direction=none", () => {
  const adj: Adjustment = controlAdjustment({ refundToCompany: null, extraToEmployee: null });
  assert.deepEqual(adj, { direction: "none", amount: 0 });
});

/* ─────────────── stacked filters: csvValues / stackedAxisCombos / mergeControlRows ─────────────── */

test("csvValues: empty/null/undefined all read as no picks", () => {
  assert.deepEqual(csvValues(""), []);
  assert.deepEqual(csvValues(null), []);
  assert.deepEqual(csvValues(undefined), []);
});

test("csvValues: splits, trims, and drops empties", () => {
  assert.deepEqual(csvValues("Approved, Submitted ,"), ["Approved", "Submitted"]);
});

test("stackedAxisCombos: no picks on either axis is one combo, both null (any/any)", () => {
  assert.deepEqual(stackedAxisCombos("", ""), [{ brand: null, status: null }]);
});

test("stackedAxisCombos: picks stacked in one column produce one combo per pick, other axis null", () => {
  assert.deepEqual(stackedAxisCombos("PCTH,KSI", ""), [
    { brand: "PCTH", status: null },
    { brand: "KSI", status: null },
  ]);
  assert.deepEqual(stackedAxisCombos("", "Approved,Submitted"), [
    { brand: null, status: "Approved" },
    { brand: null, status: "Submitted" },
  ]);
});

test("stackedAxisCombos: picks in two columns cross-product, not zip", () => {
  assert.deepEqual(stackedAxisCombos("PCTH,KSI", "Approved,Submitted"), [
    { brand: "PCTH", status: "Approved" },
    { brand: "PCTH", status: "Submitted" },
    { brand: "KSI", status: "Approved" },
    { brand: "KSI", status: "Submitted" },
  ]);
});

test("mergeControlRows: two picks in ONE column widens the result (union, not intersection)", () => {
  // Simulates the real request flow: stackedAxisCombos("", "Approved,Submitted")
  // yields one combo per status; each combo's "DB result" here is what
  // listControlRows({ status: "Approved" }) / ({ status: "Submitted" }) would
  // actually return against UAT_ROWS.
  const approvedOnly = UAT_ROWS.filter((r) => r.overallStatus === "Approved");
  const submittedOnly = UAT_ROWS.filter((r) => r.overallStatus === "Submitted");

  const oneStatusPicked = mergeControlRows([approvedOnly]);
  const twoStatusesPicked = mergeControlRows([approvedOnly, submittedOnly]);

  assert.equal(oneStatusPicked.length, 5);
  assert.equal(twoStatusesPicked.length, 7);
  assert.ok(twoStatusesPicked.length > oneStatusPicked.length, "picking a second value must widen, never narrow");
  assert.deepEqual(
    twoStatusesPicked.map((r) => r.id).sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6, 7],
  );
});

test("mergeControlRows: picks in TWO different columns narrows the result (AND across columns)", () => {
  // Same status-stacked pick as above, now ANDed with a single brand pick.
  // Per-combo "DB results" are UAT_ROWS filtered by BOTH conditions at once —
  // exactly what listControlRows({ brandCode: "PCTH", status: "Approved" })
  // would have already done server-side.
  const pcthApproved = UAT_ROWS.filter((r) => PCTH_ROW_IDS.has(r.id) && r.overallStatus === "Approved");
  const pcthSubmitted = UAT_ROWS.filter((r) => PCTH_ROW_IDS.has(r.id) && r.overallStatus === "Submitted");

  const statusOnly = mergeControlRows([
    UAT_ROWS.filter((r) => r.overallStatus === "Approved"),
    UAT_ROWS.filter((r) => r.overallStatus === "Submitted"),
  ]);
  const statusAndBrand = mergeControlRows([pcthApproved, pcthSubmitted]);

  assert.equal(statusOnly.length, 7);
  assert.equal(statusAndBrand.length, 4);
  assert.ok(statusAndBrand.length < statusOnly.length, "adding a second column's filter must narrow, never widen");
  assert.deepEqual(
    statusAndBrand.map((r) => r.id).sort((a, b) => a - b),
    [1, 2, 3, 6],
  );
});

test("mergeControlRows: a row matching two combos (e.g. an overlapping any-axis) is deduped, not doubled", () => {
  const merged = mergeControlRows([
    [fixtureRow({ id: 1, submittedAt: "2026-08-01" })],
    [fixtureRow({ id: 1, submittedAt: "2026-08-01" }), fixtureRow({ id: 2, submittedAt: "2026-08-02" })],
  ]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((r) => r.id).sort(), [1, 2]);
});

test("mergeControlRows: orders by submittedAt desc, then id desc — same as listControlRows' own ORDER BY", () => {
  const merged = mergeControlRows([
    [
      fixtureRow({ id: 3, submittedAt: "2026-08-01T00:00:00Z" }),
      fixtureRow({ id: 1, submittedAt: "2026-08-03T00:00:00Z" }),
    ],
    [
      fixtureRow({ id: 2, submittedAt: "2026-08-03T00:00:00Z" }),
      fixtureRow({ id: 4, submittedAt: "2026-08-02T00:00:00Z" }),
    ],
  ]);
  // 2026-08-03 (ids 2,1, tie broken by id desc) then 08-02 (id 4) then 08-01 (id 3)
  assert.deepEqual(
    merged.map((r) => r.id),
    [2, 1, 4, 3],
  );
});

test("singleStackedValue: no picks or 2+ picks yield undefined — the export route only takes one exact value", () => {
  assert.equal(singleStackedValue(""), undefined);
  assert.equal(singleStackedValue(null), undefined);
  assert.equal(singleStackedValue("Approved,Submitted"), undefined);
});

test("singleStackedValue: exactly one pick passes through", () => {
  assert.equal(singleStackedValue("Approved"), "Approved");
});
