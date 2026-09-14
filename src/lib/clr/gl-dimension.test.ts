import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dimensionFromChecks,
  dimensionChecks,
  nextDimension,
} from "./gl-dimension";

/*
 * WHICH categories a line may charge is NOT here — `allowedDimensionTypes`
 * (`./clear-advance-gl-filter.ts`) already answers it, and its rule is subtler
 * than it looks: an HQ branch code counts as "no branch", so a line at HQ01
 * charges the Employee categories. A second copy would be a worse one.
 */

/* ── the two checkboxes and the stored value are the same fact ── */

test("each tick pair has exactly one stored value", () => {
  assert.equal(dimensionFromChecks({ branch: false, employee: true }), "Employee");
  assert.equal(dimensionFromChecks({ branch: true, employee: false }), "Branch");
  assert.equal(dimensionFromChecks({ branch: true, employee: true }), "Both");
});

test("neither ticked has no stored value at all", () => {
  // There is no 'None' in the column, and that is the design: a category
  // nobody may charge is IsActive = 0, not a row with an empty dimension.
  assert.equal(dimensionFromChecks({ branch: false, employee: false }), null);
});

test("the round trip is exact in both directions", () => {
  for (const d of ["Employee", "Branch", "Both"] as const) {
    assert.equal(dimensionFromChecks(dimensionChecks(d)), d, d);
  }
});

test("'Both' means both boxes, not a third box", () => {
  assert.deepEqual(dimensionChecks("Both"), { branch: true, employee: true });
});

/* ── what one click does ── */

test("ticking the second box widens the row to Both", () => {
  assert.deepEqual(nextDimension("Employee", "branch", true), { kind: "set", dimensionType: "Both" });
});

test("unticking one of two narrows it to the other", () => {
  assert.deepEqual(nextDimension("Both", "branch", false), { kind: "set", dimensionType: "Employee" });
  assert.deepEqual(nextDimension("Both", "employee", false), { kind: "set", dimensionType: "Branch" });
});

test("unticking the LAST box CLEARS the company's rule", () => {
  // Not a refusal. The column has no value for "neither", but the screen has
  // always had a state for it — "ยังไม่ได้ตั้งค่าให้ PCTH", which is simply no
  // row — so unticking the last box returns the account to exactly where it was
  // before anybody touched it. Refusing instead left a row ticked by accident
  // with no way back at all.
  assert.deepEqual(nextDimension("Employee", "employee", false), { kind: "clear" });
  assert.deepEqual(nextDimension("Branch", "branch", false), { kind: "clear" });
});

test("ticking a box that is already ticked changes nothing and is not an error", () => {
  assert.deepEqual(nextDimension("Both", "branch", true), { kind: "set", dimensionType: "Both" });
  assert.deepEqual(nextDimension("Employee", "employee", true), { kind: "set", dimensionType: "Employee" });
});

/* ── a row this company has no rule for yet ── */

test("ticking one box on an unruled row gives THAT box, not both", () => {
  // The screen lists every postable account, so most rows start with no rule
  // at all. Passing a pretend `Employee` in and ticking Branch answers `Both`
  // — one click silently ticking two boxes, on the setting that decides what a
  // line charging the account must carry. `null` has to reach the rule.
  assert.deepEqual(nextDimension(null, "branch", true), { kind: "set", dimensionType: "Branch" });
  assert.deepEqual(nextDimension(null, "employee", true), { kind: "set", dimensionType: "Employee" });
});

test("unticking on an unruled row clears a rule that is already absent", () => {
  // Unreachable from the screen — there is nothing ticked to untick — and
  // harmless: the delete it asks for finds nothing to delete.
  assert.deepEqual(nextDimension(null, "branch", false), { kind: "clear" });
});
