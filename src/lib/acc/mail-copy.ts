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
 * **Since 2026-09-26 this map is the FALLBACK, not what a mail normally says.**
 * `resolveMailFormName` reads `AccFormMaster` and every mail builder prefers
 * it; these strings are reached only when that read fails or the table has no
 * row for the code. Do not edit them expecting a mail to change — rename the
 * form at Settings → Form Environment instead.
 *
 * **AP-1 is spelled `(ออฟฟิศ)` here and `(ออฟฟิต)` in `AccFormMaster.FormNameTh`.**
 * That difference used to be confined to Home and the form filter, because the
 * mail read this map; it is now live in the mail too, since the canonical row
 * wins whenever it can be read. So the ordinary mail says `(ออฟฟิต)` and only a
 * failed read says `(ออฟฟิศ)`. Recorded so the two spellings read as a decision
 * rather than a typo — and so nobody "fixes" it here, where it no longer
 * governs anything.
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

/**
 * **To the requester, confirming their own submit** — the receipt for the act of
 * sending, not a request to act.
 *
 * `submittedLead` above is the approver's copy and says กรุณาพิจารณาและอนุมัติ.
 * Sending that to the person who filed the request tells them to approve their
 * own claim, which is why this is a second wording rather than a second
 * recipient on the first.
 *
 * Reported missing by a tester, 2026-09-25: *"ไม่มีเมลแจ้งเตือนสำหรับคนเบิก
 * ว่าส่งข้อมูลสำเร็จ"*. Until then no form sent one: every `Submitted` mail went
 * to an approver, and the requester first heard about their own request when
 * its outcome arrived.
 *
 * `nextStep` names who has it now, so the message says what happens next rather
 * than only that something happened. Omitted, the sentence still stands.
 */
export function submittedAckLead(
  formName: string,
  requestNo: string | null | undefined,
  nextStep?: string | null,
): string {
  const waiting = (nextStep ?? "").trim();
  const next = waiting ? ` ขณะนี้อยู่ระหว่างรอการพิจารณาจาก <b>${esc(waiting)}</b>` : " ขณะนี้อยู่ระหว่างรอการพิจารณา";
  return lead(
    `ระบบได้รับคำขอ <b>${esc(formName)}</b>${docNo(requestNo, "เลขที่เอกสาร :")} เรียบร้อยแล้ว` + next,
  );
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
