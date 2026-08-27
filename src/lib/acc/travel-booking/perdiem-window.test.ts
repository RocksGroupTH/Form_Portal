import { test } from "node:test";
import assert from "node:assert/strict";
import { perDiemWritable } from "./perdiem-window";

test("a request still moving through the workflow may be rewritten", () => {
  assert.equal(perDiemWritable("Submitted"), true);
  assert.equal(perDiemWritable("ManagerApproved"), true);
  assert.equal(perDiemWritable("Returned"), true);
  assert.equal(perDiemWritable("Draft"), true);
});

/** Accounting has signed the figure. It is a decision, not a derivation. */
test("a completed request is frozen", () => {
  assert.equal(perDiemWritable("Completed"), false);
});

/** Not going to be paid at all — rewriting it would be noise in the log. */
test("a dead request is not rewritten either", () => {
  assert.equal(perDiemWritable("Cancelled"), false);
  assert.equal(perDiemWritable("Rejected"), false);
});

/**
 * Fails closed. A status this file has never heard of is more likely a new
 * terminal state than a new editable one, and writing over a paid figure is the
 * expensive mistake.
 */
test("an unknown status is refused", () => {
  assert.equal(perDiemWritable("Paid"), false);
  assert.equal(perDiemWritable(""), false);
  assert.equal(perDiemWritable("completed"), false);
});
