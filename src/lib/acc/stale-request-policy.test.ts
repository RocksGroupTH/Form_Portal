import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTO_CANCEL_MONTHS, eligibleForAutoCancel } from "./stale-request-policy";

test("a request still sitting with the manager is eligible", () => {
  assert.equal(eligibleForAutoCancel({ status: "Submitted", stepCode: "MANAGER" }), true);
});

/**
 * The manager has acted. Everything past MANAGER belongs to somebody else's
 * queue, and expiring it would cancel work already approved.
 */
test("anything the manager has already acted on is not", () => {
  assert.equal(eligibleForAutoCancel({ status: "ManagerApproved", stepCode: "ACCOUNT" }), false);
  assert.equal(eligibleForAutoCancel({ status: "Approved", stepCode: null }), false);
  assert.equal(eligibleForAutoCancel({ status: "Rejected", stepCode: null }), false);
  assert.equal(eligibleForAutoCancel({ status: "Completed", stepCode: null }), false);
});

/** Never submitted, so no clock has started. A draft is the requester's to keep. */
test("a draft is never auto-cancelled", () => {
  assert.equal(eligibleForAutoCancel({ status: "Draft", stepCode: null }), false);
  assert.equal(eligibleForAutoCancel({ status: "Draft", stepCode: "MANAGER" }), false);
});

/** Returned is back with the requester to edit — their clock, not the manager's. */
test("a returned request is not, it is waiting on the requester", () => {
  assert.equal(eligibleForAutoCancel({ status: "Returned", stepCode: "MANAGER" }), false);
});

test("an already-cancelled request is not cancelled again", () => {
  assert.equal(eligibleForAutoCancel({ status: "Cancelled", stepCode: null }), false);
});

/**
 * Submitted but parked on some other step is not the case this describes, and
 * an allow-list is the safe direction: a tuple this file has never heard of is
 * left alone rather than cancelled.
 */
test("Submitted on any other step is left alone", () => {
  assert.equal(eligibleForAutoCancel({ status: "Submitted", stepCode: "ACCOUNT" }), false);
  assert.equal(eligibleForAutoCancel({ status: "Submitted", stepCode: null }), false);
  assert.equal(eligibleForAutoCancel({ status: "Submitted", stepCode: "SOMETHING_NEW" }), false);
});

test("the window is one month", () => {
  assert.equal(AUTO_CANCEL_MONTHS, 1);
});
