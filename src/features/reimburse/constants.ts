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

/**
 * The read-only notice panel rendered before any input on the form (spec
 * §5.1), one entry per paragraph. It is business copy, not configuration — it
 * changes with Accounting's process rather than with a setting, so it lives
 * in code and is reviewed like code (contrast `AccReimburseRule`, which is
 * deliberately database-backed and editable at Settings).
 *
 * The design spec describes what this notice must cover in English prose; no
 * verbatim Thai wording exists anywhere in the repo to copy from. The text
 * below is an authored Thai paraphrase covering all nine points from spec
 * §5.1 in order. Flag for a native/Accounting review before this ships —
 * the *content* (deadlines, thresholds, routing) is exact; the phrasing is
 * this implementer's, not Accounting's.
 */
export const REIMBURSE_NOTICE: readonly string[] = [
  "พิมพ์ไฟล์ Excel สรุปรายการ (AP-4.1) แนบพร้อมใบเสร็จ/ใบกำกับภาษีตัวจริง และนำส่งบัญชีภายใน 1 เดือนนับจากวันที่จ่ายเงิน",
  "รายการที่มีภาษีหัก ณ ที่จ่าย (ค่าบริการเกิน 1,000 บาท) บริษัทต้องนำส่งกรมสรรพากรภายในวันที่ 5 ของเดือนถัดไป กรุณาระบุข้อมูลภาษีหัก ณ ที่จ่ายให้ครบถ้วน",
  "เอกสารตัวจริงทั้งหมดส่งให้ Senior AP Accountant",
  "ค่าใช้จ่ายในการเดินทางและเงินมัดจำ ไม่สามารถเบิกผ่านแบบฟอร์มนี้ได้",
  "รายการที่มียอดเกิน 3,000 บาท ควรทำเรื่องขอซื้อ (PR) ล่วงหน้า ยกเว้นกรณีเร่งด่วนที่ต้องระบุเหตุผลประกอบการขอเบิก",
  "สินค้าคงคลังของ SC/PCM ต้องมีใบสั่งซื้อ (PO) ทุกครั้ง",
  "ค่าเช่ารถตู้และค่าน้ำมัน ต้องระบุทะเบียนรถบนใบเสร็จ พร้อมแนบรูปถ่ายที่เห็นป้ายทะเบียนชัดเจน",
  "รายการที่มียอดตั้งแต่ 500 บาทลงมา ให้เบิกผ่านเงินสดย่อยของแผนก ยกเว้นเค้กวันเกิดและกระเช้าเยี่ยมไข้ ให้เบิกผ่าน HR",
  "ปิดรอบอนุมัติทุกวันจันทร์ เวลา 12.00 น. และจ่ายเงินทุกวันศุกร์ที่ 1 และ 3 ของเดือน",
] as const;
