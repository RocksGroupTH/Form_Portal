import { test } from "node:test";
import assert from "node:assert/strict";
import { refundEvidenceMissing } from "./refund-evidence";

/* A clearing submitted as "the company owes me" can become "I owe the company"
   without the requester touching it: accounting disallows an expense at the
   ACCOUNT step, persistClear recomputes RefundToCompany from the edited lines,
   and the sign flips. The transfer date and the slip were never asked for,
   because at submit the money was going the other way — and the employee has
   not transferred anything, because until that edit they did not owe it. */

const ok = { refundToCompany: 250, refundTransferDate: "2026-08-17", proofCount: 1 };

test("a clearing the employee really did refund is complete", () => {
  assert.equal(refundEvidenceMissing(ok), null);
});

test("a sign flip is caught: money is owed and nothing was ever transferred", () => {
  assert.equal(
    refundEvidenceMissing({ refundToCompany: 250, refundTransferDate: null, proofCount: 0 }),
    "both",
  );
});

test("a date with no slip is still incomplete", () => {
  assert.equal(refundEvidenceMissing({ ...ok, proofCount: 0 }), "proof");
});

test("a slip with no date is still incomplete", () => {
  assert.equal(refundEvidenceMissing({ ...ok, refundTransferDate: null }), "date");
});

test("blank and whitespace are not a date", () => {
  assert.equal(refundEvidenceMissing({ ...ok, refundTransferDate: "" }), "date");
  assert.equal(refundEvidenceMissing({ ...ok, refundTransferDate: "   " }), "date");
});

test("the company paying out is not asked for a refund slip", () => {
  assert.equal(
    refundEvidenceMissing({ refundToCompany: -1519.85, refundTransferDate: null, proofCount: 0 }),
    null,
  );
});

test("a clearing that settled exactly owes nothing either way", () => {
  assert.equal(refundEvidenceMissing({ refundToCompany: 0, refundTransferDate: null, proofCount: 0 }), null);
  assert.equal(refundEvidenceMissing({ refundToCompany: null, refundTransferDate: null, proofCount: 0 }), null);
});

test("a slip for the wrong amount is deliberately not this rule's business", () => {
  // Accounting can change what is owed after the slip was attached. The detail
  // card already says so beside the figure, and blocking on it was scoped out
  // (user, 2026-09-10) — this rule is only about evidence that is absent.
  assert.equal(refundEvidenceMissing({ ...ok, refundToCompany: 400 }), null);
});
