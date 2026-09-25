import {
  MAIL_FORM_NAMES,
  approvedLead,
  esc,
  rejectedLead,
  returnedLead,
  submittedAckLead,
  submittedLead,
} from "@/lib/acc/mail-copy";

/**
 * AP-3's mail layout, in the shape AP-2 already uses (user, 2026-09-25:
 * *"เคลียร์เงินทดรองจ่าย ใช้ Format Email เดียวกันกับ AP-2"*).
 *
 * Every AP-3 message used to be assembled at its own call site — a lead
 * sentence, sometimes a loose `<p>` of figures, and a button. No heading, no
 * detail table, and the figures each mail chose to mention differed from the
 * next. This is AP-2's `advance-email-templates.ts` counterpart, deliberately
 * the same shape so the two forms read as one product.
 *
 * **The sentences are unchanged** — they come from the same `@/lib/acc/mail-copy`
 * they always did. This decides layout, not wording.
 *
 * **Pure, and separate from `clear-advance-email-templates.ts` for that reason.**
 * The call-to-action arrives as finished HTML rather than a URL, so nothing here
 * reaches `@/env` — which validates the whole environment on import and would
 * otherwise make all seven triggers untestable. The same split
 * `stale-sweep-schedule` and `on-behalf` already carry.
 */

/* ─────────────────────────── helpers ─────────────────────────── */

/**
 * AP-2's `shell`, with one deliberate difference: the call-to-action arrives as
 * finished HTML instead of a URL.
 *
 * AP-2 builds its own `<a href>` from `env.NEXT_PUBLIC_APP_URL ?? ""`, which is
 * the exact failure `@/lib/acc/mail-link` exists to prevent — AP-3's own
 * docblock records that it was the one form whose link was not relative and
 * dead. Matching the layout is the point of this module; matching that is not.
 * `documentButton` refuses a URL that is not absolute and emits nothing, so a
 * misconfigured base drops the button rather than shipping a link to nowhere.
 */
