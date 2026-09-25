import { env } from "@/env";
import {
  MAIL_FORM_NAMES,
  approvedLead,
  esc,
  rejectedLead,
  returnedLead,
  submittedAckLead,
  submittedLead,
} from "@/lib/acc/mail-copy";

/* ─────────────────────────── helpers ─────────────────────────── */

/* One implementation, in `@/lib/acc/mail-copy` — re-exported because AP-2's
   own modules import `esc` from here. */
export { esc } from "@/lib/acc/mail-copy";

/** `lead` is the sentence from `mail-copy.ts`; blank for the triggers with none. */
function shell(title: string, bodyRows: string, ctaUrl: string, lead = ""): string {
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto">
    <h2 style="color:#A3121B">${esc(title)}</h2>
    ${lead}
    <table style="width:100%;border-collapse:collapse">${bodyRows}</table>
    <p style="margin-top:16px"><a href="${esc(ctaUrl)}"
      style="background:#A3121B;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">เปิดเอกสาร</a></p>
  </div>`;
}

function row(k: string, v: unknown): string {
  return `<tr><td style="padding:4px 8px;color:#666">${esc(k)}</td><td style="padding:4px 8px">${esc(v)}</td></tr>`;
}

/* ─────────────────────────── types ─────────────────────────── */

export type AdvEmailTrigger =
  | "Submitted"
  /** The requester's own receipt for filing — not a request to act. */
  | "SubmittedAck"
  | "StepPending"
  | "Approved"
  | "Rejected"
  | "Returned"
  | "Cancelled";

export interface AdvEmailData {
  id: number;
  requestNo: string;
  requesterFullName?: string | null;
  brandCode?: string | null;
  payeeName?: string | null;
  totalAmount?: number | null;
  paymentDate?: string | null;
  stepLabel?: string | null;  // shown for Submitted / StepPending
  note?: string | null;       // comment for Rejected / Returned / Cancelled
}

/* ─────────────────────────── builder ─────────────────────────── */

export function buildAdvanceEmail(
  trigger: AdvEmailTrigger,
  d: AdvEmailData,
): { subject: string; html: string } {
  const url = `${env.NEXT_PUBLIC_APP_URL ?? ""}/request/advance/${d.id}`;

  const stepSuffix = d.stepLabel ? ` (${d.stepLabel})` : "";

  const titles: Record<AdvEmailTrigger, string> = {
    Submitted:   `เบิกเงินทดรองจ่าย ${d.requestNo} รออนุมัติ${stepSuffix}`,
    SubmittedAck: `เบิกเงินทดรองจ่าย ${d.requestNo} — ส่งคำขอเรียบร้อยแล้ว`,
    StepPending: `เบิกเงินทดรองจ่าย ${d.requestNo} รออนุมัติ${stepSuffix}`,
    Approved:    `เบิกเงินทดรองจ่าย ${d.requestNo} อนุมัติแล้ว`,
    Rejected:    `เบิกเงินทดรองจ่าย ${d.requestNo} ไม่อนุมัติ`,
    Returned:    `เบิกเงินทดรองจ่าย ${d.requestNo} ส่งกลับแก้ไข`,
    Cancelled:   `ยกเลิกคำขอเบิกเงินทดรองจ่าย ${d.requestNo}`,
  };

  const title = titles[trigger];

  const showStep =
    trigger === "Submitted" || trigger === "StepPending" || trigger === "SubmittedAck";

  const rows = [
    row("เลขที่", d.requestNo),
    d.requesterFullName ? row("ผู้ขอ", d.requesterFullName) : "",
    d.brandCode        ? row("แบรนด์", d.brandCode) : "",
    d.payeeName        ? row("ผู้รับเงิน", d.payeeName) : "",
    d.totalAmount != null
      ? row("ยอดรวม (บาท)", d.totalAmount.toLocaleString() + " บาท")
      : "",
    d.paymentDate      ? row("วันที่จ่าย", d.paymentDate) : "",
    showStep && d.stepLabel ? row("ขั้นอนุมัติ", d.stepLabel) : "",
    /* The reason is in the sentence above for these two — a row repeating it
       reads as a second, different remark. */
    d.note && trigger !== "Rejected" && trigger !== "Returned"
      ? row("หมายเหตุ", d.note)
      : "",
  ].join("");

  /* AP-2 has no manager step — its chain is an amount matrix — so "ส่งคำขอ"
     addresses whichever approver the tier puts first. The sentence asks them
     to act, which is true of any of them. `StepPending` gets none: nothing
     has queued it since the 2026-09-24 mail rules cut step-advance mail. */
  const name = MAIL_FORM_NAMES["AP-2"];
  const lead =
    trigger === "Submitted" ? submittedLead(name, d.requestNo)
    /* A different sentence, not a different recipient on the same one:
       `submittedLead` asks the reader to approve, and the requester is not
       who approves their own claim. */
    : trigger === "SubmittedAck" ? submittedAckLead(name, d.requestNo, d.stepLabel)
    : trigger === "Approved" ? approvedLead(name, d.requestNo)
    : trigger === "Rejected" ? rejectedLead(name, d.requestNo, d.note)
    : trigger === "Returned" ? returnedLead(name, d.requestNo, d.note)
    : "";

  return { subject: title, html: shell(title, rows, url, lead) };
}
