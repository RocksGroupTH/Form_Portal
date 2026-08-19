import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REIMBURSE_NOTICE,
  RULE_TEXT_MAX,
  RULE_TEXT_REQUIRED,
  RULE_TEXT_TOO_LONG,
  unknownRuleAckIds,
  validateRuleText,
} from "./constants";

/*
 * The 1,000-character boundary on `AccReimburseRule.RuleText`.
 *
 * Worth a test rather than a code read: the column is `NVARCHAR(1000)` and SQL
 * Server truncates silently on some paths, so a rule accepted one character
 * over is published looking complete while missing its last clause — and these
 * are compliance lines a requester ticks and `AccReimburseRuleAck` records
 * them as having agreed to.
 */

test("ordinary text is accepted and comes back trimmed", () => {
  const r = validateRuleText("  ห้ามเบิกค่าเดินทาง  ");
  assert.equal(r.error, null);
  assert.equal(r.text, "ห้ามเบิกค่าเดินทาง");
});

test("exactly the maximum is accepted — the bound is inclusive", () => {
  const r = validateRuleText("ก".repeat(RULE_TEXT_MAX));
  assert.equal(r.error, null);
  assert.equal(r.text?.length, RULE_TEXT_MAX);
});

test("one character over is refused rather than truncated", () => {
  const r = validateRuleText("ก".repeat(RULE_TEXT_MAX + 1));
  assert.equal(r.text, null);
  assert.equal(r.error, RULE_TEXT_TOO_LONG);
});

test("the length is measured after trimming, not before", () => {
  // Padding a maximum-length rule with spaces must not tip it over: the
  // trimmed string is what the column receives.
  const r = validateRuleText(`   ${"ก".repeat(RULE_TEXT_MAX)}   `);
  assert.equal(r.error, null);
  assert.equal(r.text?.length, RULE_TEXT_MAX);
});

test("empty, whitespace-only and non-string input are all refused", () => {
  for (const bad of ["", "   ", "\n\t", null, undefined, 42, {}, []]) {
    const r = validateRuleText(bad);
    assert.equal(r.text, null, `expected ${JSON.stringify(bad)} to be refused`);
    assert.equal(r.error, RULE_TEXT_REQUIRED);
  }
});

test("the too-long message names the actual bound", () => {
  // The editor shows a counter against RULE_TEXT_MAX; the message the server
  // sends back has to agree with it or the two disagree about the same rule.
  assert.ok(RULE_TEXT_TOO_LONG.indexOf(String(RULE_TEXT_MAX)) !== -1);
});

/* ────────── the compliance notice, pinned (final review, finding 7) ────────── */

/*
 * `REIMBURSE_NOTICE` is the owner's own Thai wording, and it has already drifted
 * once: Task 5 shipped a paraphrase because no verbatim source existed in the
 * repo, and it was restored by hand from
 * `.superpowers/sdd/2026-08-19-ap-4-staff-reimbursement/notice-source-text.md`.
 * Nothing then stopped it drifting again — a tidy-up of the spacing, the `**`
 * markers or the informal register would pass review as an improvement.
 *
 * It is compliance copy: withholding-tax deadlines, a PR threshold, what may not
 * be claimed, who receives the originals. A paraphrase that softens or reorders
 * any of it tells an employee the wrong thing about a tax obligation.
 *
 * The fixture is a **literal copy**, not a read of that file: it is gitignored,
 * so reading it at runtime would make this test pass on the machine that has it
 * and fail everywhere else. The double space inside the first parenthetical, the
 * leading space on the second line of the fourth paragraph and the trailing `**`
 * of the fifth are all part of the source — if this assertion fails, the source
 * is right and the constant is wrong.
 */
