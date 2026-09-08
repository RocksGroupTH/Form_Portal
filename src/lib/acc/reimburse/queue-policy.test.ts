import { test } from "node:test";
import assert from "node:assert/strict";
import { belongsInAccountQueue } from "./queue-policy";

test("only (ManagerApproved, ACCOUNT) is in the accounting queue", () => {
  assert.equal(belongsInAccountQueue("ManagerApproved", "ACCOUNT"), true);
});

test("the SAME status at the final step is not", () => {
  // ACCOUNT and ACCOUNT_FINAL both sit at ManagerApproved and are told apart
  // ONLY by the step. A predicate on status alone would put every claim in both
  // queues, and the two-person rule would then be the only thing between one
  // person and both signatures.
  assert.equal(belongsInAccountQueue("ManagerApproved", "ACCOUNT_FINAL"), false);
});

test("every other state is out", () => {
  for (const [status, step] of [
    ["Draft", null], ["Submitted", "MANAGER"], ["Returned", null],
    ["Rejected", null], ["Cancelled", null], ["Approved", null],
    ["ManagerApproved", null],
  ] as const) {
    assert.equal(belongsInAccountQueue(status, step), false, `${status}/${step}`);
  }
});

test("an unknown status is out — an allow-list, not a deny-list", () => {
  // A status added later is far more likely to be another terminal state than
  // another queue-able one, and showing a claim in the wrong queue is the
  // expensive direction.
  assert.equal(belongsInAccountQueue("SomethingNew", "ACCOUNT"), false);
});
