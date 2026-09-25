import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * AP-3's requester form, after the 2026-09-24 CR (group A).
 *
 * Four facts here fail silently rather than loudly, which is why they are read
 * out of the source instead of trusted to review:
 *
 * - a ภ.ง.ด. control creeping back onto the requester's form would look
 *   harmless and would re-ask a question accounting overrides;
 * - the WHT table has TWO colSpans that count its columns, and an over-long one
 *   does not throw — it grows the table by a phantom column, which is how this
 *   CR shipped a misaligned header once already;
 * - the refund-slip section must NOT gain the no-AI buttons, and the only thing
 *   keeping them off it is that its call site passes no onPickRaw;
 * - skipping the AI read must stay one argument on the one upload function, not
 *   a second upload path that can drift.
 *
 * There is no vitest and no rendering harness in this repo, so this reads the
 * file. That is the same trade `src/lib/acc/*-guard.test.ts` makes.
 */

const FORM = path.join(
  process.cwd(),
  "src/features/clear-advance/components/ClearAdvanceForm.tsx",
);

function form(): string {
  return fs.readFileSync(FORM, "utf8");
}

test("the requester has no ภ.ง.ด. control", () => {
  const src = form();
  assert.doesNotMatch(src, /updateWht\(idx, \{ pndType:/);
  assert.doesNotMatch(src, /<Th w=\{110\}>ภ\.ง\.ด\.<\/Th>/);
});

test("the ภ.ง.ด. value is still produced and still sent", () => {
  const src = form();
  assert.match(src, /suggestPndType\(/, "the tax id no longer fills the type");
  assert.match(src, /pndType: w\.pndType \|\| null/, "the save no longer carries the type");
});

test("the WHT totals row spans the seven columns that are left", () => {
  assert.match(form(), /<Td colSpan=\{7\}><span[^>]*>รวม WHT<\/span><\/Td>/);
});

/* The row a brand-new form shows. It was missed when the column was removed,
   and an over-long colspan does not throw — it grows the table by a phantom
   column, so the header stops lining up with the body on first open. */
test("the WHT empty-state row spans the same columns the header has", () => {
  assert.match(form(), /<Td colSpan=\{readOnly \? 8 : 9\}>/);
  assert.doesNotMatch(form(), /<Td colSpan=\{readOnly \? 9 : 10\}>/);
});

test("the receipt section offers the no-AI buttons", () => {
  assert.match(form(), /onPickRaw=\{\(list\) => uploadFiles\(list, "clear_doc", \{ read: false \}\)\}/);
});

test("the refund-slip section does not", () => {
  const src = form();
  const at = src.indexOf('uploadFiles(list, "refund_proof")');
  assert.notEqual(at, -1, "the refund-slip upload call moved — rewrite this guard, do not delete it");
  const around = src.slice(at - 600, at + 600);
  assert.doesNotMatch(around, /onPickRaw/);
});

test("skipping the read is one argument on the one upload function", () => {
  const src = form();
  assert.match(src, /if \(read && ocrDocs\.length\) void verifyReceipts\(ocrDocs\);/);
  assert.doesNotMatch(src, /async function uploadFilesRaw/, "a second upload path appeared");
});

/* The buttons say which is which. Before this CR แนบไฟล์ WAS the AI button, and
   it still is in the refund-slip section on the same page, so the two must not
   be told apart by three words being absent from one of them. */
test("the no-AI buttons say so, and the AI ones say so too", () => {
  const src = form();
  assert.match(src, /แนบไฟล์ \(ไม่ใช้ AI\)/);
  assert.match(src, /ถ่ายรูป \(ไม่ใช้ AI\)/);
  assert.match(src, /hasRaw \? "แนบไฟล์อ่านด้วย AI" : "แนบไฟล์"/);
});

/* The paragraph under them promised the read for everything in the section,
   which stopped being true the moment half the buttons skipped it. */
test("the helper text names which button reads and which does not", () => {
  const src = form();
  assert.match(src, /ปุ่ม <b>อ่านด้วย AI<\/b> จะอ่าน/);
  assert.match(src, /ปุ่ม <b>ไม่ใช้ AI<\/b> แนบไฟล์อย่างเดียว/);
});
