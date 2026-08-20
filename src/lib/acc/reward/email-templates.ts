import { env } from "@/env";
import { esc } from "@/lib/acc/email-templates";
import { REWARD_FORM_MESSAGE_TH } from "@/features/reward/constants";
import type { RewardRequest } from "@/features/reward/types";

/**
 * AP-11 notification templates — every `AccEmailQueue.TriggerType` this form
 * emits.
 *
 * Same shell and escaping as AP-1's `email-templates.ts` and AP-17's, typed
 * against `RewardRequest` because the three forms do not share a read shape.
 * Every interpolated value goes through `esc()` via `row()`/`shell()`.
 */

const BRAND_COLOR = "#4c74c4";
const FORM_LABEL = "AP-11 · แบบฟอร์มแลกของรางวัล";

function shell(title: string, bodyRows: string, ctaUrl: string, footer?: string): string {
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto">
    <p style="margin:0 0 4px;color:#999;font-size:12px">${esc(FORM_LABEL)}</p>
    <h2 style="color:${BRAND_COLOR};margin-top:0">${esc(title)}</h2>
    <table style="width:100%;border-collapse:collapse">${bodyRows}</table>
    <p style="margin-top:16px"><a href="${esc(ctaUrl)}"
      style="background:${BRAND_COLOR};color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">เปิดเอกสาร</a></p>
    ${footer ? `<p style="margin-top:16px;color:#666;font-size:12px">${esc(footer)}</p>` : ""}
  </div>`;
}

function row(k: string, v: unknown): string {
  return `<tr><td style="padding:4px 8px;color:#666">${esc(k)}</td><td style="padding:4px 8px">${esc(v)}</td></tr>`;
}

export type RewardTrigger =
  | "Submitted"
  | "ManagerApproved"
  | "Approved"
  | "Ready"
  | "Received"
  | "Rejected"
  | "Returned";

/** The pickup instruction, repeated where it is actionable. */
const PICKUP_NOTE = REWARD_FORM_MESSAGE_TH[2];

function rewardLabel(req: RewardRequest): string {
  const name = req.rewardName ?? "-";
  const code = req.rewardCode ? ` (${req.rewardCode})` : "";
  return `${name}${code}`;
}

function amountLabel(req: RewardRequest): string {
  return req.totalActualValue == null ? "-" : `${req.totalActualValue.toFixed(2)} บาท`;
}

/** Common identifying rows — every trigger opens with these. */
function headRows(req: RewardRequest): string[] {
  return [
    row("เลขที่", req.requestNo ?? "-"),
    row("ผู้ขอเบิก", req.requesterFullName ?? "-"),
    row("ของรางวัล", rewardLabel(req)),
    row("จำนวน", `${req.qty} ชิ้น`),
  ];
}

export function buildRewardEmail(
  trigger: RewardTrigger,
  req: RewardRequest,
  note?: string,
): { subject: string; html: string } {
  const url = `${env.NEXT_PUBLIC_APP_URL ?? ""}/request/reward/${req.id}`;
  const no = req.requestNo ?? "-";

  switch (trigger) {
    case "Submitted": {
      const subject = `ขออนุมัติแลกของรางวัล ${no}`;
      const rows = [
        ...headRows(req),
        row("มูลค่ารวม", amountLabel(req)),
        row("แผนก", req.requesterDepartmentName ?? "-"),
      ].join("");
      return { subject, html: shell(subject, rows, url) };
    }

    case "ManagerApproved": {
      // To the Assist AP roster — their queue has work in it.
      const subject = `รอจัดของรางวัล ${no}`;
      const rows = [
        ...headRows(req),
        row("แผนก", req.requesterDepartmentName ?? "-"),
        row("ผู้จัดการอนุมัติเมื่อ", req.updatedAt ? req.updatedAt.slice(0, 10) : "-"),
      ].join("");
      return { subject, html: shell(subject, rows, url) };
    }

    case "Approved": {
      const subject = `อนุมัติแล้ว — รอจัดของ ${no}`;
      const rows = [...headRows(req), row("มูลค่ารวม", amountLabel(req))].join("");
      return { subject, html: shell(subject, rows, url, PICKUP_NOTE) };
    }

    case "Ready": {
      const subject = `ของรางวัลพร้อมให้รับแล้ว ${no}`;
      const rows = [
        ...headRows(req),
        row("จัดของเสร็จเมื่อ", req.readyAt ?? "-"),
      ].join("");
      return { subject, html: shell(subject, rows, url, PICKUP_NOTE) };
    }

    case "Received": {
      const subject = `รับของรางวัลเรียบร้อย ${no}`;
      const rows = [
        ...headRows(req),
        row("รับของเมื่อ", req.receivedAt ?? "-"),
        row("ผู้จ่ายของ", req.receivedByName ?? "-"),
      ].join("");
      return { subject, html: shell(subject, rows, url) };
    }

    case "Rejected": {
      const subject = `ไม่อนุมัติ ${no}`;
      const rows = [
        ...headRows(req),
        note ? row("เหตุผล", note) : "",
        // Say it plainly: the requester's mental model is "my request failed",
        // and the stock question is the one the next person will ask.
        row("จำนวนที่ล็อกไว้", "คืนเข้าคลังของรางวัลแล้ว"),
      ].join("");
      return { subject, html: shell(subject, rows, url) };
    }

    case "Returned": {
      const subject = `ส่งกลับแก้ไข ${no}`;
      const rows = [
        ...headRows(req),
        note ? row("สิ่งที่ต้องแก้ไข", note) : "",
        row("จำนวนที่ล็อกไว้", "ยังถูกกันไว้ให้ระหว่างแก้ไข"),
      ].join("");
      return { subject, html: shell(subject, rows, url) };
    }
  }
}
