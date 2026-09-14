import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DIMENSION_REQUIRED_ERROR,
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
  assert.deepEqual(nextDimension("Employee", "branch", true), { dimensionType: "Both", error: null });
});

test("unticking one of two narrows it to the other", () => {
  assert.deepEqual(nextDimension("Both", "branch", false), { dimensionType: "Employee", error: null });
  assert.deepEqual(nextDimension("Both", "employee", false), { dimensionType: "Branch", error: null });
});

test("unticking the LAST box is refused, and says what to do instead", () => {
  // Refused rather than stored, because the column cannot hold "neither" —
  // so "at least one dimension" is a property of the storage rather than a
  // check somebody has to remember to run. Turning the category off is what
  // `ใช้งาน` is for, and the message says so.
  const r = nextDimension("Employee", "employee", false);
  assert.equal(r.dimensionType, null);
  assert.equal(r.error, DIMENSION_REQUIRED_ERROR);
  assert.match(r.error ?? "", /ใช้งาน/);
});

test("ticking a box that is already ticked changes nothing and is not an error", () => {
  assert.deepEqual(nextDimension("Both", "branch", true), { dimensionType: "Both", error: null });
  assert.deepEqual(nextDimension("Employee", "employee", true), { dimensionType: "Employee", error: null });
});

/* ── a row this company has no rule for yet ── */

test("ticking one box on an unruled row gives THAT box, not both", () => {
  // The screen lists every postable account, so most rows start with no rule
  // at all. Passing a pretend `Employee` in and ticking Branch answers `Both`
  // — one click silently ticking two boxes, on the setting that decides what a
  // line charging the account must carry. `null` has to reach the rule.
  assert.deepEqual(nextDimension(null, "branch", true), { dimensionType: "Branch", error: null });
  assert.deepEqual(nextDimension(null, "employee", true), { dimensionType: "Employee", error: null });
});

test("unticking on an unruled row is refused like any other last box", () => {
  // Unreachable from the screen — there is nothing ticked to untick — but the
  // answer has to be a refusal rather than a stored "neither".
  const r = nextDimension(null, "branch", false);
  assert.equal(r.dimensionType, null);
  assert.equal(r.error, DIMENSION_REQUIRED_ERROR);
});
