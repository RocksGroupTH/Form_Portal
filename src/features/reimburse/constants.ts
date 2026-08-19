/**
 * AP-4 — Staff Reimbursement (ขอเบิกเงินคืนพนักงาน).
 *
 * Form code, running-number prefix, the step/status vocabulary, the
 * `AccRequestFile.RefType` values AP-4 writes, and the notice text shown at
 * the top of the form (spec §5.1).
 */

export const AP4_FORM_CODE = "AP-4";
export const AP4_RUNNING_PREFIX = "RBM";

/** `AccApproval.StepCode` values AP-4 uses — three steps on the shared two-step CHECK, widened for this form (see migration 091). */
export const REIMBURSE_STEP_CODES = ["MANAGER", "ACCOUNT", "ACCOUNT_FINAL"] as const;
export type ReimburseStepCode = (typeof REIMBURSE_STEP_CODES)[number];

/**
 * What each step is called, in the one place both readers can reach.
 *
 * The detail timeline and My Work's "ลำดับถัดไป" line are seen by the same
 * approver about the same request, and they used to disagree: this file's
 * `ACCOUNT_FINAL` said "บัญชี (อนุมัติขั้นสุดท้าย)" while
 * `src/lib/acc/approval-display.ts` said "บัญชี (ขั้นสุดท้าย)". The shorter
 * wording won because My Work prefixes it with "อนุมัติ" — the longer one reads
 * "อนุมัติบัญชี (อนุมัติขั้นสุดท้าย)" there.
 *
 * It lives here rather than in `approval-policy.ts` because `ReimburseDetail` may
 * import that module as a **type** only (it reaches the holiday lookup, and with
 * it `@/env`), and rather than in `approval-display.ts` because that one imports
 * React types. This file imports nothing at all.
 */
export const REIMBURSE_STEP_LABEL: Record<ReimburseStepCode, string> = {
  MANAGER: "ผู้จัดการ",
  ACCOUNT: "บัญชี",
  ACCOUNT_FINAL: "บัญชี (ขั้นสุดท้าย)",
};

/** `AccRequest.Status` values AP-4 uses — the shared Acc* status machine; AP-4 needed no new status (spec §3.2.1), only a third `CurrentStepCode`. */
export const REIMBURSE_STATUSES = [
  "Draft",
  "Submitted",
  "ManagerApproved",
  "Approved",
  "Rejected",
  "Returned",
  "Cancelled",
] as const;
export type ReimburseStatus = (typeof REIMBURSE_STATUSES)[number];

/**
 * `AccRequestFile.RefType` values AP-4 writes. `RefId` is always the
 * `AccRequest.Id` for both — attachments are request-level (spec §5.2 fields
 * 4b/5), not per expense line the way AP-1's receipts are per item.
 */
export const REIMBURSE_FILE_REFTYPES = {
  EXCEL: "reimburse_excel",
  RECEIPT: "reimburse_receipt",
} as const;
export type ReimburseFileRefType =
  (typeof REIMBURSE_FILE_REFTYPES)[keyof typeof REIMBURSE_FILE_REFTYPES];

/* ─────────────────────── the acknowledgement checklist ─────────────────────── */

/**
 * Longest `AccReimburseRule.RuleText` the column will take (migration 089:
 * `NVARCHAR(1000)`).
 *
 * This is the **only** declaration of that bound. It used to exist three times
 * — the migration's column, `settings-service.ts`, and a hand-copied `1000` in
 * `ReimburseRuleSettings.tsx` — and the copies could drift apart without
 * anything failing: a server that grew the limit would keep a `maxLength`
 * attribute silently clamping the editor below it.
 */
export const RULE_TEXT_MAX = 1000;

export const RULE_TEXT_REQUIRED = "กรุณากรอกข้อความระเบียบ";
export const RULE_TEXT_TOO_LONG = `ข้อความระเบียบยาวเกิน ${RULE_TEXT_MAX} ตัวอักษร`;

/**
 * A tick against a rule that is not on the active checklist.
 *
 * `AccReimburseRuleAck.RuleId` has an FK to `AccReimburseRule`, so an id that
 * does not exist reaches the user as a raw constraint-violation 500 from inside
 * the save transaction — an English SQL Server message on a Thai form, and one
 * that says nothing about which tick to clear. A soft-deleted rule fails the
 * same way *without* violating the FK: the row is still there, so the insert
 * succeeds and the request records agreement to a line that is no longer part
 * of the checklist.
 */
export const RULE_ACK_UNKNOWN_ERROR =
  "รายการระเบียบที่ยืนยันไม่ถูกต้องหรือถูกยกเลิกไปแล้ว — กรุณาโหลดหน้านี้ใหม่แล้วยืนยันอีกครั้ง";

/**
 * Which of `ackedIds` name no active rule, in the order they were sent.
 *
 * Pure so it can be tested without a pool: the route reads the active rules and
 * asks this, rather than letting the database answer with a constraint.
 */
