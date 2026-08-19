import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultPaymentRound } from "./payment-calendar";
import { FINAL_SAME_PERSON_ERROR } from "./two-person";
import {
  ACCOUNT_ACTOR_UNKNOWN_ERROR,
  NOT_ACCOUNT_APPROVER_ERROR,
  PAYMENT_DATE_NOT_A_ROUND,
  PAYMENT_DATE_REQUIRED,
  REJECT_COMMENT_REQUIRED,
  STATE_AFTER_APPROVE,
  STATUS_AT_STEP,
  STEP_ORDER,
  accountCheckActorStaffId,
  finalStepRefusal,
  findActiveApprover,
  isAccountStep,
  isReimburseStepCode,
  isYmd,
  paymentDateError,
  rejectCommentOrError,
  upcomingPaymentRounds,
} from "./approval-policy";
import type { ReimburseApproval, ReimburseApprover } from "@/features/reimburse/types";

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function approver(p: Partial<ReimburseApprover> & { staffId: number }): ReimburseApprover {
  return {
    id: p.id ?? p.staffId,
    staffId: p.staffId,
    email: p.email ?? `staff${p.staffId}@rocksgroup.com`,
    displayName: p.displayName ?? `Staff ${p.staffId}`,
    isActive: p.isActive ?? true,
  };
}

function approval(p: Partial<ReimburseApproval> & { stepCode: ReimburseApproval["stepCode"] }): ReimburseApproval {
  return {
    id: p.id ?? 1,
    requestId: p.requestId ?? 900001,
    stepCode: p.stepCode,
    stepOrder: p.stepOrder ?? STEP_ORDER[p.stepCode],
    assignedTo: p.assignedTo ?? null,
    assignedEmail: p.assignedEmail ?? null,
    status: p.status ?? "Pending",
    comment: p.comment ?? null,
    isChecked: p.isChecked ?? null,
    actionedByStaffId: p.actionedByStaffId ?? null,
    actionedAt: p.actionedAt ?? null,
    createdAt: p.createdAt ?? "",
  };
}

/* ─────────────────────────── the state machine ─────────────────────────── */

test("the two accounting steps share ManagerApproved, so a claim must name the step too", () => {
  assert.equal(STATUS_AT_STEP.ACCOUNT, "ManagerApproved");
  assert.equal(STATUS_AT_STEP.ACCOUNT_FINAL, "ManagerApproved");
  // Which is exactly why the step codes have to differ.
  assert.notEqual(STEP_ORDER.ACCOUNT, STEP_ORDER.ACCOUNT_FINAL);
});

test("approving each step lands where the spec says", () => {
  assert.deepEqual(STATE_AFTER_APPROVE.MANAGER, { status: "ManagerApproved", nextStep: "ACCOUNT" });
  assert.deepEqual(STATE_AFTER_APPROVE.ACCOUNT, { status: "ManagerApproved", nextStep: "ACCOUNT_FINAL" });
  assert.deepEqual(STATE_AFTER_APPROVE.ACCOUNT_FINAL, { status: "Approved", nextStep: null });
});

test("the step codes are the three AP-4 uses and nothing else", () => {
  assert.equal(isReimburseStepCode("ACCOUNT_FINAL"), true);
  assert.equal(isReimburseStepCode("HEAD_ACCOUNT"), false);
  assert.equal(isReimburseStepCode(null), false);
  assert.equal(isAccountStep("MANAGER"), false);
  assert.equal(isAccountStep("ACCOUNT"), true);
  assert.equal(isAccountStep("ACCOUNT_FINAL"), true);
});

/* ─────────────────────────── the approver pool ─────────────────────────── */

test("an active approver is found by StaffId", () => {
  const roster = [approver({ staffId: 10176 }), approver({ staffId: 10177 })];
  assert.equal(findActiveApprover(roster, 10177, null)?.staffId, 10177);
});

test("an approver with no HR StaffId is still found by their login email, case-folded", () => {
  const roster = [approver({ staffId: 10176, email: "Q.Somsri@rocksgroup.com" })];
  assert.equal(findActiveApprover(roster, null, "  q.somsri@ROCKSGROUP.com ")?.staffId, 10176);
});

test("a deactivated approver is not found by either key", () => {
  const roster = [approver({ staffId: 10176, email: "gone@rocksgroup.com", isActive: false })];
  assert.equal(findActiveApprover(roster, 10176, "gone@rocksgroup.com"), null);
});

test("somebody outside the pool is not an approver, whatever their StaffId", () => {
  const roster = [approver({ staffId: 10176 })];
  assert.equal(findActiveApprover(roster, 99999, "someone@rocksgroup.com"), null);
  assert.equal(findActiveApprover([], 10176, "staff10176@rocksgroup.com"), null);
  assert.equal(NOT_ACCOUNT_APPROVER_ERROR.length > 0, true);
});

test("StaffId wins over email, so an actor acts as their own roster row", () => {
  const roster = [
    approver({ staffId: 10176, email: "shared@rocksgroup.com" }),
    approver({ staffId: 10177, email: "shared@rocksgroup.com" }),
  ];
  assert.equal(findActiveApprover(roster, 10177, "shared@rocksgroup.com")?.staffId, 10177);
});

/* ─────────────────────────── the two-person rule ─────────────────────────── */

