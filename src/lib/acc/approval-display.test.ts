import { test } from "node:test";
import assert from "node:assert/strict";
import { APPROVAL_STEP_LABEL, formatNextApprovalDetail } from "./approval-display";

/**
 * `formatNextApprovalDetail` writes the "ลำดับถัดไป" line under every row in My
 * Requests and My Work.
 *
 * It is testable at all because `approval-display.ts` reaches no pool: its only
 * runtime import is `@/lib/acc/manager-auth`, which imports one import-free
 * module and reads two environment variables directly rather than through
 * `@/env`.
 */

const pending = (over: Record<string, unknown> = {}) => ({
  status: "ManagerApproved",
  currentStepCode: "ACCOUNT_FINAL",
  ...over,
});

test("AP-4's final accounting step gets a next-step line", () => {
  // The defect: `APPROVAL_STEP_LABEL` is keyed on AP-1's two-value `StepCode`,
  // and the guard was `!(step in APPROVAL_STEP_LABEL)` — so an AP-4 row sitting
  // at ACCOUNT_FINAL fell straight through and rendered nothing at all, in the
  // one place the list is meant to say what it is waiting for.
  const line = formatNextApprovalDetail(pending());
  assert.ok(line, "ACCOUNT_FINAL renders no next-step line");
  assert.ok(line.indexOf("ลำดับถัดไป") === 0, line);
  assert.ok(line.indexOf("ขั้นสุดท้าย") > 0, "the line does not say it is the final step: " + line);
});

test("an unassigned final step names the accounting pool, as ACCOUNT does", () => {
  // Both AP-4 accounting steps are assigned to a roster rather than a person,
  // so there is frequently no name to print.
  assert.equal(
    formatNextApprovalDetail(pending()),
    "ลำดับถัดไป: อนุมัติบัญชี (ขั้นสุดท้าย) · ฝ่ายบัญชี",
  );
});

test("a named approver on the final step is used in preference to the pool", () => {
  const line = formatNextApprovalDetail(pending({ pendingApproverName: "  สมชาย  " }));
  assert.equal(line, "ลำดับถัดไป: อนุมัติบัญชี (ขั้นสุดท้าย) · สมชาย");
});

test("the manager who approved is told accounting has it, at either accounting step", () => {
  for (const step of ["ACCOUNT", "ACCOUNT_FINAL"]) {
    assert.equal(
      formatNextApprovalDetail(pending({ currentStepCode: step, viewerManagerApproved: true })),
      "คุณอนุมัติแล้ว · รอบัญชีดำเนินการต่อ",
    );
  }
});

test("AP-1's two steps are unchanged", () => {
  assert.deepEqual(APPROVAL_STEP_LABEL, { MANAGER: "ผู้จัดการ", ACCOUNT: "บัญชี" });
  assert.equal(
    formatNextApprovalDetail({
      status: "Submitted",
      currentStepCode: "MANAGER",
      pendingApproverName: "Manager A",
    }),
    "ลำดับถัดไป: อนุมัติผู้จัดการ · Manager A",
  );
  assert.equal(
    formatNextApprovalDetail({ status: "ManagerApproved", currentStepCode: "ACCOUNT" }),
    "ลำดับถัดไป: อนุมัติบัญชี · ฝ่ายบัญชี",
  );
});

test("finished and unstarted rows still say nothing", () => {
  for (const status of ["Approved", "Rejected", "Cancelled", "Draft"]) {
    assert.equal(formatNextApprovalDetail({ status, currentStepCode: "ACCOUNT_FINAL" }), null);
  }
  assert.equal(
    formatNextApprovalDetail({ status: "Returned", currentStepCode: "MANAGER" }),
    "ลำดับถัดไป: แก้ไขและส่งคำขอใหม่",
  );
  // An unrecognised step is still refused rather than rendered as its raw code.
  assert.equal(formatNextApprovalDetail({ status: "Submitted", currentStepCode: "WAT" }), null);
  assert.equal(formatNextApprovalDetail({ status: "Submitted", currentStepCode: null }), null);
});
