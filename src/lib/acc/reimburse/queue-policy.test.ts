import { test } from "node:test";
import assert from "node:assert/strict";
import { belongsInAccountQueue } from "./queue-policy";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";

test("only AP-4 at (ManagerApproved, ACCOUNT) is in the accounting queue", () => {
  assert.equal(belongsInAccountQueue(AP4_FORM_CODE, "ManagerApproved", "ACCOUNT"), true);
});

/**
 * The whole point of taking `formCode`. AP-1 parks its own claims at the
 * IDENTICAL `(ManagerApproved, ACCOUNT)` tuple (`STATUS_AT_STEP`, AP-1's
 * `approval-engine.ts`), so a status-and-step-only predicate has no way to
 * refuse this row — it genuinely matches. Three rounds of trying to keep AP-1
 * out with a regex over `queue-service.ts`'s SQL text each found a
 * rearrangement that kept the pinned substrings and lost the meaning; this is
 * the test none of those regexes could stand in for, because there was
 * nothing in the old signature for an AP-1 id to be wrong about.
 */
test("AP-1 at the identical tuple is OUT", () => {
  assert.equal(belongsInAccountQueue("AP-1", "ManagerApproved", "ACCOUNT"), false);
});

/** Any form that is not AP-4 is out, not only AP-1 by name — an allow-list, not a deny-list of one. */
test("a made-up form code at the identical tuple is also out", () => {
  assert.equal(belongsInAccountQueue("AP-99", "ManagerApproved", "ACCOUNT"), false);
});

test("the SAME status at the final step is not", () => {
  // ACCOUNT and ACCOUNT_FINAL both sit at ManagerApproved and are told apart
  // ONLY by the step. A predicate on status alone would put every claim in both
  // queues, and the two-person rule would then be the only thing between one
  // person and both signatures.
  assert.equal(belongsInAccountQueue(AP4_FORM_CODE, "ManagerApproved", "ACCOUNT_FINAL"), false);
});

test("every other state is out", () => {
  for (const [status, step] of [
    ["Draft", null], ["Submitted", "MANAGER"], ["Returned", null],
    ["Rejected", null], ["Cancelled", null], ["Approved", null],
    ["ManagerApproved", null],
  ] as const) {
    assert.equal(belongsInAccountQueue(AP4_FORM_CODE, status, step), false, `${status}/${step}`);
  }
});

test("an unknown status is out — an allow-list, not a deny-list", () => {
  // A status added later is far more likely to be another terminal state than
  // another queue-able one, and showing a claim in the wrong queue is the
  // expensive direction.
  assert.equal(belongsInAccountQueue(AP4_FORM_CODE, "SomethingNew", "ACCOUNT"), false);
});
