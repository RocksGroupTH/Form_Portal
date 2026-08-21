"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  FileText, User, Mail, Wallet, CheckCircle, XCircle, Clock, RotateCcw,
  ThumbsUp, ThumbsDown, Ban, Paperclip, Image as ImageIcon, Banknote, ReceiptText,
} from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Avatar } from "@/components/ui/Avatar";
import { ImageLightbox } from "@/features/accounting/components/ImageLightbox";
import { RequestStatusBadge } from "@/features/accounting/components/RequestStatusBadge";
import { CLR_STEP_CODES, CLR_STEP_LABEL_TH, type ClrStepCode } from "@/features/clear-advance/constants";
import type { AccFileMeta } from "@/features/accounting/types";
import type { ClearAdvanceItem, ClearAdvanceRequest, ClrApproval } from "@/features/clear-advance/types";

function money(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Local-getter datetime formatter — never toISOString for display. */
function fmtDate(raw: string | null | undefined): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

/** Date-only display (expense dates come as YYYY-MM-DD). */
function fmtDateOnly(raw: string | null | undefined): string {
  if (!raw) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** Today as YYYY-MM-DD via local getters (server is Thai time). */
function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isImage(f: AccFileMeta): boolean {
  return (f.contentType ?? "").startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(f.fileName);
}

const box = { background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-sm)" } as const;

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl overflow-hidden mb-4" style={box}>
      <div className="flex items-center gap-2.5 px-5 py-3"
        style={{ borderBottom: "1px solid var(--border-card)", background: "var(--bg-card-alt)" }}>
        <span className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}>
          {icon}
        </span>
        <h2 className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>{title}</h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function DetailRow({ label, value, valueStyle }: { label: string; value: React.ReactNode; valueStyle?: React.CSSProperties }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-2">
      <span className="text-[11px] font-medium shrink-0 sm:w-40" style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span className="text-[13px]" style={{ color: "var(--text-primary)", ...valueStyle }}>{value ?? "—"}</span>
    </div>
  );
}

function ApprovalStatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { label: string; icon: React.ReactNode; bg: string; text: string; border: string }> = {
    Pending: { label: "รออนุมัติ", icon: <Clock size={12} />, bg: "var(--bg-info-yellow)", text: "var(--text-info-yellow)", border: "var(--border-info-yellow)" },
    Approved: { label: "อนุมัติแล้ว", icon: <CheckCircle size={12} />, bg: "var(--bg-info-green)", text: "var(--text-info-green)", border: "var(--border-info-green)" },
    Rejected: { label: "ไม่อนุมัติ", icon: <XCircle size={12} />, bg: "rgba(220,38,38,0.08)", text: "var(--color-danger)", border: "rgba(220,38,38,0.2)" },
    Returned: { label: "ส่งกลับแก้ไข", icon: <RotateCcw size={12} />, bg: "var(--bg-info-yellow)", text: "var(--text-info-yellow)", border: "var(--border-info-yellow)" },
  };
  const c = cfg[status] ?? { label: status, icon: <Clock size={12} />, bg: "var(--bg-badge)", text: "var(--text-muted)", border: "var(--border-card)" };
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}>
      {c.icon}{c.label}
    </span>
  );
}

interface Props {
  request: ClearAdvanceRequest;
  onChanged?: () => void;
}

