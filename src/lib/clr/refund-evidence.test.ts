import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { refundEvidenceMissing, refundEvidenceMessage } from "./refund-evidence";

/* A clearing submitted as "the company owes me" can become "I owe the company"
   without the requester touching it: accounting disallows an expense at the
   ACCOUNT step, persistClear recomputes RefundToCompany from the edited lines,
   and the sign flips. The transfer date, its amount and the slip were never
   asked for, because at submit the money was going the other way — and the
   employee has not transferred anything, because until that edit they did
   not owe it. */

const ok = {
  refundToCompany: 250,
  refundTransferDate: "2026-08-17",
  refundTransferAmount: 500,
  proofCount: 1,
};

test("a clearing the employee really did refund is complete", () => {
  assert.equal(refundEvidenceMissing(ok), null);
});

test("a sign flip is caught: money is owed and nothing was ever transferred", () => {
  assert.deepEqual(
    refundEvidenceMissing({
      refundToCompany: 250,
      refundTransferDate: null,
      refundTransferAmount: 500,
      proofCount: 0,
    }),
    ["date", "proof"],
  );
});

test("a date with no slip is still incomplete", () => {
  assert.deepEqual(refundEvidenceMissing({ ...ok, proofCount: 0 }), ["proof"]);
});

test("a slip with no date is still incomplete", () => {
  assert.deepEqual(refundEvidenceMissing({ ...ok, refundTransferDate: null }), ["date"]);
});

test("blank and whitespace are not a date", () => {
  assert.deepEqual(refundEvidenceMissing({ ...ok, refundTransferDate: "" }), ["date"]);
  assert.deepEqual(refundEvidenceMissing({ ...ok, refundTransferDate: "   " }), ["date"]);
});

test("the company paying out is not asked for a refund slip", () => {
  assert.equal(
    refundEvidenceMissing({
      refundToCompany: -1519.85,
      refundTransferDate: null,
      refundTransferAmount: null,
      proofCount: 0,
    }),
    null,
  );
});

test("a clearing that settled exactly owes nothing either way", () => {
  assert.equal(
    refundEvidenceMissing({
      refundToCompany: 0,
      refundTransferDate: null,
      refundTransferAmount: null,
      proofCount: 0,
    }),
    null,
  );
  assert.equal(
    refundEvidenceMissing({
      refundToCompany: null,
      refundTransferDate: null,
      refundTransferAmount: null,
      proofCount: 0,
    }),
    null,
  );
});

test("a slip for the wrong amount is deliberately not this rule's business", () => {
  // Accounting can change what is owed after the slip was attached. The detail
  // card already says so beside the figure, and blocking on it was scoped out
  // (user, 2026-09-10) — this rule is only about evidence that is absent.
  assert.equal(refundEvidenceMissing({ ...ok, refundToCompany: 400 }), null);
});

describe("the amount is evidence too", () => {
  const owed = { refundToCompany: 500, refundTransferDate: "2026-09-01", proofCount: 1 };

  test("reports the amount when only the amount is missing", () => {
    assert.deepEqual(refundEvidenceMissing({ ...owed, refundTransferAmount: null }), ["amount"]);
  });

  test("reports nothing when all three are present", () => {
    assert.equal(refundEvidenceMissing({ ...owed, refundTransferAmount: 500 }), null);
  });

  test("treats a zero transferred amount as missing", () => {
    // Zero is not a transfer. The bank line would post nothing and the
    // clearing would look settled.
    assert.deepEqual(refundEvidenceMissing({ ...owed, refundTransferAmount: 0 }), ["amount"]);
  });

  test("lists every missing piece, in a stable order", () => {
    assert.deepEqual(
      refundEvidenceMissing({
        refundToCompany: 500,
        refundTransferDate: null,
        proofCount: 0,
        refundTransferAmount: null,
      }),
      ["date", "amount", "proof"],
    );
  });

  test("stays silent when nothing is owed, however empty the evidence", () => {
    assert.equal(
      refundEvidenceMissing({
        refundToCompany: 0,
        refundTransferDate: null,
        proofCount: 0,
        refundTransferAmount: null,
      }),
      null,
    );
  });
});

describe("refundEvidenceMessage names what is missing", () => {
  test("names one piece", () => {
    assert.match(refundEvidenceMessage(["amount"]), /ยอดเงินที่โอนคืน/);
  });

  test("joins three pieces without repeating the instruction", () => {
    const msg = refundEvidenceMessage(["date", "amount", "proof"]);
    assert.match(msg, /วันที่โอนเงินคืน/);
    assert.match(msg, /ยอดเงินที่โอนคืน/);
    assert.match(msg, /หลักฐานการโอน/);
    assert.equal(msg.match(/ส่งกลับแก้ไข/g)?.length, 1);
  });
});
