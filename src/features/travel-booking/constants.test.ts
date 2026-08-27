import { test } from "node:test";
import assert from "node:assert/strict";

import {
  STATUS_LABEL_TH,
  isPendingTravelBookingStatus,
  statusLabelDisplay,
  travelBookingStatusLabel,
} from "./constants";

/**
 * `constants.ts` imports nothing but a type, so it runs here with no database
 * and no environment — the same reason `src/features/reimburse/constants.ts`
 * is where AP-4 puts anything pure that needs a test.
 *
 * What is under test is one claim: since the accounting step was inserted,
 * `Status='ManagerApproved'` no longer names a stage, so a label built from the
 * status alone is wrong for half that status's life. The old value of
 * `STATUS_LABEL_TH.ManagerApproved` was literally "รอ Admin จองให้", and it
 * reached the Excel export.
 */

test("the ManagerApproved status label no longer names the Admin stage", () => {
  // The base label has to be true of both stages, because callers with no step
  // in hand (the report's status filter, for one) still render it.
  assert.equal(STATUS_LABEL_TH.ManagerApproved, "ผู้จัดการอนุมัติแล้ว");
  assert.doesNotMatch(STATUS_LABEL_TH.ManagerApproved, /Admin/);
});

test("the step tells the two ManagerApproved stages apart", () => {
  assert.equal(travelBookingStatusLabel("ManagerApproved", "ADMIN"), "รอ Admin จองให้");
  assert.equal(travelBookingStatusLabel("ManagerApproved", "ACCOUNT"), "รอบัญชีตรวจสอบ");
});

test("no step, or one this file has never heard of, falls back to the stage-neutral label", () => {
  assert.equal(travelBookingStatusLabel("ManagerApproved"), "ผู้จัดการอนุมัติแล้ว");
  assert.equal(travelBookingStatusLabel("ManagerApproved", null), "ผู้จัดการอนุมัติแล้ว");
  // A future step code must not make the label vanish or read as a raw code.
  assert.equal(travelBookingStatusLabel("ManagerApproved", "SOMETHING_NEW"), "ผู้จัดการอนุมัติแล้ว");
});

test("a step is ignored for every status that does not span two stages", () => {
  assert.equal(travelBookingStatusLabel("Submitted", "MANAGER"), STATUS_LABEL_TH.Submitted);
  assert.equal(travelBookingStatusLabel("Completed", "ACCOUNT"), "เสร็จสิ้น");
  assert.equal(travelBookingStatusLabel("Rejected", "ADMIN"), "ไม่อนุมัติ");
});

test("an unknown status is echoed rather than rendered blank", () => {
  assert.equal(travelBookingStatusLabel("SomethingElse"), "SomethingElse");
  assert.equal(statusLabelDisplay("SomethingElse"), "SomethingElse");
});

test("every pending stage still collapses to one badge label", () => {
  // The badge deliberately says less than the label: it had shown "รอดำเนินการ"
  // for both pending statuses, and moving the ManagerApproved wording must not
  // have changed that.
  assert.equal(statusLabelDisplay("Submitted"), "รอดำเนินการ");
  assert.equal(statusLabelDisplay("ManagerApproved"), "รอดำเนินการ");
  assert.equal(statusLabelDisplay("ManagerApproved", "ADMIN"), "รอดำเนินการ");
  assert.equal(statusLabelDisplay("ManagerApproved", "ACCOUNT"), "รอดำเนินการ");
  assert.equal(statusLabelDisplay("Completed"), "เสร็จสิ้น");
});

test("the pending set is exactly the two statuses the badge collapses", () => {
  assert.equal(isPendingTravelBookingStatus("Submitted"), true);
  assert.equal(isPendingTravelBookingStatus("ManagerApproved"), true);
  for (const s of ["Draft", "Completed", "Rejected", "Returned", "Cancelled"]) {
    assert.equal(isPendingTravelBookingStatus(s), false, `${s} is not pending`);
  }
});
