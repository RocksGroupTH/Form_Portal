"use client";

import React from "react";
import useSWR from "swr";
import {
  CheckCircle,
  Clock,
  FileCheck,
  FileSpreadsheet,
  FileText,
  ImageIcon,
  ListChecks,
  Mail,
  Paperclip,
  Receipt,
  RotateCcw,
  User,
  XCircle,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { UatDataBanner } from "@/components/UatDataBanner";
import { getBrandById } from "@/lib/brand";
import { statusLabelDisplay } from "@/features/accounting/constants";
import { sumReimburseItems } from "@/lib/acc/reimburse/calc";
import type { ReimburseStepCode } from "@/features/reimburse/constants";
import type {
  ReimburseApproval,
  ReimburseDetail as ReimburseDetailData,
  ReimburseFileMeta,
  ReimburseRule,
} from "@/features/reimburse/types";

/**
 * AP-4 detail — the request as it stands, plus its approval timeline.
 *
 * Read-only by design: approve / reject / return are Task 7's, so this page
 * shows the current step and who it sits with and offers no way to act on it.
 * Laid out like AP-1's `RequestDetail` so the two forms read the same.
 */

/* ─────────────────────────── helpers ─────────────────────────── */

/** Local getters throughout — the server runs on Thai time and `toISOString` would shift the day. */
function fmtDateTime(raw: string | null | undefined): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`;
}

function fmtDateOnly(raw: string | null | undefined): string {
  if (!raw) return "—";
  // A YYYY-MM-DD from the server is already local-calendar text; parsing it
  // through Date would reinterpret it as UTC midnight.
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (ymd) return `${ymd[3]}/${ymd[2]}/${ymd[1]}`;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function jsonFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "Request failed");
  return json.data as T;
}

/** AP-4's three steps — the shared two-step vocabulary plus `ACCOUNT_FINAL` (migration 091). */
const STEP_LABEL: Record<ReimburseStepCode, string> = {
  MANAGER: "ผู้จัดการ",
  ACCOUNT: "บัญชี",
  ACCOUNT_FINAL: "บัญชี (อนุมัติขั้นสุดท้าย)",
};

function approvalActorLabel(a: ReimburseApproval): string | null {
  if (a.status === "Pending") {
    if (!a.assignedEmail && a.assignedTo == null) return "ฝ่ายบัญชี";
    const name = a.assignedToHrName?.trim();
    if (name && a.assignedTo != null) return `${name} · StaffId ${a.assignedTo}`;
    if (name) return name;
    if (a.assignedTo != null) return `StaffId ${a.assignedTo}`;
    return a.assignedEmail;
  }
  const name = a.actionedByHrName?.trim();
  const email = a.actionedByHrEmail ?? a.assignedEmail;
  if (name && a.actionedByStaffId != null) return `${name} · StaffId ${a.actionedByStaffId}`;
  if (name && email) return `${name} (${email})`;
  if (name) return name;
  if (a.actionedByStaffId != null) return `StaffId ${a.actionedByStaffId}`;
  return email ?? null;
}

function approvalActorPrefix(status: ReimburseApproval["status"]): string {
  if (status === "Approved") return "อนุมัติโดย";
  if (status === "Rejected") return "ไม่อนุมัติโดย";
  if (status === "Returned") return "ส่งกลับโดย";
  return "รอดำเนินการโดย";
}

function isImageFile(f: ReimburseFileMeta): boolean {
  if (f.contentType?.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(f.fileName);
}

/* ─────────────────────────── small pieces ─────────────────────────── */

function ApprovalStatusBadge({ status }: { status: ReimburseApproval["status"] }) {
  const cfg: Record<
    ReimburseApproval["status"],
    { label: string; icon: React.ReactNode; bg: string; text: string; border: string }
  > = {
    Pending: {
      label: "รออนุมัติ",
      icon: <Clock size={12} />,
      bg: "var(--bg-info-yellow)",
      text: "var(--text-info-yellow)",
      border: "var(--border-info-yellow)",
    },
    Approved: {
      label: "อนุมัติแล้ว",
      icon: <CheckCircle size={12} />,
      bg: "var(--bg-info-green)",
      text: "var(--text-info-green)",
      border: "var(--border-info-green)",
    },
    Rejected: {
      label: "ไม่อนุมัติ",
      icon: <XCircle size={12} />,
      bg: "var(--status-bad-bg)",
      text: "var(--status-bad-text)",
      border: "var(--status-bad-bg)",
    },
    Returned: {
      label: "ส่งกลับแก้ไข",
      icon: <RotateCcw size={12} />,
      bg: "var(--bg-info-yellow)",
      text: "var(--text-info-yellow)",
      border: "var(--border-info-yellow)",
    },
  };
  const c = cfg[status];
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
    >
      {c.icon}
      {c.label}
    </span>
  );
}

function RequestStatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string }> = {
    Draft: { bg: "var(--status-draft-bg)", text: "var(--status-draft-text)" },
    Submitted: { bg: "var(--status-pending-bg)", text: "var(--status-pending-text)" },
    ManagerApproved: { bg: "var(--status-pending-bg)", text: "var(--status-pending-text)" },
    Approved: { bg: "var(--status-ok-bg)", text: "var(--status-ok-text)" },
    Rejected: { bg: "var(--status-bad-bg)", text: "var(--status-bad-text)" },
    Returned: { bg: "var(--status-draft-bg)", text: "var(--status-draft-text)" },
    Cancelled: { bg: "var(--bg-badge)", text: "var(--text-faint)" },
  };
  const c = map[status] ?? map.Draft;
  return (
    <span
      className="inline-flex items-center text-[11px] font-medium px-2.5 py-1 rounded-full"
      style={{ background: c.bg, color: c.text }}
    >
      {statusLabelDisplay(status)}
    </span>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-2xl overflow-hidden mb-4"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-card)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div
        className="flex items-center gap-2.5 px-5 py-3"
        style={{ borderBottom: "1px solid var(--border-card)", background: "var(--bg-card-alt)" }}
      >
        {icon && (
          <span
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
          >
            {icon}
          </span>
        )}
        <h2 className="text-[13px] font-bold m-0" style={{ color: "var(--text-heading)" }}>
          {title}
        </h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-2">
      <span className="text-[11px] font-medium shrink-0 sm:w-36" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
      <span className="text-[13px] min-w-0" style={{ color: "var(--text-primary)" }}>
        {value ?? "—"}
      </span>
    </div>
  );
}

function FileLink({ file }: { file: ReimburseFileMeta }) {
  const image = isImageFile(file);
  return (
    <a
      href={file.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2.5 rounded-lg px-3 py-2 min-w-0 no-underline"
      style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
    >
      <span className="shrink-0" style={{ color: "var(--nav-active-text)" }}>
        {image ? <ImageIcon size={16} /> : <FileText size={16} />}
      </span>
      <span className="text-[12.5px] font-semibold truncate" style={{ color: "var(--text-primary)" }}>
        {file.fileName}
      </span>
    </a>
  );
}

/* ─────────────────────────── main ─────────────────────────── */

export function ReimburseDetail({ request }: { request: ReimburseDetailData }) {
  // Rule text for the ids this request acknowledged. Only active rules are
  // listed, so a rule retired since the acknowledgement shows as a count
  // rather than silently disappearing from the total.
  const { data: rulesData } = useSWR<ReimburseRule[]>(
    "/api/request/reimburse/settings/rules",
    jsonFetcher,
    { revalidateOnFocus: false },
  );
  const rules = rulesData ?? [];
  const ackedSet = new Set(request.ackedRuleIds);
  const ackedRules = rules.filter((r) => ackedSet.has(r.id));

  const brand = getBrandById(request.brandCode);
  // Recomputed from the items on screen, with the server's own function, so the
  // figure below the table cannot drift from the stored header total.
  const itemsTotal = sumReimburseItems(request.items);
  const approvals = (request.approvals ?? []).slice().sort((a, b) => a.stepOrder - b.stepOrder);

  return (
    <div>
      <UatDataBanner requestId={request.id} />

      {/* ── ขั้นตอนการอนุมัติ ── */}
      {approvals.length > 0 && (
        <Section title="ขั้นตอนการอนุมัติ" icon={<CheckCircle size={15} />}>
          <div className="flex flex-col gap-0">
            {approvals.map((a, idx) => {
              const isLast = idx === approvals.length - 1;
              const dot =
                a.status === "Approved"
                  ? { background: "var(--bg-info-green)", color: "var(--text-info-green)", border: "1px solid var(--border-info-green)" }
                  : a.status === "Rejected"
                    ? { background: "var(--status-bad-bg)", color: "var(--status-bad-text)", border: "1px solid var(--status-bad-bg)" }
                    : a.status === "Returned"
                      ? { background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }
                      : { background: "var(--bg-badge)", color: "var(--text-muted)", border: "1px solid var(--border-card)" };
              const actor = approvalActorLabel(a);
              return (
                <div key={a.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                      style={dot}
                    >
                      {a.status === "Approved" ? (
                        <CheckCircle size={14} />
                      ) : a.status === "Rejected" ? (
                        <XCircle size={14} />
                      ) : a.status === "Returned" ? (
                        <RotateCcw size={13} />
                      ) : (
                        <Clock size={13} />
                      )}
                    </div>
                    {!isLast && (
                      <div className="w-px flex-1 my-1" style={{ background: "var(--border-light)", minHeight: 16 }} />
                    )}
                  </div>

                  <div className="flex-1 pb-4 min-w-0">
                    <div className="mb-1 flex items-center gap-2 flex-wrap">
                      <ApprovalStatusBadge status={a.status} />
                      {request.currentStepCode === a.stepCode && a.status === "Pending" && (
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
                        >
                          ขั้นตอนปัจจุบัน
                        </span>
                      )}
                    </div>
                    <div className="mb-0.5">
                      <span className="text-[13px] font-medium" style={{ color: "var(--text-heading)" }}>
                        {STEP_LABEL[a.stepCode] ?? a.stepCode}
                      </span>
                    </div>
                    {actor && (
                      <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
                        {approvalActorPrefix(a.status)} {actor}
                      </p>
                    )}
                    {a.comment && (
                      <p
                        className="text-[12px] mt-1 px-2 py-1.5 rounded-lg whitespace-pre-wrap break-words"
                        style={{
                          color: "var(--text-secondary)",
                          background: "var(--bg-card-alt)",
                          border: "1px solid var(--border-light)",
                        }}
                      >
                        {a.comment}
                      </p>
                    )}
                    {a.actionedAt && (
                      <p className="text-[10px] mt-1 m-0" style={{ color: "var(--text-faint)" }}>
                        {fmtDateTime(a.actionedAt)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* ── รายละเอียดคำขอ ── */}
      <Section title="รายละเอียดคำขอ" icon={<Receipt size={15} />}>
        <div className="flex flex-col gap-2.5">
          <DetailRow label="เลขที่คำขอ" value={request.requestNo ?? "ฉบับร่าง"} />
          <DetailRow label="สถานะ" value={<RequestStatusBadge status={request.status} />} />
          <DetailRow label="แบรนด์ที่เบิก" value={brand?.name ?? request.brandCode ?? "—"} />
          {request.purpose && (
            <DetailRow
              label="วัตถุประสงค์"
              value={<span className="whitespace-pre-wrap break-words">{request.purpose}</span>}
            />
          )}
          <DetailRow
            label="ยอดรวมที่ขอเบิก"
            value={<span className="font-bold tabular-nums">฿{fmtMoney(request.totalAmount ?? itemsTotal)}</span>}
          />
          {request.submittedAt && <DetailRow label="วันที่ส่ง" value={fmtDateTime(request.submittedAt)} />}
          {request.paymentDate && <DetailRow label="วันที่จ่าย" value={fmtDateOnly(request.paymentDate)} />}
        </div>
      </Section>

      {/* ── ผู้ขอเบิก ── */}
      <Section title="ผู้ขอเบิก" icon={<User size={15} />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="shrink-0 rounded-2xl overflow-hidden" style={{ boxShadow: "0 0 0 2px var(--nav-active-bg)" }}>
              <Avatar name={request.requesterFullName || "?"} size={48} color="var(--nav-active-text)" />
            </div>
            <div className="min-w-0 flex flex-col gap-0.5">
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-[14px] font-bold truncate" style={{ color: "var(--text-primary)" }}>
                  {request.requesterFullName || "-"}
                </span>
                {request.staffId != null && (
                  <span className="text-[11px] shrink-0" style={{ color: "var(--text-muted)" }}>
                    #{request.staffId}
                  </span>
                )}
              </div>
              {(request.requesterDepartmentName || request.requesterPosition) && (
                <span className="text-[12px] truncate" style={{ color: "var(--text-muted)" }}>
                  {[request.requesterDepartmentName, request.requesterPosition].filter(Boolean).join(" · ")}
                </span>
              )}
              {request.requesterEmail && (
                <span className="inline-flex items-center gap-1 text-[12px] truncate" style={{ color: "var(--text-secondary)" }}>
                  <Mail size={11} className="shrink-0" />
                  <span className="truncate">{request.requesterEmail}</span>
                </span>
              )}
            </div>
          </div>

          {request.managerEmail && (
            <div className="flex items-center gap-3 min-w-0 border-t md:border-t-0 md:border-l border-[var(--border-light)] pt-4 md:pt-0 md:pl-6">
              <div className="shrink-0 rounded-2xl overflow-hidden" style={{ boxShadow: "0 0 0 2px var(--nav-active-bg)" }}>
                <Avatar name={request.managerEmail} size={48} color="var(--nav-active-text)" />
              </div>
              <div className="min-w-0 flex flex-col gap-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                  หัวหน้างาน (ผู้จัดการ)
                </span>
                {request.managerStaffId != null && (
                  <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                    #{request.managerStaffId}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 text-[12px] truncate" style={{ color: "var(--text-secondary)" }}>
                  <Mail size={11} className="shrink-0" />
                  <span className="truncate">{request.managerEmail}</span>
                </span>
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* ── รายการค่าใช้จ่ายจริง ── */}
      <Section title="รายการค่าใช้จ่ายจริง" icon={<ListChecks size={15} />}>
        {request.items.length === 0 ? (
          <p className="text-[13px] m-0" style={{ color: "var(--text-faint)" }}>
            — ไม่มีรายการ —
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-card)" }}>
                  {["วันที่", "รายละเอียด", "ยอดรวม VAT", "VAT", "หัก ณ ที่จ่าย"].map((h, i) => (
                    <th
                      key={h}
                      className={`text-[11px] font-semibold uppercase tracking-wide py-2 px-2 ${i >= 2 ? "text-right" : "text-left"}`}
                      style={{ color: "var(--text-muted)" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {request.items.map((it, i) => (
                  <tr key={it.id ?? i} style={{ borderBottom: "1px solid var(--border-light)" }}>
                    <td className="text-[13px] py-2 px-2 whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                      {fmtDateOnly(it.expenseDate)}
                    </td>
                    <td className="text-[13px] py-2 px-2 break-words" style={{ color: "var(--text-primary)" }}>
                      {it.description || "—"}
                    </td>
                    <td className="text-[13px] py-2 px-2 text-right tabular-nums font-semibold" style={{ color: "var(--text-primary)" }}>
                      {fmtMoney(it.amount)}
                    </td>
                    <td className="text-[13px] py-2 px-2 text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>
                      {fmtMoney(it.vatAmount)}
                    </td>
                    <td className="text-[13px] py-2 px-2 text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>
                      {fmtMoney(it.whtAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div
          className="rounded-xl px-4 py-3 flex items-center justify-between gap-3 mt-3"
          style={{ background: "var(--nav-active-bg)" }}
        >
          <span className="text-[12.5px] font-semibold" style={{ color: "var(--nav-active-text)" }}>
            ยอดรวมที่ขอเบิก
          </span>
          <span className="text-[16px] font-bold tabular-nums" style={{ color: "var(--nav-active-text)" }}>
            ฿{fmtMoney(itemsTotal)}
          </span>
        </div>
      </Section>

      {/* ── เอกสารแนบ ── */}
      <Section title="เอกสารแนบ" icon={<Paperclip size={15} />}>
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide mb-1.5 m-0" style={{ color: "var(--text-muted)" }}>
              <FileSpreadsheet size={11} className="inline mr-1 -mt-0.5" />
              ไฟล์ Excel สรุปรายการ (AP-4.1)
            </p>
            {request.excelFile ? (
              <FileLink file={request.excelFile} />
            ) : (
              <p className="text-[13px] m-0" style={{ color: "var(--text-faint)" }}>
                — ไม่มีไฟล์ —
              </p>
            )}
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide mb-1.5 m-0" style={{ color: "var(--text-muted)" }}>
              หลักฐาน (ใบเสร็จ / ใบกำกับภาษี)
            </p>
            {request.receiptFiles.length === 0 ? (
              <p className="text-[13px] m-0" style={{ color: "var(--text-faint)" }}>
                — ไม่มีไฟล์ —
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {request.receiptFiles.map((f) => (
                  <FileLink key={f.id} file={f} />
                ))}
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* ── ระเบียบการจ่าย ── */}
      <Section title="ระเบียบการจ่าย Reimburse" icon={<FileCheck size={15} />}>
        {request.ackedRuleIds.length === 0 ? (
          <p className="text-[13px] m-0" style={{ color: "var(--text-faint)" }}>
            — ยังไม่ได้ยืนยัน —
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>
              ยืนยันแล้ว {request.ackedRuleIds.length} ข้อ
            </p>
            {ackedRules.map((r) => (
              <div key={r.id} className="flex items-start gap-2 min-w-0">
                <CheckCircle size={14} className="shrink-0 mt-0.5" style={{ color: "var(--text-info-green)" }} />
                <span
                  className="text-[12.5px] leading-relaxed whitespace-pre-wrap break-words"
                  style={{ color: "var(--text-primary)" }}
                >
                  {r.ruleText}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