export function ClearAdvanceDetail({ request, onChanged }: Props) {
  const clear = request.clear;
  const items = clear?.items ?? [];
  const whtItems = clear?.whtItems ?? [];
  const files = clear?.files ?? [];
  const refundProofFiles = clear?.refundProofFiles ?? [];
  const refund = clear?.refundToCompany ?? 0;
  const companyPaysExtra = refund < 0;

  const [viewerStaffId, setViewerStaffId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  // Manager step dialogs.
  const [mgAction, setMgAction] = useState<"approve" | "return" | "reject" | null>(null);
  const [mgComment, setMgComment] = useState("");
  // Account / Head step inputs.
  const [accChecked, setAccChecked] = useState(false);
  const [pvDocNo, setPvDocNo] = useState(clear?.pvDocNo ?? "");
  const [paymentDate, setPaymentDate] = useState(clear?.paymentDate ?? "");
  const [accAction, setAccAction] = useState<null | "reject" | "return">(null);
  const [accComment, setAccComment] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me/employee")
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: { employee?: { staffId?: number | null } | null } }) => {
        if (cancelled) return;
        const sid = json.ok ? json.data?.employee?.staffId : null;
        setViewerStaffId(sid != null ? sid : null);
      })
      .catch(() => { if (!cancelled) setViewerStaffId(null); });
    return () => { cancelled = true; };
  }, []);

  const step = request.currentStepCode;
  const inApproval = request.status === "Submitted" && step != null;
  const isManagerStep = inApproval && step === "MANAGER";
  const isAccountStep = inApproval && step === "ACCOUNT";
  const isHeadStep = inApproval && step === "HEAD";

  // Requester self-cancel: they own it, still pending the manager (before Account),
  // within 24h of submit. Sends an email to the manager + requester on cancel.
  const isOwner = viewerStaffId != null && request.staffId != null && viewerStaffId === request.staffId;
  const canCancel =
    isOwner &&
    request.status === "Submitted" &&
    step === "MANAGER" &&
    request.submittedAt != null &&
    Date.now() - new Date(request.submittedAt).getTime() <= 24 * 3600 * 1000;

  const approvalsByStep = useMemo(() => {
    const map = new Map<ClrStepCode, ClrApproval>();
    for (const a of request.approvals ?? []) map.set(a.stepCode, a);
    return map;
  }, [request.approvals]);

  async function act(path: string, body?: unknown) {
    setBusy(true);
    try {
      const res = await fetch(`/api/request/clear-advance/requests/${request.id}/${path}`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "ดำเนินการไม่สำเร็จ");
      toast.success("ดำเนินการสำเร็จ");
      setMgAction(null); setMgComment("");
      setAccAction(null); setAccComment(""); setAccChecked(false);
      setCancelOpen(false);
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ดำเนินการไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  function handleManagerAction() {
    if (!mgAction) return;
    if ((mgAction === "return" || mgAction === "reject") && !mgComment.trim()) {
      return toast.error("กรุณาระบุเหตุผล");
    }
    if (mgAction === "approve") act("approve");
    else if (mgAction === "return") act("return", { comment: mgComment.trim() });
    else act("reject", { comment: mgComment.trim() });
  }

  function handleAccountApprove() {
    // Payment date is required only when the company pays extra (company owes the requester).
    if (companyPaysExtra && !paymentDate) {
      return toast.error("กรณีบริษัทต้องจ่ายเพิ่ม กรุณาระบุวันจ่าย (ศุกร์)");
    }
    act("approve", {
      isChecked: accChecked,
      pvDocNo: pvDocNo.trim() || null,
      paymentDate: paymentDate || null,
    });
  }

  return (
    <div>
      {/* Requester self-cancel bar */}
      {canCancel && (
        <div className="rounded-2xl p-4 mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5" style={box}>
          <div className="flex items-start gap-2.5 min-w-0">
            <Ban size={16} style={{ color: "var(--color-danger)", marginTop: 2 }} className="shrink-0" />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold" style={{ color: "var(--text-heading)" }}>ยกเลิกคำขอ</p>
              <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                ยกเลิกเองได้ภายใน 24 ชม. หลังส่งคำขอ และก่อนผู้จัดการอนุมัติ (ก่อนถึงขั้นบัญชี) · ระบบจะแจ้งเมลผู้จัดการ
              </p>
            </div>
          </div>
          <button type="button" onClick={() => setCancelOpen(true)}
            className="shrink-0 inline-flex items-center gap-2 text-[13px] font-semibold px-4 py-2 rounded-lg cursor-pointer"
            style={{ color: "var(--color-danger)", border: "1px solid rgba(220,38,38,0.3)", background: "rgba(220,38,38,0.06)" }}>
            <Ban size={14} /> ยกเลิกคำขอ
          </button>
        </div>
      )}

      {/* Approval timeline + actions */}
      <Section title="ขั้นตอนการอนุมัติ" icon={<CheckCircle size={15} />}>
        {/* Manager step action buttons */}
        {isManagerStep && (
          <div className="mb-4 pb-4 flex flex-wrap gap-2" style={{ borderBottom: "1px solid var(--border-light)" }}>
            <button type="button" onClick={() => { setMgAction("approve"); setMgComment(""); }} disabled={busy}
              className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg cursor-pointer"
              style={{ background: "var(--bg-info-green)", color: "var(--text-info-green)", border: "1px solid var(--border-info-green)" }}>
              <ThumbsUp size={14} /> อนุมัติ
            </button>
            <button type="button" onClick={() => { setMgAction("return"); setMgComment(""); }} disabled={busy}
              className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg cursor-pointer"
              style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}>
              <RotateCcw size={14} /> ส่งกลับแก้ไข
            </button>
            <button type="button" onClick={() => { setMgAction("reject"); setMgComment(""); }} disabled={busy}
              className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg cursor-pointer"
              style={{ color: "var(--color-danger)", border: "1px solid rgba(220,38,38,0.25)", background: "rgba(220,38,38,0.06)" }}>
              <ThumbsDown size={14} /> ไม่อนุมัติ
            </button>
          </div>
        )}

        {/* Account step — PV/PPEX doc no. + payment date panel. API authorizes; 403 toasts. */}
        {isAccountStep && (
          <div className="mb-4 pb-4 flex flex-col gap-3" style={{ borderBottom: "1px solid var(--border-light)" }}>
            <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
              ขั้นตอน: {CLR_STEP_LABEL_TH.ACCOUNT}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>เลขที่ PV / PPEX</label>
                <input className="text-[13px] px-3 py-2 rounded-lg outline-none"
                  style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
                  value={pvDocNo} onChange={(e) => setPvDocNo(e.target.value)} placeholder="เช่น PV2601-0001" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                  วันจ่าย (ศุกร์){companyPaysExtra ? " *" : ""}
                </label>
                <input type="date" className="text-[13px] px-3 py-2 rounded-lg outline-none"
                  style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
                  value={paymentDate}
                  min={todayYmd()}
                  onChange={(e) => setPaymentDate(e.target.value)} />
                <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
                  {companyPaysExtra ? "บริษัทต้องจ่ายเพิ่ม — ระบุวันจ่าย" : "ระบุเมื่อมีการจ่ายเงินให้ผู้ขอ"}
                </span>
              </div>
            </div>
            <label className="text-[12px] flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
              <input type="checkbox" checked={accChecked} onChange={(e) => setAccChecked(e.target.checked)} />
              ตรวจสอบแล้ว
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={handleAccountApprove} disabled={busy}
                className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg cursor-pointer"
                style={{ background: "var(--bg-info-green)", color: "var(--text-info-green)", border: "1px solid var(--border-info-green)" }}>
                <ThumbsUp size={14} /> อนุมัติ
              </button>
              <button type="button" onClick={() => { setAccAction("return"); setAccComment(""); }} disabled={busy}
                className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg cursor-pointer"
                style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}>
                <RotateCcw size={14} /> ส่งกลับแก้ไข
              </button>
              <button type="button" onClick={() => { setAccAction("reject"); setAccComment(""); }} disabled={busy}
                className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg cursor-pointer"
                style={{ color: "var(--color-danger)", border: "1px solid rgba(220,38,38,0.25)", background: "rgba(220,38,38,0.06)" }}>
                <ThumbsDown size={14} /> ไม่อนุมัติ
              </button>
            </div>
          </div>
        )}

        {/* Head step — check + approve / revise / reject. */}
        {isHeadStep && (
          <div className="mb-4 pb-4 flex flex-col gap-3" style={{ borderBottom: "1px solid var(--border-light)" }}>
            <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
              ขั้นตอน: {CLR_STEP_LABEL_TH.HEAD}
            </p>
            <label className="text-[12px] flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
              <input type="checkbox" checked={accChecked} onChange={(e) => setAccChecked(e.target.checked)} />
              ตรวจสอบแล้ว
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => act("approve", { isChecked: accChecked })} disabled={busy}
                className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg cursor-pointer"
                style={{ background: "var(--bg-info-green)", color: "var(--text-info-green)", border: "1px solid var(--border-info-green)" }}>
                <ThumbsUp size={14} /> อนุมัติ
              </button>
              <button type="button" onClick={() => { setAccAction("return"); setAccComment(""); }} disabled={busy}
                className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg cursor-pointer"
                style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}>
                <RotateCcw size={14} /> ส่งกลับแก้ไข
              </button>
              <button type="button" onClick={() => { setAccAction("reject"); setAccComment(""); }} disabled={busy}
                className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg cursor-pointer"
                style={{ color: "var(--color-danger)", border: "1px solid rgba(220,38,38,0.25)", background: "rgba(220,38,38,0.06)" }}>
                <ThumbsDown size={14} /> ไม่อนุมัติ
              </button>
            </div>
          </div>
        )}

        {/* 3-step timeline (MANAGER → ACCOUNT → HEAD) */}
        <div className="flex flex-col gap-0">
          {CLR_STEP_CODES.map((code, idx) => {
            const a = approvalsByStep.get(code);
            const status = a?.status ?? "Pending";
            const isLast = idx === CLR_STEP_CODES.length - 1;
            const who = a?.actionedByName ?? a?.assignedName ?? null;
            return (
              <div key={code} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                    style={
                      status === "Approved" ? { background: "var(--bg-info-green)", color: "var(--text-info-green)", border: "1px solid var(--border-info-green)" }
                      : status === "Rejected" ? { background: "rgba(220,38,38,0.08)", color: "var(--color-danger)", border: "1px solid rgba(220,38,38,0.2)" }
                      : status === "Returned" ? { background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }
                      : { background: "var(--bg-badge)", color: "var(--text-muted)", border: "1px solid var(--border-card)" }
                    }>
                    {status === "Approved" ? <CheckCircle size={14} /> : status === "Rejected" ? <XCircle size={14} />
                      : status === "Returned" ? <RotateCcw size={13} /> : <Clock size={13} />}
                  </div>
                  {!isLast && <div className="w-px flex-1 my-1" style={{ background: "var(--border-light)", minHeight: 16 }} />}
                </div>
                <div className="flex-1 pb-4">
                  <div className="mb-1"><ApprovalStatusBadge status={status} /></div>
                  <div className="mb-0.5">
                    <span className="text-[13px] font-medium" style={{ color: "var(--text-heading)" }}>
                      {CLR_STEP_LABEL_TH[code]}
                    </span>
                  </div>
                  {who && (
                    <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
                      {status === "Pending" ? "รอดำเนินการโดย" : status === "Approved" ? "อนุมัติโดย"
                        : status === "Rejected" ? "ไม่อนุมัติโดย" : "ส่งกลับโดย"} {who}
                    </p>
                  )}
                  {a?.comment && (
                    <p className="text-[12px] mt-1 px-2 py-1.5 rounded-lg"
                      style={{ color: "var(--text-secondary)", background: "var(--bg-card-alt)", border: "1px solid var(--border-light)" }}>
                      {a.comment}
                    </p>
                  )}
                  {a?.actionedAt && (
                    <p className="text-[10px] mt-1" style={{ color: "var(--text-faint)" }}>{fmtDate(a.actionedAt)}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* Request summary */}
      <Section title="รายละเอียดคำขอ" icon={<FileText size={15} />}>
        <div className="flex flex-col gap-2.5">
          <DetailRow label="เลขที่คำขอ" value={request.requestNo ?? "ฉบับร่าง"} />
          <DetailRow label="สถานะ" value={<RequestStatusBadge status={request.status} />} />
          <DetailRow label="แบรนด์ / เป็นค่าใช้จ่ายของ" value={request.brandCode} />
          {clear?.pvDocNo && <DetailRow label="เลขที่ PV / PPEX" value={clear.pvDocNo} />}
          {clear?.paymentDate && <DetailRow label="วันจ่าย" value={fmtDateOnly(clear.paymentDate)} />}
          {request.submittedAt && <DetailRow label="วันที่ส่ง" value={fmtDate(request.submittedAt)} />}
        </div>
      </Section>

      {/* Requester */}
      <Section title="ผู้ขอ" icon={<User size={15} />}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="shrink-0 rounded-2xl overflow-hidden" style={{ boxShadow: "0 0 0 2px var(--nav-active-bg)" }}>
            <Avatar name={request.requesterFullName || "?"} size={48} color="var(--nav-active-text)" />
          </div>
          <div className="min-w-0 flex flex-col gap-0.5">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-[14px] font-bold truncate" style={{ color: "var(--text-primary)" }}>{request.requesterFullName || "-"}</span>
              {request.staffId != null && <span className="text-[11px] shrink-0" style={{ color: "var(--text-muted)" }}>#{request.staffId}</span>}
            </div>
            {(request.requesterDepartmentName || request.requesterPosition) && (
              <span className="text-[12px] truncate" style={{ color: "var(--text-muted)" }}>
                {[request.requesterDepartmentName, request.requesterPosition].filter(Boolean).join(" · ")}
              </span>
            )}
            {request.requesterEmail && (
              <span className="inline-flex items-center gap-1 text-[12px] truncate" style={{ color: "var(--text-secondary)" }}>
                <Mail size={11} className="shrink-0" /> <span className="truncate">{request.requesterEmail}</span>
              </span>
            )}
          </div>
        </div>
      </Section>

      {/* Linked advance + expense ledger */}
      <Section title="เงินทดรองจ่ายที่เคลียร์" icon={<Wallet size={15} />}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <AmountTile label="เลขที่ AP-2" value={clear?.advanceRequestNo ?? "—"} plain />
          <AmountTile label="วงเงินที่ได้รับ" value={`฿${money(clear?.advanceAmount)}`} />
          <AmountTile label="ใช้จ่ายจริง (สุทธิ)" value={`฿${money(clear?.actualTotal)}`} />
        </div>

        {/* Expense-line table with running balance */}
        <div className="mt-4">
          <p className="text-[10px] font-semibold uppercase tracking-wide m-0 mb-2" style={{ color: "var(--text-muted)" }}>
            รายการค่าใช้จ่ายจริง
          </p>
          {items.length === 0 ? (
            <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>— ไม่มีรายการ</p>
          ) : (
            <ExpenseTable items={items} advanceAmount={clear?.advanceAmount ?? 0} />
          )}
        </div>

        {/* Refund / extra summary */}
        <RefundBanner refund={refund} />
      </Section>

      {/* WHT certificate table */}
      {whtItems.length > 0 && (
        <Section title="หนังสือรับรองการหักภาษี ณ ที่จ่าย" icon={<ReceiptText size={15} />}>
          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full border-collapse" style={{ minWidth: 820 }}>
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                  <ThD>#</ThD><ThD>วันที่</ThD><ThD>เลขผู้เสียภาษี</ThD><ThD>ชื่อผู้รับ</ThD>
                  <ThD>ที่อยู่</ThD><ThD right>ค่าใช้จ่าย</ThD><ThD right>WHT</ThD><ThD right>สุทธิ</ThD>
                </tr>
              </thead>
              <tbody>
                {whtItems.map((w, i) => (
                  <tr key={w.id ?? i} className="text-[12px]" style={{ color: "var(--text-primary)" }}>
                    <TdD>{i + 1}</TdD>
                    <TdD>{fmtDateOnly(w.expenseDate)}</TdD>
                    <TdD>{w.taxId ?? "—"}</TdD>
                    <TdD>{w.payeeName ?? "—"}</TdD>
                    <TdD>{w.payeeAddress ?? "—"}</TdD>
                    <TdD right>{money(w.amount)}</TdD>
                    <TdD right>{money(w.whtAmount)}</TdD>
                    <TdD right>{money(w.netAmount)}</TdD>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Refund transfer proof (only when returning money) */}
      {(refund > 0 || clear?.refundTransferDate || refundProofFiles.length > 0) && (
        <Section title="การโอนเงินคืนบริษัท" icon={<Banknote size={15} />}>
          <div className="flex flex-col gap-3">
            <DetailRow
              label="จำนวนเงินที่โอนคืนจริง"
              value={
                clear?.refundTransferAmount != null ? (
                  <span>
                    ฿{clear.refundTransferAmount.toLocaleString()}
                    {Math.abs((clear.refundTransferAmount ?? 0) - refund) > 0.01 && (
                      <span className="text-[11px] ml-2" style={{ color: "var(--text-warning, var(--text-muted))" }}>
                        (ต้องโอนคืน ฿{refund.toLocaleString()})
                      </span>
                    )}
                  </span>
                ) : "—"
              }
            />
            <DetailRow label="วันที่โอนเงินคืน" value={clear?.refundTransferDate ? fmtDateOnly(clear.refundTransferDate) : "—"} />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide m-0 mb-1.5" style={{ color: "var(--text-muted)" }}>
                หลักฐานการโอนคืน ({refundProofFiles.length})
              </p>
              <FileThumbs files={refundProofFiles} onImage={(f) => setLightbox({ src: f.url, alt: f.fileName })} />
            </div>
          </div>
        </Section>
      )}

      {/* Receipts */}
      <Section title={`ใบเสร็จ / ใบกำกับภาษี (${files.length})`} icon={<Paperclip size={15} />}>
        <FileThumbs files={files} onImage={(f) => setLightbox({ src: f.url, alt: f.fileName })} />
      </Section>

      {/* Manager approve confirm dialog */}
      <Dialog open={mgAction === "approve"} onOpenChange={(o) => { if (!o) setMgAction(null); }} title="ยืนยันการอนุมัติ">
        <p className="text-[13px] mb-6" style={{ color: "var(--text-secondary)" }}>
          อนุมัติคำขอเลขที่ <strong style={{ color: "var(--text-heading)" }}>{request.requestNo ?? "ฉบับร่าง"}</strong> ใช่หรือไม่?
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setMgAction(null)} disabled={busy}
            className="text-[13px] font-medium px-4 py-2 rounded-lg"
            style={{ color: "var(--text-secondary)", background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}>ยกเลิก</button>
          <button type="button" onClick={handleManagerAction} disabled={busy}
            className="text-[13px] font-medium px-4 py-2 rounded-lg"
            style={{ background: "var(--bg-info-green)", color: "var(--text-info-green)", border: "1px solid var(--border-info-green)", opacity: busy ? 0.7 : 1 }}>
            {busy ? "กำลังดำเนินการ..." : "ยืนยัน อนุมัติ"}
          </button>
        </div>
      </Dialog>

      {/* Manager return / reject reason dialog */}
      <Dialog open={mgAction === "return" || mgAction === "reject"} onOpenChange={(o) => { if (!o) setMgAction(null); }}
        title={mgAction === "return" ? "ส่งกลับแก้ไข — ระบุเหตุผล" : "ไม่อนุมัติ — ระบุเหตุผล"}>
        <textarea rows={3} className="w-full rounded-lg px-3 py-2 text-[13px] outline-none mb-5"
          style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
          placeholder="ระบุเหตุผล / ความคิดเห็น..." value={mgComment} onChange={(e) => setMgComment(e.target.value)} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setMgAction(null)} disabled={busy}
            className="text-[13px] font-medium px-4 py-2 rounded-lg"
            style={{ color: "var(--text-secondary)", background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}>ยกเลิก</button>
          <button type="button" onClick={handleManagerAction} disabled={busy || !mgComment.trim()}
            className="text-[13px] font-medium px-4 py-2 rounded-lg"
            style={{ background: mgAction === "return" ? "var(--bg-info-yellow)" : "var(--color-danger)",
              color: mgAction === "return" ? "var(--text-info-yellow)" : "#fff", opacity: busy || !mgComment.trim() ? 0.7 : 1 }}>
            {busy ? "กำลังดำเนินการ..." : mgAction === "return" ? "ยืนยัน ส่งกลับแก้ไข" : "ยืนยัน ไม่อนุมัติ"}
          </button>
        </div>
      </Dialog>

      {/* Account/Head revise (return) or reject reason dialog */}
      <Dialog open={accAction !== null} onOpenChange={(o) => { if (!o) setAccAction(null); }}
        title={accAction === "return" ? "ส่งกลับแก้ไข — ระบุเหตุผล" : "ไม่อนุมัติ — ระบุเหตุผล"}>
        <textarea rows={3} className="w-full rounded-lg px-3 py-2 text-[13px] outline-none mb-5"
          style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
          placeholder={accAction === "return" ? "ระบุสิ่งที่ต้องแก้ไข..." : "ระบุเหตุผลที่ไม่อนุมัติ..."}
          value={accComment} onChange={(e) => setAccComment(e.target.value)} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setAccAction(null)} disabled={busy}
            className="text-[13px] font-medium px-4 py-2 rounded-lg"
            style={{ color: "var(--text-secondary)", background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}>ยกเลิก</button>
          <button type="button"
            onClick={() => { if (!accComment.trim()) return toast.error("กรุณาระบุเหตุผล"); act(accAction === "return" ? "return" : "reject", { comment: accComment.trim() }); }}
            disabled={busy || !accComment.trim()}
            className="text-[13px] font-medium px-4 py-2 rounded-lg"
            style={accAction === "return"
              ? { background: "var(--text-info-yellow)", color: "#fff", opacity: busy || !accComment.trim() ? 0.7 : 1 }
              : { background: "var(--color-danger)", color: "#fff", opacity: busy || !accComment.trim() ? 0.7 : 1 }}>
            {busy ? "กำลังดำเนินการ..." : accAction === "return" ? "ยืนยัน ส่งกลับแก้ไข" : "ยืนยัน ไม่อนุมัติ"}
          </button>
        </div>
      </Dialog>

      {/* Cancel confirm dialog */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen} title="ยืนยันการยกเลิกคำขอ">
        <p className="text-[13px] mb-6" style={{ color: "var(--text-secondary)" }}>
          คุณต้องการยกเลิกคำขอเลขที่ <strong style={{ color: "var(--text-heading)" }}>{request.requestNo ?? "ฉบับร่าง"}</strong> ใช่หรือไม่? การดำเนินการนี้ไม่สามารถยกเลิกคืนได้
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setCancelOpen(false)} disabled={busy}
            className="text-[13px] font-medium px-4 py-2 rounded-lg"
            style={{ color: "var(--text-secondary)", background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}>ไม่ใช่</button>
          <button type="button" onClick={() => act("cancel")} disabled={busy}
            className="text-[13px] font-medium px-4 py-2 rounded-lg"
            style={{ background: "var(--color-danger)", color: "#fff", opacity: busy ? 0.7 : 1 }}>
            {busy ? "กำลังยกเลิก..." : "ยืนยัน ยกเลิกคำขอ"}
          </button>
        </div>
      </Dialog>

      <ImageLightbox open={lightbox != null} src={lightbox?.src ?? ""} alt={lightbox?.alt} onClose={() => setLightbox(null)} />
    </div>
  );
}

/* ────────────────────────── sub-components ────────────────────────── */

function ThD({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-2 py-1.5 font-bold ${right ? "text-right" : "text-left"}`}
      style={{ borderBottom: "1px solid var(--border-card)", whiteSpace: "nowrap" }}>{children}</th>
  );
}
function TdD({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <td className={`px-2 py-1.5 ${right ? "text-right tabular-nums" : ""}`}
      style={{ borderBottom: "1px solid var(--border-light)" }}>{children}</td>
  );
}

function ExpenseTable({ items, advanceAmount }: { items: ClearAdvanceItem[]; advanceAmount: number }) {
  let cumNet = 0;
  const totals = { before: 0, vat: 0, total: 0, wht: 0, net: 0 };
  const rows = items.map((it, i) => {
    const before = it.amountBeforeVat ?? 0;
    const vat = it.vatAmount ?? 0;
    const total = it.totalInclVat ?? before + vat;
    const wht = it.whtAmount ?? 0;
    const net = it.netAmount ?? total - wht;
    cumNet = Math.round((cumNet + net) * 100) / 100;
    const balance = Math.round((advanceAmount - cumNet) * 100) / 100;
    totals.before += before; totals.vat += vat; totals.total += total; totals.wht += wht; totals.net += net;
    return { it, before, vat, total, wht, net, balance, i };
  });
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full border-collapse" style={{ minWidth: 980 }}>
        <thead>
          <tr className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            <ThD>#</ThD><ThD>วันที่</ThD><ThD>เลขที่เอกสาร</ThD><ThD>รายการ</ThD>
            <ThD>สาขา</ThD><ThD right>ก่อน VAT</ThD><ThD right>VAT</ThD><ThD right>รวม</ThD>
            <ThD right>WHT</ThD><ThD right>สุทธิ</ThD><ThD right>คงเหลือ</ThD>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ it, before, vat, total, wht, net, balance, i }) => (
            <tr key={it.id ?? i} className="text-[12px]" style={{ color: "var(--text-primary)" }}>
              <TdD>{i + 1}</TdD>
              <TdD>{fmtDateOnly(it.expenseDate)}</TdD>
              <TdD>{it.docNo ?? "—"}</TdD>
              <TdD>
                <span className="block">{it.glAccountNo ?? "—"}</span>
                {(it.glAccountName || it.description) && (
                  <span className="block text-[11px]" style={{ color: "var(--text-muted)" }}>
                    {[it.glAccountName, it.description].filter(Boolean).join(" · ")}
                  </span>
                )}
              </TdD>
              <TdD>{it.branchCode ?? "—"}</TdD>
              <TdD right>{money(before)}</TdD>
              <TdD right>{money(vat)}</TdD>
              <TdD right>{money(total)}</TdD>
              <TdD right>{money(wht)}</TdD>
              <TdD right>{money(net)}</TdD>
              <TdD right>
                <span style={{ color: balance < 0 ? "var(--color-danger)" : undefined }}>{money(balance)}</span>
              </TdD>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="text-[12px] font-bold" style={{ color: "var(--text-heading)", background: "var(--bg-card-alt)" }}>
            <td colSpan={5} className="px-2 py-2 text-[11px]" style={{ color: "var(--text-secondary)" }}>รวมทั้งหมด</td>
            <td className="px-2 py-2 text-right tabular-nums">{money(totals.before)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{money(totals.vat)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{money(totals.total)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{money(totals.wht)}</td>
            <td className="px-2 py-2 text-right tabular-nums" style={{ color: "var(--nav-active-text)" }}>{money(totals.net)}</td>
            <td className="px-2 py-2" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function FileThumbs({ files, onImage }: { files: AccFileMeta[]; onImage: (f: AccFileMeta) => void }) {
  if (files.length === 0) {
    return <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>— ไม่มีเอกสารแนบ</p>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {files.map((f) => isImage(f) ? (
        <button key={f.id} type="button" onClick={() => onImage(f)}
          className="w-20 h-20 rounded-lg overflow-hidden cursor-pointer border-none p-0" style={{ background: "var(--bg-card-alt)" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={f.url} alt={f.fileName} className="w-full h-full object-cover" />
        </button>
      ) : (
        <a key={f.id} href={f.url} target="_blank" rel="noreferrer"
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] no-underline"
          style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)", color: "var(--text-primary)" }}>
          <ImageIcon size={13} style={{ color: "var(--nav-active-text)" }} />
          <span className="truncate max-w-[180px]">{f.fileName}</span>
        </a>
      ))}
    </div>
  );
}

function AmountTile({ label, value, plain }: { label: string; value: string; plain?: boolean }) {
  return (
    <div className="rounded-xl px-3.5 py-3 min-w-0" style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}>
      <p className="text-[10px] font-semibold uppercase tracking-wide m-0 mb-1.5" style={{ color: "var(--text-muted)" }}>{label}</p>
      <p className={`m-0 break-words ${plain ? "text-[13px] font-semibold" : "text-[15px] font-bold tabular-nums"}`}
        style={{ color: "var(--text-heading)" }}>{value}</p>
    </div>
  );
}

function RefundBanner({ refund }: { refund: number }) {
  const rounded = Math.round(refund * 100) / 100;
  let tone: { bg: string; border: string; text: string };
  let label: string;
  if (rounded > 0) {
    tone = { bg: "var(--bg-info-green)", border: "var(--border-info-green)", text: "var(--text-info-green)" };
    label = `ต้องโอนคืนบริษัท ฿${money(rounded)}`;
  } else if (rounded < 0) {
    tone = { bg: "var(--bg-info-yellow)", border: "var(--border-info-yellow)", text: "var(--text-info-yellow)" };
    label = `บริษัทต้องจ่ายเพิ่ม ฿${money(Math.abs(rounded))}`;
  } else {
    tone = { bg: "var(--bg-card-alt)", border: "var(--border-card)", text: "var(--text-secondary)" };
    label = "พอดี — ไม่มียอดคืน/จ่ายเพิ่ม";
  }
  return (
    <div className="mt-4 rounded-xl px-4 py-3 flex items-center justify-between gap-3"
      style={{ background: tone.bg, border: `1px solid ${tone.border}` }}>
      <span className="text-[13px] font-bold" style={{ color: tone.text }}>{label}</span>
    </div>
  );
}
