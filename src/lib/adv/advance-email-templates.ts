import { env } from "@/env";

/* ─────────────────────────── helpers ─────────────────────────── */

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function shell(title: string, bodyRows: string, ctaUrl: string): string {
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto">
    <h2 style="color:#A3121B">${esc(title)}</h2>
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
    StepPending: `เบิกเงินทดรองจ่าย ${d.requestNo} รออนุมัติ${stepSuffix}`,
    Approved:    `เบิกเงินทดรองจ่าย ${d.requestNo} อนุมัติแล้ว`,
    Rejected:    `เบิกเงินทดรองจ่าย ${d.requestNo} ไม่อนุมัติ`,
    Returned:    `เบิกเงินทดรองจ่าย ${d.requestNo} ส่งกลับแก้ไข`,
    Cancelled:   `ยกเลิกคำขอเบิกเงินทดรองจ่าย ${d.requestNo}`,
  };

  const title = titles[trigger];

  const showStep = trigger === "Submitted" || trigger === "StepPending";

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
    d.note             ? row("หมายเหตุ", d.note) : "",
  ].join("");

  return { subject: title, html: shell(title, rows, url) };
}
