import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAIL_FORM_NAMES,
  approvedLead,
  esc,
  rejectedLead,
  returnedLead,
  submittedLead,
} from "./mail-copy";

/**
 * What a person actually reads at the top of a notification.
 *
 * The wording is the user's (2026-09-24) and these assert it literally, which
 * is the point: a table of fields never said what had happened to the request,
 * and the rejection reason used to sit in a row labelled `หมายเหตุ` rather than
 * in the sentence saying the claim was refused. Pinning the copy is how a later
 * edit to one form's mail cannot quietly reword the other four.
 */

const NO = "TOF26-09058";

test("the submit mail asks the manager to act, and names the form and number", () => {
  const html = submittedLead(MAIL_FORM_NAMES["AP-1"], NO);
  assert.match(html, /ท่านมี Request/);
  assert.match(html, /แบบฟอร์มเบิกค่าเดินทาง \(ออฟฟิศ\)/);
  assert.match(html, /เลขที่ <b>TOF26-09058<\/b>/);
  assert.match(html, /กรุณาพิจารณาและอนุมัติ/);
});

test("the approval mail says approved, with the document number", () => {
  const html = approvedLead(MAIL_FORM_NAMES["AP-1"], NO);
  assert.match(html, /เลขที่เอกสาร : <b>TOF26-09058<\/b> ได้รับการอนุมัติแล้ว/);
});

test("the rejection carries the reason INSIDE the sentence", () => {
  // The whole point of the change: not a labelled row underneath it.
  const html = rejectedLead(MAIL_FORM_NAMES["AP-1"], NO, "แนบใบเสร็จไม่ครบ");
  assert.match(html, /ไม่ได้รับการอนุมัติ เนื่องจาก แนบใบเสร็จไม่ครบ/);
});

test("a return reads the same way, with its own verb", () => {
  const html = returnedLead(MAIL_FORM_NAMES["AP-4"], "RBM26-00007", "ยอดไม่ตรงกับใบเสร็จ");
  assert.match(html, /ถูกส่งกลับให้แก้ไข เนื่องจาก ยอดไม่ตรงกับใบเสร็จ/);
});

test("no reason drops the whole clause rather than leaving it dangling", () => {
  for (const html of [
    rejectedLead(MAIL_FORM_NAMES["AP-2"], NO, "   "),
    rejectedLead(MAIL_FORM_NAMES["AP-2"], NO, null),
    rejectedLead(MAIL_FORM_NAMES["AP-2"], NO, undefined),
  ]) {
    assert.match(html, /ไม่ได้รับการอนุมัติ</);
    assert.doesNotMatch(html, /เนื่องจาก/);
  }
});

test("a missing running number drops its clause too, never prints a dash", () => {
  const html = approvedLead(MAIL_FORM_NAMES["AP-3"], null);
  assert.doesNotMatch(html, /เลขที่/);
  assert.doesNotMatch(html, /-<\/b>/);
  assert.match(html, /ได้รับการอนุมัติแล้ว/);
});

test("the approver's remark is escaped — it is free text from a person", () => {
  /* AP-3 interpolated this raw into its mail body until 2026-09-24. Returning
     finished HTML rather than a string a caller must remember to escape is what
     closes that for every form at once. */
  const html = rejectedLead(MAIL_FORM_NAMES["AP-17"], NO, `<img src=x onerror="alert(1)">`);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test("the form name is escaped as well, so the table cannot inject through it", () => {
  assert.doesNotMatch(submittedLead(`<b>x</b>`, NO), /<b>x<\/b>/);
});

test("RPC- is deliberately absent — the user said not to add it", () => {
  // Their note wrote RPC-TOFyy-xxxx; nothing in this app stores or renders that
  // prefix, so a mail quoting it would match no other surface. See mail-copy.ts.
  for (const html of [
    submittedLead(MAIL_FORM_NAMES["AP-1"], NO),
    approvedLead(MAIL_FORM_NAMES["AP-1"], NO),
    rejectedLead(MAIL_FORM_NAMES["AP-1"], NO, "x"),
    returnedLead(MAIL_FORM_NAMES["AP-1"], NO, "x"),
  ]) {
    assert.doesNotMatch(html, /RPC-/);
  }
});

test("all five forms have a name, and every one of them is a แบบฟอร์ม", () => {
  assert.deepEqual(Object.keys(MAIL_FORM_NAMES).sort(), ["AP-1", "AP-17", "AP-2", "AP-3", "AP-4"]);
  for (const [code, name] of Object.entries(MAIL_FORM_NAMES)) {
    assert.ok(name.startsWith("แบบฟอร์ม"), `${code} reads "${name}"`);
  }
});

test("esc covers the five characters that matter", () => {
  assert.equal(esc(`<&>"'`), "&lt;&amp;&gt;&quot;&#39;");
  assert.equal(esc(null), "");
  assert.equal(esc(undefined), "");
});