function shell(title: string, bodyRows: string, cta: string, lead = ""): string {
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto">
    <h2 style="color:#A3121B">${esc(title)}</h2>
    ${lead}
    <table style="width:100%;border-collapse:collapse">${bodyRows}</table>
    ${cta}
  </div>`;
}

function row(k: string, v: unknown): string {
  return `<tr><td style="padding:4px 8px;color:#666">${esc(k)}</td><td style="padding:4px 8px">${esc(v)}</td></tr>`;
}

/** `1,859.00`, or nothing — a row is dropped rather than printed as a dash. */
function baht(n: number | null | undefined): string {
  return n == null ? "" : `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`;
}

/* ─────────────────────────── types ─────────────────────────── */

export type ClrEmailTrigger =
  | "Submitted"
  /** The requester's own receipt for filing — not a request to act. */
  | "SubmittedAck"
  | "Approved"
  | "Rejected"
  | "Returned"
  /** Accounting pulled an approved clearing before it reached BC. */
  | "CancelledByAccount"
  /** The requester withdrew it before the account step. */
  | "CancelledByRequester";

export interface ClrEmailData {
  id: number;
  requestNo: string;
  requesterFullName?: string | null;
  brandCode?: string | null;
  /** The AP-2 advance this clears. */
  advanceRequestNo?: string | null;
  actualTotal?: number | null;
  /** Positive: owed back to the company. Negative: the company owes more. */
  refundToCompany?: number | null;
  paymentDate?: string | null;
  /** Shown while it is still moving — who has it now. */
  stepLabel?: string | null;
  /** The approver's remark, or the cancellation reason. */
  note?: string | null;
}

/* ─────────────────────────── builder ─────────────────────────── */

export function buildClearAdvanceEmailHtml(
  trigger: ClrEmailTrigger,
  d: ClrEmailData,
  /** Finished call-to-action HTML. Passed in so this module touches no env. */
  cta: string,
): { subject: string; html: string } {
  const stepSuffix = d.stepLabel ? ` (${d.stepLabel})` : "";

  const titles: Record<ClrEmailTrigger, string> = {
    Submitted:            `เคลียร์เงินทดรองจ่าย ${d.requestNo} รออนุมัติ${stepSuffix}`,
    SubmittedAck:         `เคลียร์เงินทดรองจ่าย ${d.requestNo} — ส่งคำขอเรียบร้อยแล้ว`,
    Approved:             `เคลียร์เงินทดรองจ่าย ${d.requestNo} อนุมัติครบแล้ว`,
    Rejected:             `เคลียร์เงินทดรองจ่าย ${d.requestNo} ไม่อนุมัติ`,
    Returned:             `เคลียร์เงินทดรองจ่าย ${d.requestNo} ส่งกลับแก้ไข`,
    CancelledByAccount:   `เคลียร์เงินทดรองจ่าย ${d.requestNo} ถูกยกเลิกโดยฝ่ายบัญชี`,
    CancelledByRequester: `เคลียร์เงินทดรองจ่าย ${d.requestNo} ถูกยกเลิกโดยผู้ขอ`,
  };
  const title = titles[trigger];

  /* The step belongs on a mail about something still in flight. On an outcome
     it is either wrong or noise — the thing it named has already happened. */
  const showStep = trigger === "Submitted" || trigger === "SubmittedAck";

  const refund = d.refundToCompany ?? null;
  const rows = [
    row("เลขที่", d.requestNo),
    d.requesterFullName ? row("ผู้ขอ", d.requesterFullName) : "",
    d.brandCode ? row("แบรนด์", d.brandCode) : "",
    d.advanceRequestNo ? row("เงินทดรองจ่าย", d.advanceRequestNo) : "",
    d.actualTotal != null ? row("ค่าใช้จ่ายจริง", baht(d.actualTotal)) : "",
    /* One figure, two meanings — the sign is the whole point, so it is labelled
       rather than left for the reader to work out from a minus sign. */
    refund != null && refund !== 0
      ? refund > 0
        ? row("ต้องโอนคืนบริษัท", baht(refund))
        : row("บริษัทต้องจ่ายเพิ่ม", baht(Math.abs(refund)))
      : "",
    d.paymentDate ? row("วันจ่าย", d.paymentDate) : "",
    showStep && d.stepLabel ? row("ขั้นอนุมัติ", d.stepLabel) : "",
    /* The reason is already in the sentence for these two; a row repeating it
       reads as a second, different remark. AP-2 draws the same line. */
    d.note && trigger !== "Rejected" && trigger !== "Returned"
      ? row("หมายเหตุ", d.note)
      : "",
  ].join("");

  const name = MAIL_FORM_NAMES["AP-3"];
  const lead =
    trigger === "Submitted" ? submittedLead(name, d.requestNo)
    : trigger === "SubmittedAck" ? submittedAckLead(name, d.requestNo, d.stepLabel)
    : trigger === "Approved" ? approvedLead(name, d.requestNo)
    : trigger === "Rejected" ? rejectedLead(name, d.requestNo, d.note)
    : trigger === "Returned" ? returnedLead(name, d.requestNo, d.note)
    : trigger === "CancelledByAccount"
      ? `<p style="font-size:14px;line-height:1.6;color:#333;margin:0 0 12px">คำขอเคลียร์คืนเงินทดรองจ่าย <b>${esc(d.requestNo)}</b> ที่อนุมัติแล้ว ถูกยกเลิกก่อนส่งเข้า Business Central</p>`
      : `<p style="font-size:14px;line-height:1.6;color:#333;margin:0 0 12px">คำขอเคลียร์คืนเงินทดรองจ่าย <b>${esc(d.requestNo)}</b> ถูกยกเลิกโดยผู้ขอ (ก่อนถึงขั้นบัญชี) — ไม่ต้องดำเนินการอนุมัติ</p>`;

  return { subject: title, html: shell(title, rows, cta, lead) };
}

