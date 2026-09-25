import { test } from "node:test";
import assert from "node:assert/strict";
import { submittedAckLead, submittedLead } from "./mail-copy";

test("the acknowledgement confirms, where the approver's copy asks", () => {
  // Sending the approver's wording to the requester tells them to approve their
  // own claim. That is the whole reason this is a second wording and not a
  // second recipient on the first.
  const ack = submittedAckLead("เคลียร์คืนเงินทดรองจ่าย", "ADC26-09046", "ผู้จัดการ");
  assert.match(ack, /ระบบได้รับคำขอ/);
  assert.doesNotMatch(ack, /กรุณาพิจารณาและอนุมัติ/);
  assert.match(submittedLead("เคลียร์คืนเงินทดรองจ่าย", "ADC26-09046"), /กรุณาพิจารณาและอนุมัติ/);
});

test("it names the document and who has it next", () => {
  const ack = submittedAckLead("เบิกเงินทดรองจ่าย", "ADV26-00061", "หัวหน้าบัญชี");
  assert.match(ack, /ADV26-00061/);
  assert.match(ack, /หัวหน้าบัญชี/);
});

test("with no next step it still reads as a sentence", () => {
  for (const step of [undefined, null, "", "   "]) {
    const ack = submittedAckLead("เบิกเงินทดรองจ่าย", "ADV26-00061", step);
    assert.match(ack, /อยู่ระหว่างรอการพิจารณา/);
    assert.doesNotMatch(ack, /จาก <b><\/b>/);
  }
});

test("a missing running number is dropped, never printed as a dash", () => {
  const ack = submittedAckLead("เบิกเงินทดรองจ่าย", null, "หัวหน้าบัญชี");
  assert.doesNotMatch(ack, /เลขที่เอกสาร/);
  assert.match(ack, /ระบบได้รับคำขอ/);
});

test("the form name and the step are escaped", () => {
  const ack = submittedAckLead("<script>", "A&B", "<b>x</b>");
  assert.doesNotMatch(ack, /<script>/);
  assert.match(ack, /&lt;script&gt;/);
  assert.match(ack, /A&amp;B/);
});