const NOTICE_SOURCE: readonly string[] = [
  "วิธีการเบิกค่าใช้จ่าย\n- ปริ้นใบสรุปค่าใช้จ่าย Excel เเละเเนบใบเสร็จ/ใบกำกับภาษี (ตัวจริง) มาที่บัญชี ภายใน 1 เดือนหลังจากที่มีการจ่ายชำระค่าสินค้า/ค่าบริการ\n- หากเป็นค่าบริการที่มีการจ่ายชำระมากกว่า 1,000 บาท ต้องมีการหัก ณ ที่จ่ายและนำส่งเอกสารภายในวันที่ 5 ของเดือนถัดไปของวันที่มีการจ่ายชำระค่าบริการ (จ่ายค่าบริการวันที่ 01-31/08/2024 ส่งเอกสารภายในวันที่ 01/09/2024  ติดวันหยุดส่งวันถัดไปตามปฎิทินวันทำงาน)",
  "**เอกสารตัวจริงนำให้น้องQ (Senior AP Accountant)\n**ไม่อนุญาตให้เบิกค่าเดินทาง/เงินมัดจำทุกรายการ\n** สำหรับค่าใช้จ่ายที่เกิน 3,000 บาทต่อรายการ หากไม่เร่งด่วน รบกวนดำเนินการผ่านกระบวนการ PR นะคะ แต่หากมีความจำเป็นเร่งด่วนจริงๆ ขอความกรุณาระบุเหตุผลของความเร่งด่วนให้ด้วยค่า\n(For SC/PCM : Inventory Item ต้องเปิด PO ทุกครั้งนะคะ)",
  "**กรณีเบิกเงินเพื่อจ่ายค่าบริการมูลค่าเกิน 1,000 รบกวนติดต่อแผนกบัญชีเพื่อออกหนังสือ หัก ณ ที่จ่าย",
  "กรณีเหมารถตู้/ค่าน้ำมัน ระบุเลขทะเบียนรถในใบเสร็จรับเงิน/ใบกำกับภาษี(ออกใบกำกับเต็มรูปเท่านั้น)\n และแนบรูปที่เห็นทะเบียนรถมาด้วยค่ะ",
  "กรณีที่มีการเบิกค่าใช้จ่ายยอดไม่เกิน 500 บาทสามารถเบิกผ่านทาง Petty cash ของแต่ละแผนก เพื่อลดค่าใช้จ่ายค่าธรรมเนียมในการโอน แผนกไหนที่ไม่มีวงเงิน petty cash สามารถเบิกได้แผนก Admin\n**ยกเว้นค่าเค้กวันเกิด/ค่ากระเช้าเยี่ยมพนักงาน สามารถเบิกได้กับทางแผนก HR เท่านั้น**",
  "**ตัดรอบจ่ายจาก Request ที่อนุมัติแล้ววันจันทร์ 12.00 จ่ายเงิน ศุกร์ที่ 1 และ 3 ของทุกเดือน",
];

test("REIMBURSE_NOTICE is byte-identical to the owner's source text", () => {
  assert.deepStrictEqual(Array.from(REIMBURSE_NOTICE), Array.from(NOTICE_SOURCE));
});

test("the notice is six paragraphs, in the source's order", () => {
  // Splitting or merging a paragraph changes what the reader sees as one rule.
  assert.equal(REIMBURSE_NOTICE.length, 6);
  assert.ok(REIMBURSE_NOTICE[0].indexOf("วิธีการเบิกค่าใช้จ่าย") === 0);
  assert.ok(REIMBURSE_NOTICE[5].indexOf("ตัดรอบจ่าย") > 0);
});

/* ────────── ticks against rules that are not on the checklist ────────── */

test("an unknown or deactivated rule id is named, not left to the FK", () => {
  const active = [1, 2, 3];
  assert.deepStrictEqual(unknownRuleAckIds([1, 3], active), []);
  assert.deepStrictEqual(unknownRuleAckIds([1, 99], active), [99]);
  // Reported once each, in the order they were sent.
  assert.deepStrictEqual(unknownRuleAckIds([99, 4, 99], active), [99, 4]);
  // A soft-deleted rule still has its row, so the FK would accept it happily and
  // the request would record agreement to a line that is no longer shown.
  assert.deepStrictEqual(unknownRuleAckIds([2], [1, 3]), [2]);
  assert.deepStrictEqual(unknownRuleAckIds([], active), []);
});
