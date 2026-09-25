import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildClearAdvanceEmailHtml,
  type ClrEmailData,
  type ClrEmailTrigger,
} from "./clear-advance-email-core";

const CTA = '<p><a href="https://x/req/1">เปิดเอกสาร</a></p>';

const FULL: ClrEmailData = {
  id: 901150,
  requestNo: "ADC26-09044",
  requesterFullName: "Pasapong Pisanupoj",
  brandCode: "ROCKS",
  advanceRequestNo: "ADV26-00008",
  actualTotal: 1859,
  refundToCompany: -1529.85,
  paymentDate: "2026-10-02",
  stepLabel: "ผู้จัดการ",
};

const ALL: ClrEmailTrigger[] = [
  "Submitted",
  "SubmittedAck",
  "Approved",
  "Rejected",
  "Returned",
  "CancelledByAccount",
  "CancelledByRequester",
];

const build = (t: ClrEmailTrigger, d: ClrEmailData = FULL) =>
  buildClearAdvanceEmailHtml(t, d, CTA);

test("every trigger gets AP-2's shape: heading, table, call to action", () => {
  // The whole request was "use the same email format as AP-2". A trigger that
  // silently falls out of the shell is the failure to catch, and it is one
  // missing branch away at any time.
  for (const t of ALL) {
    const { subject, html } = build(t);
    assert.ok(subject.length > 0, `${t} has no subject`);
    assert.match(html, /<h2 style="color:#A3121B">/, `${t} has no heading`);
    assert.match(html, /<table style="width:100%;border-collapse:collapse">/, `${t} has no table`);
    assert.ok(html.indexOf(CTA) !== -1, `${t} dropped the call to action`);
    assert.match(html, /ADC26-09044/, `${t} does not name the document`);
  }
});

test("each trigger says a different thing in its subject", () => {
  const subjects = ALL.map((t) => build(t).subject);
  assert.equal(new Set(subjects).size, ALL.length, `two triggers share a subject: ${subjects.join(" | ")}`);
});

test("the step is shown while it is moving and dropped once it has landed", () => {
  // On an outcome the step is either wrong or noise — the thing it named has
  // already happened.
  for (const t of ["Submitted", "SubmittedAck"] as ClrEmailTrigger[]) {
    assert.match(build(t).html, /ขั้นอนุมัติ/, `${t} should show the step`);
  }
  for (const t of ["Approved", "Rejected", "Returned", "CancelledByAccount"] as ClrEmailTrigger[]) {
    assert.doesNotMatch(build(t).html, /ขั้นอนุมัติ/, `${t} should not show the step`);
  }
});

test("the refund row is labelled by its sign, not left as a minus", () => {
  // One figure, two meanings. A reader should not have to work out which from
  // a minus sign in front of an amount.
  const owed = build("Approved", { ...FULL, refundToCompany: 2500 }).html;
  assert.match(owed, /ต้องโอนคืนบริษัท/);
  assert.doesNotMatch(owed, /บริษัทต้องจ่ายเพิ่ม/);

  const extra = build("Approved", { ...FULL, refundToCompany: -1529.85 }).html;
  assert.match(extra, /บริษัทต้องจ่ายเพิ่ม/);
  assert.match(extra, /1,529\.85/, "the amount is shown positive under its own label");
  assert.doesNotMatch(extra, /-1,529\.85/);
});

test("a settled clearing shows no refund row at all", () => {
  const html = build("Approved", { ...FULL, refundToCompany: 0 }).html;
  assert.doesNotMatch(html, /ต้องโอนคืนบริษัท/);
  assert.doesNotMatch(html, /บริษัทต้องจ่ายเพิ่ม/);
});

test("a field nobody filled in is dropped, never printed as a dash", () => {
  const bare: ClrEmailData = { id: 1, requestNo: "ADC26-00001" };
  const html = build("Approved", bare).html;
  /* Matched as a table CELL, not anywhere in the document: every subject line
     contains "เคลียร์เงินทดรองจ่าย", so a bare search for the label finds the
     heading and the test passes or fails for the wrong reason. */
  const hasRow = (label: string) => html.indexOf(`>${label}</td>`) !== -1;
  for (const label of ["ผู้ขอ", "แบรนด์", "เงินทดรองจ่าย", "ค่าใช้จ่ายจริง", "วันจ่าย"]) {
    assert.equal(hasRow(label), false, `${label} row survived an empty value`);
  }
  assert.equal(hasRow("เลขที่"), true, "the document number is always a row");
  assert.match(html, /ADC26-00001/);
});

test("an approver's remark is escaped, never interpolated as markup", () => {
  // AP-3 interpolated this raw into a mail body until 2026-09-24. It is free
  // text typed by an approver.
  const evil = '<img src=x onerror="alert(1)">';
  for (const t of ["Rejected", "Returned"] as ClrEmailTrigger[]) {
    const html = build(t, { ...FULL, note: evil }).html;
    assert.doesNotMatch(html, /<img src=x/, `${t} let a remark through as markup`);
    assert.match(html, /&lt;img/, `${t} did not escape the remark`);
  }
});

test("the remark is in the sentence for those two, and not repeated as a row", () => {
  for (const t of ["Rejected", "Returned"] as ClrEmailTrigger[]) {
    assert.doesNotMatch(build(t, { ...FULL, note: "เอกสารไม่ครบ" }).html, /หมายเหตุ/,
      `${t} repeats the reason as a second, different-looking remark`);
  }
  // A cancellation's reason has no sentence of its own, so it gets the row.
  assert.match(build("CancelledByAccount", { ...FULL, note: "ยอดไม่ตรง" }).html, /หมายเหตุ/);
});

test("the two cancellations do not say the same thing", () => {
  const byAcc = build("CancelledByAccount").html;
  const byReq = build("CancelledByRequester").html;
  assert.match(byAcc, /Business Central/);
  assert.match(byReq, /ถูกยกเลิกโดยผู้ขอ/);
  assert.notEqual(byAcc, byReq);
});

test("the document number is escaped too", () => {
  const html = build("Approved", { ...FULL, requestNo: "A&B<x>" }).html;
  assert.doesNotMatch(html, /<x>/);
  assert.match(html, /A&amp;B/);
});
