import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_VISIBLE_KEYS, controlAdjustment, type Adjustment } from "./clr-control-report-view";
import type { ClrControlRow } from "./clear-advance-report-service";

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
