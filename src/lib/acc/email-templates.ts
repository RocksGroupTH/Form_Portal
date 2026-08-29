import { env } from "@/env";
import {
  currencyWord,
  referenceRateNote,
  showsForeignCurrency,
} from "@/lib/acc/currency-display";
import type { AccRequest } from "@/features/accounting/types";

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

export type AccTrigger = "Submitted" | "ManagerApproved" | "Approved" | "Rejected" | "Returned";

export function buildEmail(
  trigger: AccTrigger,
  req: AccRequest,
  note?: string,
): { subject: string; html: string } {
  const url = `${env.NEXT_PUBLIC_APP_URL ?? ""}/request/travel-expense/${req.id}`;
  const titles: Record<AccTrigger, string> = {
    Submitted: `ขออนุมัติเบิกค่าเดินทาง ${req.requestNo ?? ""}`,
    ManagerApproved: `รอตรวจสอบ (บัญชี) ${req.requestNo ?? ""}`,
    Approved: `อนุมัติแล้ว ${req.requestNo ?? ""}`,
    Rejected: `ไม่อนุมัติ ${req.requestNo ?? ""}`,
    Returned: `ส่งกลับแก้ไข ${req.requestNo ?? ""}`,
  };
  const rows = [
    row("เลขที่", req.requestNo ?? "-"),
    row("ผู้ขอ", req.requesterFullName ?? "-"),
    row("แบรนด์", req.brandCode ?? "-"),
    row("วันเดินทาง", req.travel?.travelDate ?? "-"),
    row("ยอดรวม (บาท)", req.totalAmount ?? "-"),
    // Foreign claims only — a baht claim's mail is byte-identical to what it has
    // always been. The heading above stays true either way (TotalAmount is baht
    // by construction); what this adds is the figure the requester actually
    // spent and the rate it was converted at, which is the thing an approver
    // reading only the baht line cannot check.
    showsForeignCurrency(req.currency)
      ? row(
          `ยอดตามสกุลเงิน (${currencyWord(req.currency)})`,
          req.foreignAmount ?? "-",
        )
      : "",
    showsForeignCurrency(req.currency) && req.exchangeRate != null
      ? row("อัตราแลกเปลี่ยน", referenceRateNote(req.currency, req.exchangeRate, req.rateAsOf))
      : "",
    req.paymentDate ? row("วันที่จ่าย", req.paymentDate) : "",
    note ? row("หมายเหตุ", note) : "",
  ].join("");
  return { subject: titles[trigger], html: shell(titles[trigger], rows, url) };
}
