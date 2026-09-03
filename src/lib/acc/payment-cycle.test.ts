import { test } from "node:test";
import assert from "node:assert/strict";
import { paymentDateForApproval } from "./payment-cycle";

/**
 * Which payment round a manager-approved AP-1 claim is meant for.
 *
 * **The deadline is noon on the Monday of the round's own week**, not noon on
 * the day the manager clicked. Until 2026-09-03 this read
 * `approvedAt.getHours() >= 12` and skipped a round on any afternoon approval,
 * so TOF26-09046 — approved Thu 03/09 16:31, a full four days before its
 * round's Monday — was suggested 25/09 instead of 11/09.
 */

/** September 2026 pays on Fri 11 and Fri 25; their Mondays are the 7th and 21st. */
const SEP = ["2026-09-11", "2026-09-25", "2026-10-09", "2026-10-23"];

test("the reported case: Thursday afternoon still makes that week's round", () => {
  assert.equal(paymentDateForApproval(new Date(2026, 8, 3, 16, 31), SEP), "2026-09-11");
});

test("morning on the round's own Monday is in time", () => {
  assert.equal(paymentDateForApproval(new Date(2026, 8, 7, 9, 0), SEP), "2026-09-11");
});

/** "At or before" — exactly noon still counts. */
test("exactly Monday noon is in time", () => {
  assert.equal(paymentDateForApproval(new Date(2026, 8, 7, 12, 0), SEP), "2026-09-11");
});

test("a minute past its Monday noon falls to the next round", () => {
  assert.equal(paymentDateForApproval(new Date(2026, 8, 7, 12, 1), SEP), "2026-09-25");
});

/**
 * **Each round is measured against its own Monday.** Past one deadline the claim
 * is compared with the next round's, which is normally weeks away — not skipped
 * by a fixed count of rounds, which is what the old rule did.
 */
test("the next round is judged by its own Monday, not by skipping one", () => {
  assert.equal(paymentDateForApproval(new Date(2026, 8, 21, 12, 0), SEP), "2026-09-25");
  assert.equal(paymentDateForApproval(new Date(2026, 8, 21, 12, 1), SEP), "2026-10-09");
});

/** Approving on the payment Friday itself: that batch is long closed. */
test("approving on a payment Friday is for a later round", () => {
  assert.equal(paymentDateForApproval(new Date(2026, 8, 11, 9, 0), SEP), "2026-09-25");
});

/**
 * Running off the end of the calendar answers null rather than naming the last
 * round — that would be a guess presented as a computation.
 */
test("past every round given, the answer is not known", () => {
  assert.equal(paymentDateForApproval(new Date(2026, 9, 20, 12, 1), SEP), null);
  assert.equal(paymentDateForApproval(new Date(2026, 8, 3), []), null);
});

test("no approval time, no suggestion", () => {
  assert.equal(paymentDateForApproval(null, SEP), null);
  assert.equal(paymentDateForApproval(undefined, SEP), null);
  assert.equal(paymentDateForApproval(new Date("nonsense"), SEP), null);
});

/**
 * The dates arrive holiday-shifted, and the Monday is read off whatever date is
 * given. A Friday walked back to the Thursday of the same week keeps the same
 * Monday, so the shift does not move the deadline.
 */
test("a round shifted back within its own week keeps its Monday", () => {
  assert.equal(
    paymentDateForApproval(new Date(2026, 8, 7, 11, 0), ["2026-09-10", "2026-09-25"]),
    "2026-09-10",
  );
});