export function unknownRuleAckIds(
  ackedIds: readonly number[],
  activeRuleIds: readonly number[],
): number[] {
  const known = new Set(activeRuleIds);
  const out: number[] = [];
  for (const id of ackedIds) {
    if (!known.has(id) && out.indexOf(id) < 0) out.push(id);
  }
  return out;
}

/**
 * The rule text as it will be stored, or the message refusing it.
 *
 * Pure, and here rather than in `settings-service.ts` so it can be tested:
 * that module imports `getAccPool` at module scope, which reaches `@/env` and
 * validates the whole environment at import time, so the boundary this function
 * guards had no test at all. The boundary is worth one — the column truncates
 * silently on some paths, and a compliance line that loses its last clause is
 * published looking complete.
 */
export function validateRuleText(
  raw: unknown,
): { text: string; error: null } | { text: null; error: string } {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { text: null, error: RULE_TEXT_REQUIRED };
  if (text.length > RULE_TEXT_MAX) return { text: null, error: RULE_TEXT_TOO_LONG };
  return { text, error: null };
}

/**
 * The read-only notice panel rendered before any input on the form (spec
 * §5.1), one entry per paragraph. It is business copy, not configuration — it
 * changes with Accounting's process rather than with a setting, so it lives
 * in code and is reviewed like code (contrast `AccReimburseRule`, which is
 * deliberately database-backed and editable at Settings).
 *
 * This is the owner's own Thai wording, copied verbatim from
 * `.superpowers/sdd/2026-08-19-ap-4-staff-reimbursement/notice-source-text.md`
 * and mechanically diffed against it. It is compliance copy — withholding-tax
 * deadlines, a PR threshold, what may not be claimed, who receives the
 * originals — so do not tidy the spacing, translate, re-order or "improve" any
 * of it. The `**` markers, the double space inside the first parenthetical,
 * the leading space on the second line of the fourth block and the informal
 * register are all part of the source. Each element is one paragraph and may
 * contain newlines.
 */
export const REIMBURSE_NOTICE: readonly string[] = [
  "วิธีการเบิกค่าใช้จ่าย\n- ปริ้นใบสรุปค่าใช้จ่าย Excel เเละเเนบใบเสร็จ/ใบกำกับภาษี (ตัวจริง) มาที่บัญชี ภายใน 1 เดือนหลังจากที่มีการจ่ายชำระค่าสินค้า/ค่าบริการ\n- หากเป็นค่าบริการที่มีการจ่ายชำระมากกว่า 1,000 บาท ต้องมีการหัก ณ ที่จ่ายและนำส่งเอกสารภายในวันที่ 5 ของเดือนถัดไปของวันที่มีการจ่ายชำระค่าบริการ (จ่ายค่าบริการวันที่ 01-31/08/2024 ส่งเอกสารภายในวันที่ 01/09/2024  ติดวันหยุดส่งวันถัดไปตามปฎิทินวันทำงาน)",
  "**เอกสารตัวจริงนำให้น้องQ (Senior AP Accountant)\n**ไม่อนุญาตให้เบิกค่าเดินทาง/เงินมัดจำทุกรายการ\n** สำหรับค่าใช้จ่ายที่เกิน 3,000 บาทต่อรายการ หากไม่เร่งด่วน รบกวนดำเนินการผ่านกระบวนการ PR นะคะ แต่หากมีความจำเป็นเร่งด่วนจริงๆ ขอความกรุณาระบุเหตุผลของความเร่งด่วนให้ด้วยค่า\n(For SC/PCM : Inventory Item ต้องเปิด PO ทุกครั้งนะคะ)",
  "**กรณีเบิกเงินเพื่อจ่ายค่าบริการมูลค่าเกิน 1,000 รบกวนติดต่อแผนกบัญชีเพื่อออกหนังสือ หัก ณ ที่จ่าย",
  "กรณีเหมารถตู้/ค่าน้ำมัน ระบุเลขทะเบียนรถในใบเสร็จรับเงิน/ใบกำกับภาษี(ออกใบกำกับเต็มรูปเท่านั้น)\n และแนบรูปที่เห็นทะเบียนรถมาด้วยค่ะ",
  "กรณีที่มีการเบิกค่าใช้จ่ายยอดไม่เกิน 500 บาทสามารถเบิกผ่านทาง Petty cash ของแต่ละแผนก เพื่อลดค่าใช้จ่ายค่าธรรมเนียมในการโอน แผนกไหนที่ไม่มีวงเงิน petty cash สามารถเบิกได้แผนก Admin\n**ยกเว้นค่าเค้กวันเกิด/ค่ากระเช้าเยี่ยมพนักงาน สามารถเบิกได้กับทางแผนก HR เท่านั้น**",
  "**ตัดรอบจ่ายจาก Request ที่อนุมัติแล้ววันจันทร์ 12.00 จ่ายเงิน ศุกร์ที่ 1 และ 3 ของทุกเดือน",
];
