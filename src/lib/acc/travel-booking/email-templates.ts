import { env } from "@/env";
import { esc } from "@/lib/acc/email-templates";
import { payoutDateLabel } from "@/lib/acc/travel-booking/payout-rule";
import type { TravelBookingRequest } from "@/features/travel-booking/types";

/**
 * AP-17 email templates (spec §11-ish — every AccEmailQueue.TriggerType this form emits).
 * Mirrors `src/lib/acc/email-templates.ts` (AP-1)'s `esc()` + HTML shell/brand color,
 * but is typed against `TravelBookingRequest` (AP-1's `AccRequest` doesn't share this shape).
 */

const BRAND_COLOR = "#A3121B";
const FORM_LABEL = "AP-17 · แบบฟอร์มขอจองที่พัก/ตั๋วโดยสาร";

function shell(title: string, bodyRows: string, ctaUrl: string): string {
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto">
    <p style="margin:0 0 4px;color:#999;font-size:12px">${esc(FORM_LABEL)}</p>
    <h2 style="color:${BRAND_COLOR};margin-top:0">${esc(title)}</h2>
    <table style="width:100%;border-collapse:collapse">${bodyRows}</table>
    <p style="margin-top:16px"><a href="${esc(ctaUrl)}"
      style="background:${BRAND_COLOR};color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">เปิดเอกสาร</a></p>
  </div>`;
}

/**
 * Where the trip goes, for the three approval mails.
 *
 * They carried จังหวัด and nothing else until ข้อ8 was removed on 2026-09-01,
 * so without this a manager approving from mail would be told nothing about the
 * destination at all. Falls back to the stored province for a trip filed before
 * then, which is the only place that value still surfaces.
 */
function workLocationLine(req: TravelBookingRequest): string {
  const places = (req.workLocations ?? [])
    .map((w) => (w.name ?? "").trim())
    .filter((n) => n.length > 0);
  return places.length > 0 ? places.join(" · ") : req.provinceName ?? "-";
}

function row(k: string, v: unknown): string {
  return `<tr><td style="padding:4px 8px;color:#666">${esc(k)}</td><td style="padding:4px 8px">${esc(v)}</td></tr>`;
}

export type TravelBookingTrigger =
  | "Submitted"
  | "Approved"
  | "Rejected"
  | "Returned"
  | "ReadyForAdmin"
  | "Completed";

function dateRangeLabel(req: TravelBookingRequest): string {
  return `${req.departDate ?? "-"} – ${req.returnDate ?? "-"}`;
}

function perDiemLabel(req: TravelBookingRequest): string {
  return `${req.perDiemDays} วัน · ${req.perDiemTotal.toFixed(2)} บาท`;
}

/** Which admin-fill-in items this tab still needs (spec §2.x needs* flags). */
function needsBookingLabel(req: TravelBookingRequest): string {
  const needs: string[] = [];
  if (req.needsRoomBooking) needs.push("ที่พัก");
  if (req.goNeedsTicketBooking) needs.push("ตั๋วขาไป");
  if (req.returnNeedsTicketBooking) needs.push("ตั๋วขากลับ");
  if (req.needsRentBooking) needs.push("เช่ายานพาหนะ");
  return needs.length > 0 ? needs.join(", ") : "-";
}

/**
 * Build the subject + HTML body for one AP-17 notification trigger. All interpolated
 * request/note values are HTML-escaped via `esc()` (through `row()`/`shell()`).
 */
export function buildTravelBookingEmail(
  trigger: TravelBookingTrigger,
  req: TravelBookingRequest,
  note?: string,
): { subject: string; html: string } {
  const url = `${env.NEXT_PUBLIC_APP_URL ?? ""}/request/travel-booking/${req.id ?? ""}`;
  const no = req.requestNo ?? "-";

  switch (trigger) {
    case "Submitted": {
      const subject = `ขออนุมัติจองที่พัก/ตั๋วโดยสาร ${no}`;
      const rows = [
        row("เลขที่", no),
        row("ผู้ขอ", req.requesterFullName ?? "-"),
        row("สถานที่ปฏิบัติงาน", workLocationLine(req)),
        row("วันเดินทาง", dateRangeLabel(req)),
        row("เบี้ยเลี้ยง", perDiemLabel(req)),
      ].join("");
      return { subject, html: shell(subject, rows, url) };
    }

    case "Approved": {
      const subject = `อนุมัติแล้ว ${no}`;
      // The DAY, not the month: a foreign trip pays on the 10th, so "ตุลาคม"
      // alone stopped naming when the money arrives.
      const payoutMonth = req.paymentDate ? payoutDateLabel(req.paymentDate) ?? "-" : "-";
      const rows = [
        row("เลขที่", no),
        row("กำหนดจ่าย", payoutMonth),
        row("เบี้ยเลี้ยงรวม (บาท)", req.perDiemTotal.toFixed(2)),
      ].join("");
      return { subject, html: shell(subject, rows, url) };
    }

    case "ReadyForAdmin": {
      const subject = `รอ Admin จองให้ ${no}`;
      const rows = [
        row("เลขที่", no),
        row("ผู้ขอ", req.requesterFullName ?? "-"),
        row("สถานที่ปฏิบัติงาน", workLocationLine(req)),
        row("วันเดินทาง", dateRangeLabel(req)),
        row("รายการที่ต้องจอง", needsBookingLabel(req)),
      ].join("");
      return { subject, html: shell(subject, rows, url) };
    }

    case "Rejected": {
      const subject = `ไม่อนุมัติ ${no}`;
      const rows = [
        row("เลขที่", no),
        row("ผู้ขอ", req.requesterFullName ?? "-"),
        note ? row("เหตุผล", note) : "",
      ].join("");
      return { subject, html: shell(subject, rows, url) };
    }

    case "Returned": {
      const subject = `ส่งกลับแก้ไข ${no}`;
      const rows = [
        row("เลขที่", no),
        row("ผู้ขอ", req.requesterFullName ?? "-"),
        note ? row("หมายเหตุ", note) : "",
      ].join("");
      return { subject, html: shell(subject, rows, url) };
    }

    case "Completed": {
      const subject = `การจองเสร็จสิ้น ${no}`;
      const rows = [
        row("เลขที่", no),
        row("สถานที่ปฏิบัติงาน", workLocationLine(req)),
        row("วันเดินทาง", dateRangeLabel(req)),
      ].join("");
      return { subject, html: shell(subject, rows, url) };
    }
  }
}
