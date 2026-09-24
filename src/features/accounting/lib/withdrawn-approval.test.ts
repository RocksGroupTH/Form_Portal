import { test } from "node:test";
import assert from "node:assert/strict";
import {
  approvalActorPrefixFor,
  isWithdrawnApproval,
  withdrawnApprovalLabel,
} from "./withdrawn-approval";

/**
 * A cancelled request's closed approval row is not a return.
 *
 * `CK_AccApproval_Status` has no `Cancelled`, so every self-cancel path closes
 * the pending row as `Returned` and stamps the requester on it. Read literally
 * the timeline then says somebody sent the request back for editing, which is
 * the one thing a cancellation is not — reported against a cancelled AP-1 claim
 * on 2026-09-24, whose own badge said ยกเลิก two inches below.
 */

/* ── the rule needs both halves ── */

test("a Returned row on a Cancelled request is a withdrawal", () => {
  assert.equal(isWithdrawnApproval("Cancelled", "Returned"), true);
});

test("a Returned row on a live request is an ordinary return", () => {
  // The overwhelmingly common case: a manager really did send it back.
  for (const s of ["Returned", "Submitted", "ManagerApproved", "Approved", "Rejected"]) {
    assert.equal(isWithdrawnApproval(s, "Returned"), false, s);
  }
});

test("any other row on a Cancelled request is what it says", () => {
  // A manager who approved before the requester withdrew it really did approve.
  for (const s of ["Approved", "Rejected", "Pending"]) {
    assert.equal(isWithdrawnApproval("Cancelled", s), false, s);
  }
});

test("absent inputs are not a withdrawal", () => {
  assert.equal(isWithdrawnApproval(null, "Returned"), false);
  assert.equal(isWithdrawnApproval("Cancelled", null), false);
  assert.equal(isWithdrawnApproval(undefined, undefined), false);
});

/* ── the chip ── */

test("the chip says who really did it", () => {
  assert.equal(withdrawnApprovalLabel("Cancelled", "Returned"), "ยกเลิกโดยผู้ขอ");
});

test("null means the ordinary label, so a caller needs no branch of its own", () => {
  assert.equal(withdrawnApprovalLabel("Submitted", "Returned"), null);
  assert.equal(withdrawnApprovalLabel("Cancelled", "Approved"), null);
});

/* ── the actor line ── */

test("the prefix follows the row, not the request, except on a withdrawal", () => {
  assert.equal(approvalActorPrefixFor("Approved", "Cancelled"), "อนุมัติโดย");
  assert.equal(approvalActorPrefixFor("Rejected", "Cancelled"), "ไม่อนุมัติโดย");
  assert.equal(approvalActorPrefixFor("Returned", "Cancelled"), "ยกเลิกโดย");
});

test("an ordinary return still reads ส่งกลับโดย", () => {
  assert.equal(approvalActorPrefixFor("Returned", "Returned"), "ส่งกลับโดย");
  assert.equal(approvalActorPrefixFor("Returned", "Submitted"), "ส่งกลับโดย");
});

test("the request status is optional, and omitting it never invents a withdrawal", () => {
  // A caller that has not threaded it through gets today's wording rather than
  // a wrong one — the safe direction for a partially-converted page.
  assert.equal(approvalActorPrefixFor("Returned"), "ส่งกลับโดย");
  assert.equal(approvalActorPrefixFor("Approved"), "อนุมัติโดย");
});

test("a pending row reads as pending whatever the request says", () => {
  assert.equal(approvalActorPrefixFor("Pending", "Cancelled"), "รอดำเนินการโดย");
  assert.equal(approvalActorPrefixFor("Pending", "Submitted"), "รอดำเนินการโดย");
});

test("an unrecognised row status falls to the pending wording, not to a crash", () => {
  assert.equal(approvalActorPrefixFor("Something", "Cancelled"), "รอดำเนินการโดย");
  assert.equal(approvalActorPrefixFor(null, null), "รอดำเนินการโดย");
});