test("the step-2 actor is read off the approved ACCOUNT row", () => {
  const approvals = [
    approval({ stepCode: "MANAGER", status: "Approved", actionedByStaffId: 5001 }),
    approval({ stepCode: "ACCOUNT", status: "Approved", actionedByStaffId: 10176 }),
    approval({ stepCode: "ACCOUNT_FINAL", status: "Pending" }),
  ];
  assert.equal(accountCheckActorStaffId(approvals), 10176);
});

test("a pending or rejected ACCOUNT row names nobody", () => {
  assert.equal(accountCheckActorStaffId([approval({ stepCode: "ACCOUNT", status: "Pending" })]), null);
  assert.equal(
    accountCheckActorStaffId([approval({ stepCode: "ACCOUNT", status: "Rejected", actionedByStaffId: 10176 })]),
    null,
  );
  assert.equal(accountCheckActorStaffId(null), null);
  assert.equal(accountCheckActorStaffId([]), null);
});

test("the same person is refused with the reason, not with a bare no-permission", () => {
  assert.equal(finalStepRefusal(10176, 10176), FINAL_SAME_PERSON_ERROR);
});

test("a different approver is not refused at all", () => {
  assert.equal(finalStepRefusal(10177, 10176), null);
});

test("StaffId 0 is a present id on either side, not a missing one", () => {
  // `canActFinalStep` compares with `== null` for exactly this case; a
  // truthiness guard in front of it would deny a legitimate approval.
  assert.equal(finalStepRefusal(0, 10176), null);
  assert.equal(finalStepRefusal(10176, 0), null);
  assert.equal(finalStepRefusal(0, 0), FINAL_SAME_PERSON_ERROR);
});

test("an unrecorded step-2 actor says so rather than accusing anyone", () => {
  assert.equal(finalStepRefusal(10177, null), ACCOUNT_ACTOR_UNKNOWN_ERROR);
  assert.equal(finalStepRefusal(null, 10176), ACCOUNT_ACTOR_UNKNOWN_ERROR);
});

/* ─────────────────────────── inputs off the wire ─────────────────────────── */

test("a rejection without a reason is refused, whitespace included", () => {
  assert.equal(rejectCommentOrError("   ").error, REJECT_COMMENT_REQUIRED);
  assert.equal(rejectCommentOrError("").error, REJECT_COMMENT_REQUIRED);
  assert.equal(rejectCommentOrError(undefined).error, REJECT_COMMENT_REQUIRED);
  assert.equal(rejectCommentOrError(42).error, REJECT_COMMENT_REQUIRED);
});

test("a reason is trimmed and kept", () => {
  assert.deepEqual(rejectCommentOrError("  ใบเสร็จไม่ครบ  "), { comment: "ใบเสร็จไม่ครบ", error: null });
});

test("a YYYY-MM-DD that is not a real day is not a date", () => {
  assert.equal(isYmd("2026-08-07"), true);
  assert.equal(isYmd("2026-02-31"), false);
  assert.equal(isYmd("2026-13-01"), false);
  assert.equal(isYmd("07/08/2026"), false);
  assert.equal(isYmd(null), false);
});

test("a payment date the picker would not offer is refused", () => {
  const valid = ["2026-08-07", "2026-08-21"];
  assert.equal(paymentDateError("2026-08-07", valid), null);
  // A perfectly real Friday — just the 2nd one, which is AP-1's round.
  assert.equal(paymentDateError("2026-08-14", valid), PAYMENT_DATE_NOT_A_ROUND);
  assert.equal(paymentDateError("", valid), PAYMENT_DATE_REQUIRED);
  assert.equal(paymentDateError(undefined, valid), PAYMENT_DATE_REQUIRED);
});

/* ─────────────────────────── the default round ─────────────────────────── */

test("the rounds handed to defaultPaymentRound are sorted ascending", () => {
  const rounds = upcomingPaymentRounds(new Date(2026, 7, 3), 4);
  const sorted = rounds.slice().sort((a, b) => a.getTime() - b.getTime());
  assert.deepEqual(rounds.map(ymd), sorted.map(ymd));
  // Two per month over five months (the anchor month plus four).
  assert.equal(rounds.length, 10);
  assert.equal(ymd(rounds[0]), "2026-08-07");
});

test("the rounds start at the anchor month even when its first round has passed", () => {
  // The list is not filtered by `from`; it is the calendar, and
  // `defaultPaymentRound` is what drops the rounds that are no longer reachable.
  const rounds = upcomingPaymentRounds(new Date(2026, 7, 25), 1);
  assert.equal(ymd(rounds[0]), "2026-08-07");
  assert.equal(ymd(defaultPaymentRound(new Date(2026, 7, 25), rounds)!), "2026-09-04");
});

test("the default off the real round list is the first one still in time", () => {
  const rounds = upcomingPaymentRounds(new Date(2026, 7, 3), 4);
  // Monday 3 Aug 2026 11:00 — that week's Friday is the 1st round of August.
  assert.equal(ymd(defaultPaymentRound(new Date(2026, 7, 3, 11, 0), rounds)!), "2026-08-07");
  // Monday 13:00 — past that round's own Monday noon, so the next round.
  assert.equal(ymd(defaultPaymentRound(new Date(2026, 7, 3, 13, 0), rounds)!), "2026-08-21");
});
