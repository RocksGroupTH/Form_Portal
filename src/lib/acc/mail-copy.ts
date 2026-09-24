/**
 * The sentence at the top of every notification mail, for all five forms.
 *
 * Pure and import-free, so the wording can be asserted without a database —
 * every module that builds a mail reaches `@/env` for the app URL, and this is
 * the half that decides what a person actually reads.
 *
 * ## Why it exists
 *
 * Until 2026-09-24 a notification was a subject line and a table of fields. A
 * table answers *which request*; it never answered *what happened to it* or
 * *why this is in my inbox*, and for a rejection the reason sat in a row
 * labelled `หมายเหตุ` rather than in the sentence that says the claim was
 * refused. The user supplied the copy:
 *
 * - ส่งคำขอ → `ท่านมี Request {ฟอร์ม} เลขที่ {เลข} กรุณาพิจารณาและอนุมัติ`
 * - ไม่อนุมัติ → `{ฟอร์ม} เลขที่เอกสาร : {เลข} ไม่ได้รับการอนุมัติ เนื่องจาก {remark}`
 * - อนุมัติ → `{ฟอร์ม} เลขที่เอกสาร : {เลข} ได้รับการอนุมัติแล้ว`
 *
 * **ส่งกลับแก้ไข was not in that list and is written here in the same voice.**
 * It is the fourth mail the 2026-09-24 rules send to a requester, and leaving
 * it as the only one without a sentence would have been an odd thing to defend.
 * If the wording is wrong it is wrong here, in one place.
 *
 * ## The number is the running number, and nothing is prefixed to it
 *
 * The user's note wrote the document number as `RPC-TOFyy-xxxx`, and `RPC-` is
 * a real company document-number convention — two comments in the AP-3 code
 * record it (`"ADC26-00001" (RPC-ADCyy-xxxx)`). **They were asked and said not
 * to add it** (2026-09-24): nothing in this application stores or renders it,
 * so a mail that showed `RPC-TOF26-09058` would quote a number that matches
 * neither My Requests, nor the detail page, nor the Excel export, nor the
 * database. Putting it on all of those is a separate decision nobody has taken.
 *
 * ## Escaping
 *
 * Every builder here returns **finished HTML** rather than text a caller has to
 * remember to escape, because the one field that varies is the approver's free
 * text. AP-3 interpolated that comment raw into its mail body until this
 * change; the others escaped it. A helper that returned a bare string would
 * have preserved exactly that trap.
 */

/** HTML-escape. The one copy — `email-templates.ts` re-exports this. */
export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]!));
}

/**
 * The five forms as a requester reads them.
 *
 * Kept here rather than in each form's own constants because the value of one
 * list is that a reader can see all five agree on a shape; five constants in
 * five folders is how one ends up phrased differently from the rest.
 *
 * **AP-1 is spelled `(ออฟฟิศ)` here and `(ออฟฟิต)` in `AccFormMaster.FormNameTh`**,
 * which is what Home and the form filter show. The user wrote `ออฟฟิศ` in the
 * copy they supplied and that is what the mail says; renaming the catalogue
 * entry to match is a database change nobody has asked for. Recorded so the
 * difference reads as a decision rather than a typo.
 */
export const MAIL_FORM_NAMES = {
  "AP-1": "แบบฟอร์มเบิกค่าเดินทาง (ออฟฟิศ)",
  "AP-2": "แบบฟอร์มขอเบิกเงินทดรองจ่าย",
  "AP-3": "แบบฟอร์มเคลียร์คืนเงินทดรองจ่าย",
  "AP-4": "แบบฟอร์มขอเบิกเงินคืนพนักงาน",
  "AP-17": "แบบฟอร์มขอจองที่พัก/ตั๋วโดยสาร",
} as const;

export type MailFormCode = keyof typeof MAIL_FORM_NAMES;

/** The paragraph `shell` renders above the detail table. */
function lead(inner: string): string {
  return (
    `<p style="font-size:14px;line-height:1.6;color:#333;margin:0 0 12px">` + inner + `</p>`
  );
}

/**
 * `เลขที่เอกสาร : TOF26-09058`, or nothing at all.
 *
 * A request has a running number by the time any of these mails is built — it
 * is minted inside the submit transaction — so the empty case is unreachable
 * rather than ordinary. It still has to read as a sentence if it ever happens,
 * which is why this returns an empty string instead of `เลขที่เอกสาร : -`.
 */
function docNo(requestNo: string | null | undefined, label: string): string {
  const no = (requestNo ?? "").trim();
  return no ? ` ${label} <b>${esc(no)}</b>` : "";
}

/** `เนื่องจาก …`, dropped entirely when no reason was given. */
function because(reason: string | null | undefined): string {
  const r = (reason ?? "").trim();
  return r ? ` เนื่องจาก ${esc(r)}` : "";
}

/** To the manager, when a request is filed. */
export function submittedLead(formName: string, requestNo: string | null | undefined): string {
  return lead(`ท่านมี Request <b>${esc(formName)}</b>${docNo(requestNo, "เลขที่")} กรุณาพิจารณาและอนุมัติ`);
}

/** To the requester, when the last approval lands. */
export function approvedLead(formName: string, requestNo: string | null | undefined): string {
  return lead(`<b>${esc(formName)}</b>${docNo(requestNo, "เลขที่เอกสาร :")} ได้รับการอนุมัติแล้ว`);
}

/** To the requester, when it is refused. The reason is the approver's remark. */
export function rejectedLead(
  formName: string,
  requestNo: string | null | undefined,
  reason?: string | null,
): string {
  return lead(
    `<b>${esc(formName)}</b>${docNo(requestNo, "เลขที่เอกสาร :")} ไม่ได้รับการอนุมัติ${because(reason)}`,
  );
}

/** To the requester, when it is sent back to be corrected. */
export function returnedLead(
  formName: string,
  requestNo: string | null | undefined,
  reason?: string | null,
): string {
  return lead(
    `<b>${esc(formName)}</b>${docNo(requestNo, "เลขที่เอกสาร :")} ถูกส่งกลับให้แก้ไข${because(reason)}`,
  );
}
