"use client";

import { SidePanel, SidePanelClose } from "@/components/ui/SidePanel";
import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  Ban,
  BedDouble,
  Briefcase,
  Calendar,
  Car,
  CheckCircle,
  Clock,
  FileText,
  Mail,
  MapPin,
  Paperclip,
  Phone,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
  Ticket,
  Truck,
  User,
  Wallet,
  XCircle,
  Loader2,
} from "lucide-react";
import { Dialog } from "@/components/ui";
import { Avatar } from "@/components/ui/Avatar";
import { ImageLightbox } from "@/features/accounting/components/ImageLightbox";
import { fmtYmdDisplay } from "@/features/accounting/lib/format-travel-dates";
import { useBookingAccess } from "@/features/travel-booking/hooks/useBookingAccess";
import { useErpSandboxDevHost } from "@/features/accounting/hooks/useErpSandboxDevHost";
import { useTravelBookingOptionIcons } from "@/features/travel-booking/hooks/useOptionIcons";
import { InfoStrip, typeInfo } from "@/features/travel-booking/components/BookingInfoStrip";
import { canActManagerStep } from "@/lib/acc/manager-auth";
import { payoutMonthLabel } from "@/lib/acc/travel-booking/payout-months";
import { UatDataBanner } from "@/components/UatDataBanner";
import { AdminBookingPanel } from "./AdminBookingPanel";
import { TravelBookingStatusBadge } from "./TravelBookingStatusBadge";
import { REQUIRED_BOOKING_RULES } from "@/features/travel-booking/lib/booking-requirements";
import { DIRECTION_LABEL_TH } from "@/features/travel-booking/constants";
import { fmtBaht } from "./shared";
import type {
  BookingType,
  TravelBookingApproval,
  TravelBookingFileMeta,
  TravelBookingRequest,
  TravelDirection,
} from "@/features/travel-booking/types";

/** Icon per booking type — mirrors the Admin fill-in panel so both views read the same. */
const BOOKING_TYPE_ICON: Record<BookingType, React.ReactNode> = {
  room: <BedDouble size={14} />,
  ticket: <Ticket size={14} />,
  rent: <Car size={14} />,
};

/* ── format helpers ── */

function fmtDateTime(raw: string | null | undefined): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

/* ── small layout primitives (mirrors AP-1 RequestDetail.tsx's look — its own Section/DetailRow/
   GridField are not exported, so kept local here rather than forking that whole file) ── */

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
      style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-sm)" }}
    >
      <div
        className="flex items-center gap-2.5 px-5 py-3"
        style={{ borderBottom: "1px solid var(--border-card)", background: "var(--bg-card-header)" }}
      >
        {icon && (
          <span
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
          >
            {icon}
          </span>
        )}
        <h2 className="text-[13px] font-bold flex-1 min-w-0" style={{ color: "var(--text-heading)" }}>
          {title}
        </h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  valueStyle,
}: {
  label: string;
  value: React.ReactNode;
  valueStyle?: React.CSSProperties;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-2">
      <span className="text-[11px] font-medium shrink-0 sm:w-36" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
      <span className="text-[13px]" style={{ color: "var(--text-primary)", ...valueStyle }}>
        {value ?? "—"}
      </span>
    </div>
  );
}

/**
 * Small-caps field caption inside a booking card — matches the Admin fill-in panel's labels.
 * `inline` keeps it on the same line as its value (used for the booking number / price).
 */
function FieldLabel({ children, inline = false }: { children: React.ReactNode; inline?: boolean }) {
  const cls = inline
    ? "text-[11px] font-semibold uppercase tracking-wide m-0 shrink-0 whitespace-nowrap"
    : "text-[11px] font-semibold uppercase tracking-wide m-0 mb-1.5";
  return (
    <p className={cls} style={{ color: "var(--text-muted)" }}>
      {children}
    </p>
  );
}

function GridField({ label, value, bold = true }: { label: string; value: React.ReactNode; bold?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        {label}
      </span>
      <span
        className={`text-[13px] ${bold ? "font-bold" : ""} truncate`}
        style={{ color: bold ? "var(--text-primary)" : "var(--text-secondary)" }}
      >
        {value ?? "—"}
      </span>
    </div>
  );
}

function FlagChip({ label }: { label: string }) {
  return (
    <span
      className="inline-flex text-[10.5px] font-semibold px-2 py-0.5 rounded-full w-fit"
      style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
    >
      {label}
    </span>
  );
}

function FileThumb({
  file,
  onImageClick,
}: {
  file: TravelBookingFileMeta;
  onImageClick: (src: string, alt: string) => void;
}) {
  const url = `/api/request/travel-booking/files/${file.id}`;
  const isImage = file.contentType.startsWith("image/");
  if (isImage) {
    return (
      <button
        type="button"
        onClick={() => onImageClick(url, file.fileName)}
        title={file.fileName}
        className="w-20 h-20 shrink-0 rounded-xl overflow-hidden cursor-pointer border-none p-0"
        style={{ background: "var(--bg-card-alt)" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={file.fileName} className="w-full h-full object-cover" />
      </button>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={file.fileName}
      className="w-20 h-20 shrink-0 rounded-xl overflow-hidden flex flex-col items-center justify-center gap-1 border no-underline"
      style={{ borderColor: "var(--border-card)", background: "var(--bg-card-alt)" }}
    >
      <FileText size={20} style={{ color: "var(--text-muted)" }} />
      <span className="text-[9px] px-1 truncate w-full text-center" style={{ color: "var(--text-muted)" }}>
        {file.fileName}
      </span>
    </a>
  );
}

/* ── transport direction card ── */

/**
 * Per-direction detail (เวลา + จุดขึ้นรถ) only — the vehicle itself is the same for ขาไป/ขากลับ
 * so it is shown once at the section level, not repeated here.
 */
function DirectionCard({ direction, request }: { direction: TravelDirection; request: TravelBookingRequest }) {
  const needsDepartureLocations =
    direction === "go" ? request.goNeedsDepartureLocations : request.returnNeedsDepartureLocations;
  const needsDepartTime = direction === "go" ? request.goNeedsDepartTime : request.returnNeedsDepartTime;
  const time = direction === "go" ? request.departTime : request.returnTime;
  const locations = request.departureLocations.filter((d) => d.direction === direction);

  return (
    <div
      className="rounded-xl px-4 py-3 flex flex-col gap-2"
      style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--nav-active-text)" }}>
          {DIRECTION_LABEL_TH[direction]}
        </span>
        {needsDepartTime && time && (
          <span
            className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
            style={{ background: "var(--bg-card)", color: "var(--text-secondary)" }}
          >
            {time} น.
          </span>
        )}
      </div>
      {needsDepartureLocations && locations.length > 0 ? (
        <div className="flex flex-col gap-1">
          {locations.map((loc) => (
            <div key={loc.id} className="flex items-center gap-1.5 text-[12px]" style={{ color: "var(--text-secondary)" }}>
              <MapPin size={12} className="shrink-0" style={{ color: "var(--text-faint)" }} />
              {loc.name}
            </div>
          ))}
        </div>
      ) : (
        !needsDepartTime && <span className="text-[12px]" style={{ color: "var(--text-faint)" }}>—</span>
      )}
    </div>
  );
}

/* ── approval timeline bits ── */

function ApprovalStatusBadge({ status }: { status: TravelBookingApproval["status"] }) {
  const configs: Record<
    TravelBookingApproval["status"],
    { label: string; icon: React.ReactNode; bg: string; text: string; border: string }
  > = {
    Pending: { label: "รออนุมัติ", icon: <Clock size={12} />, bg: "var(--bg-info-yellow)", text: "var(--text-info-yellow)", border: "var(--border-info-yellow)" },
    Approved: { label: "อนุมัติแล้ว", icon: <CheckCircle size={12} />, bg: "var(--bg-info-green)", text: "var(--text-info-green)", border: "var(--border-info-green)" },
    Rejected: { label: "ไม่อนุมัติ", icon: <XCircle size={12} />, bg: "rgba(220,38,38,0.08)", text: "var(--color-danger)", border: "rgba(220,38,38,0.2)" },
    Returned: { label: "ส่งกลับแก้ไข", icon: <RotateCcw size={12} />, bg: "var(--bg-info-yellow)", text: "var(--text-info-yellow)", border: "var(--border-info-yellow)" },
  };
  const cfg = configs[status];
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
      style={{ background: cfg.bg, color: cfg.text, border: `1px solid ${cfg.border}` }}
    >
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

function approvalDotStyle(status: TravelBookingApproval["status"]): React.CSSProperties {
  if (status === "Approved") return { background: "var(--bg-info-green)", color: "var(--text-info-green)", border: "1px solid var(--border-info-green)" };
  if (status === "Rejected") return { background: "rgba(220,38,38,0.08)", color: "var(--color-danger)", border: "1px solid rgba(220,38,38,0.2)" };
  if (status === "Returned") return { background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" };
  return { background: "var(--bg-badge)", color: "var(--text-muted)", border: "1px solid var(--border-card)" };
}

function approvalIcon(status: TravelBookingApproval["status"]) {
  if (status === "Approved") return <CheckCircle size={14} />;
  if (status === "Rejected") return <XCircle size={14} />;
  if (status === "Returned") return <RotateCcw size={13} />;
  return <Clock size={13} />;
}

function approvalActorLabel(approval: TravelBookingApproval): string | null {
  if (approval.status === "Pending") {
    const assignName = approval.assignedToHrName?.trim();
    const assignStaff = approval.assignedTo;
    if (assignName && assignStaff != null) return `${assignName} · StaffId ${assignStaff}`;
    if (assignName) return assignName;
    if (assignStaff != null) return `StaffId ${assignStaff}`;
    return approval.assignedEmail;
  }
  const name = approval.actionedByHrName?.trim();
  const email = approval.actionedByHrEmail ?? approval.assignedEmail;
  const staffId = approval.actionedByStaffId;
  if (name && staffId != null) return `${name} · StaffId ${staffId}`;
  if (name && email) return `${name} (${email})`;
  if (name) return name;
  if (staffId != null && email) return `StaffId ${staffId} (${email})`;
  if (staffId != null) return `StaffId ${staffId}`;
  return email ?? null;
}

function approvalActorPrefix(status: TravelBookingApproval["status"]): string {
  if (status === "Approved") return "อนุมัติโดย";
  if (status === "Rejected") return "ไม่อนุมัติโดย";
  if (status === "Returned") return "ส่งกลับโดย";
  return "รอดำเนินการโดย";
}

/* ── Main component ── */

interface TravelBookingDetailProps {
  request: TravelBookingRequest;
  onChanged?: () => void;
  /**
   * Requester-facing view (My Request drawer): never render the Admin fill-in panel, even for
   * account-area viewers — Admin works from the queue → detail page. Booking info is shown
   * read-only (booking no. + attachments only, no price), with a "waiting for Admin"
   * placeholder for anything not filled in yet.
   */
  readOnlyBooking?: boolean;
  /**
   * Whether the read-only booking summary prints each row's ราคา (ก่อน VAT).
   *
   * Defaults to `!readOnlyBooking`, which is the rule this used to be: price is
   * Admin/accounting information and the requester's drawer must not show it.
   * It is a separate prop because the accounting sign-off queue needs both
   * halves at once — the fill-in panel frozen *and* the prices visible, since
   * that is the payout being approved.
   */
  showBookingPrice?: boolean;
  /** Set on the copy rendered inside the per-diem panel — see `siblingId`. */
  nested?: boolean;
}

export function TravelBookingDetail({
  request,
  onChanged,
  readOnlyBooking = false,
  showBookingPrice,
  nested = false,
}: TravelBookingDetailProps) {
  /**
   * The sibling trip opened from the per-diem note, in a panel over this one.
   *
   * A panel rather than a route: this component is mounted three ways — the
   * detail page, the admin queue's SidePanel and My Requests' — and navigating
   * would throw away whichever of those the reader is in. One panel here works
   * the same in all three.
   *
   * `nested` is the recursion stop. A continuation chain is short, but the note
   * inside the sibling would otherwise open a third panel over the second; at
   * depth one the number renders as plain text instead.
   */
  const [siblingId, setSiblingId] = useState<number | null>(null);
  const [sibling, setSibling] = useState<TravelBookingRequest | null>(null);
  const [siblingLoading, setSiblingLoading] = useState(false);

  useEffect(() => {
    if (siblingId == null) return;
    let cancelled = false;
    setSiblingLoading(true);
    setSibling(null);
    fetch(`/api/request/travel-booking/requests/${siblingId}`)
      .then((r) => r.json())
      .then((j: { ok?: boolean; data?: TravelBookingRequest }) => {
        if (!cancelled && j?.ok && j.data) setSibling(j.data);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSiblingLoading(false); });
    return () => { cancelled = true; };
  }, [siblingId]);

  const { canAccount, loading: accessLoading, error: accessError } = useBookingAccess();

  /* ── Viewer identity — mirrors AP-1 RequestDetail.tsx's `/api/me/employee` lookup ── */
  const [viewerStaffId, setViewerStaffId] = useState<number | null>(null);
  const [viewerEmail, setViewerEmail] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/me/employee")
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: { email?: string | null; employee?: { staffId?: number | null } | null } }) => {
        if (cancelled) return;
        setViewerEmail(json.ok ? (json.data?.email ?? null) : null);
        const sid = json.ok ? json.data?.employee?.staffId : null;
        setViewerStaffId(sid != null ? sid : null);
      })
      .catch(() => {
        if (!cancelled) {
          setViewerStaffId(null);
          setViewerEmail(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isOwner = viewerStaffId != null && request.staffId != null && viewerStaffId === request.staffId;

  /* AP-17's frontend-facing type has no `managerStaffId` field (unlike AP-1's AccRequest) —
     derive the assigned manager from the MANAGER approval row's `assignedTo` instead. */
  const managerApproval = useMemo(
    () => request.approvals.find((a) => a.stepCode === "MANAGER") ?? null,
    [request.approvals],
  );
  /* Same gate as AP-1 (`canActManagerStep`): assigned StaffId / assigned email, plus the
     localhost:3081 dev bypass that lets any logged-in user action the step while testing.
     The two are kept apart because only the second one is worth announcing — for a UAT
     request the assigned manager IS the requester's configured UAT manager, written into
     the approval at submit, so matching it is acting on your own authority. */
  const isDevHost = useErpSandboxDevHost();
  const isStepPending =
    request.status === "Submitted" && managerApproval?.status === "Pending";
  const isAssignedManagerViewer =
    isStepPending &&
    canActManagerStep(
      viewerStaffId,
      viewerEmail,
      managerApproval?.assignedTo ?? null,
      managerApproval,
      null,
      false,
    );
  const canActManager =
    isAssignedManagerViewer ||
    (isStepPending &&
      canActManagerStep(
        viewerStaffId,
        viewerEmail,
        managerApproval?.assignedTo ?? null,
        managerApproval,
        null,
        isDevHost,
      ));

  const canCancel =
    isOwner &&
    request.status === "Submitted" &&
    request.submittedAt != null &&
    Date.now() - new Date(request.submittedAt).getTime() <= 24 * 3600 * 1000;

  /* ── Manager approve / reject / return ── */
  const [mgAction, setMgAction] = useState<"approve" | "return" | "reject" | null>(null);
  const [mgComment, setMgComment] = useState("");
  const [mgLoading, setMgLoading] = useState(false);

  async function handleManagerAction() {
    if (!mgAction || request.id == null) return;
    if ((mgAction === "return" || mgAction === "reject") && !mgComment.trim()) {
      toast.error("กรุณาระบุเหตุผล");
      return;
    }
    setMgLoading(true);
    try {
      const res = await fetch(`/api/request/travel-booking/requests/${request.id}/${mgAction}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: mgAction === "approve" ? undefined : JSON.stringify({ comment: mgComment.trim() }),
      });
      const json: { ok: boolean; error?: string } = await res.json();
      if (json.ok) {
        toast.success(
          mgAction === "approve" ? "อนุมัติแล้ว" : mgAction === "return" ? "ส่งกลับแก้ไขแล้ว" : "ไม่อนุมัติแล้ว",
        );
        setMgAction(null);
        setMgComment("");
        onChanged?.();
      } else {
        toast.error(json.error ?? "ดำเนินการไม่สำเร็จ");
      }
    } catch {
      toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
    } finally {
      setMgLoading(false);
    }
  }

  /* ── Requester self-cancel ── */
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  async function handleCancel() {
    if (request.id == null) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/request/travel-booking/requests/${request.id}/cancel`, { method: "POST" });
      const json: { ok: boolean; error?: string } = await res.json();
      if (json.ok) {
        toast.success("ยกเลิกคำขอเรียบร้อยแล้ว");
        setCancelDialogOpen(false);
        onChanged?.();
      } else {
        toast.error(json.error ?? "ยกเลิกไม่สำเร็จ");
      }
    } catch {
      toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
    } finally {
      setCancelling(false);
    }
  }

  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  // Option emojis (เหตุผล/ที่พัก/ยานพาหนะ/รถเช่า) live in settings, not on the request — resolve by id.
  const icons = useTravelBookingOptionIcons();

  /** Prefix an option's emoji (if any) before its text. */
  const withIcon = (icon: string | null | undefined, text: string) =>
    icon ? (
      <span className="inline-flex items-center gap-1.5">
        <span aria-hidden className="text-[15px] leading-none">{icon}</span>
        <span>{text}</span>
      </span>
    ) : (
      text
    );

  const hasRentBlock = request.goNeedsVehicleRent || request.returnNeedsVehicleRent || request.needsRentBooking;

  /* ── Booking cards — Admin fills them in; everyone else only ever sees them read-only ── */
  const bookingRules = useMemo(() => REQUIRED_BOOKING_RULES.filter((r) => r.needed(request)), [request]);
  /* `ManagerApproved` alone is not the Admin stage — it is also accounting's
     sign-off, where every control this panel renders (add/edit/delete a booking
     row, upload/delete an attachment, เสร็จสิ้น) is refused by the server with a
     Thai error. `CurrentStepCode` is what separates the two stages. */
  const atAdminStep = request.status === "ManagerApproved" && request.currentStepCode === "ADMIN";
  const atAccountStep = request.status === "ManagerApproved" && request.currentStepCode === "ACCOUNT";
  const showAdminPanel = !readOnlyBooking && atAdminStep && canAccount && request.id != null;
  const showPrice = showBookingPrice ?? !readOnlyBooking;
  /* A rejected /access fetch leaves `canAccount` false, which is indistinguishable
     from a genuine refusal. The panel still fails closed, but the banner below is
     then addressed to someone we never established is not an operator, so it gets
     a variant that adds the caveat instead. Only the operator-facing view is
     affected: in `readOnlyBooking` the viewer is the requester, who is waiting for
     Admin whatever the roster says. */
  const bookingAreaUnknown = !readOnlyBooking && atAdminStep && Boolean(accessError);
  const showBookingSummary =
    !showAdminPanel &&
    (readOnlyBooking || !accessLoading) &&
    bookingRules.length > 0 &&
    (request.status === "ManagerApproved" || request.status === "Completed");

  return (
    <div>
      <UatDataBanner requestId={request.id} />

      {/* ── Cancel bar ── */}
      {canCancel && (
        <div
          className="rounded-2xl p-4 mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-sm)" }}
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <Ban size={16} style={{ color: "var(--color-danger)", marginTop: 2 }} className="shrink-0" />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold" style={{ color: "var(--text-heading)" }}>
                ยกเลิกคำขอ
              </p>
              <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                ยกเลิกเองได้ภายใน 24 ชม. หลังส่งคำขอ และก่อนผู้จัดการอนุมัติ
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCancelDialogOpen(true)}
            className="shrink-0 inline-flex items-center gap-2 text-[13px] font-semibold px-4 py-2 rounded-lg cursor-pointer transition-colors"
            style={{ color: "var(--color-danger)", border: "1px solid rgba(220,38,38,0.3)", background: "rgba(220,38,38,0.06)" }}
          >
            <Ban size={14} /> ยกเลิกคำขอ
          </button>
        </div>
      )}

      {/* ── Admin booking stage, permission check unavailable ── */}
      {bookingAreaUnknown && (
        <div
          className="rounded-2xl p-4 mb-4 flex items-start gap-2.5"
          style={{ background: "var(--bg-info-yellow)", border: "1px solid var(--border-info-yellow)" }}
        >
          <AlertCircle size={16} style={{ color: "var(--text-info-yellow)", marginTop: 2 }} className="shrink-0" />
          <p className="text-[13px] m-0" style={{ color: "var(--text-info-yellow)" }}>
            รอ Admin กรอกข้อมูลการจอง — ตรวจสอบสิทธิ์ของคุณไม่สำเร็จ หากคุณเป็นผู้ดูแลการจอง กรุณาลองโหลดหน้านี้ใหม่อีกครั้ง
          </p>
        </div>
      )}

      {/* ── Admin booking stage, not-account-area banner ── */}
      {atAdminStep && !accessLoading && !canAccount && !bookingAreaUnknown && (
        <div
          className="rounded-2xl p-4 mb-4 flex items-start gap-2.5"
          style={{ background: "var(--bg-info-yellow)", border: "1px solid var(--border-info-yellow)" }}
        >
          <AlertCircle size={16} style={{ color: "var(--text-info-yellow)", marginTop: 2 }} className="shrink-0" />
          <p className="text-[13px] m-0" style={{ color: "var(--text-info-yellow)" }}>
            รอ Admin กรอกข้อมูลการจอง — ทีมบัญชีจะดำเนินการจองตามรายการที่ร้องขอ แล้วส่งต่อให้บัญชีตรวจสอบ
          </p>
        </div>
      )}

      {/* ── Accounting stage — Admin has finished; the two banners above are no
             longer true of this request, and neither is anything about เสร็จสิ้น
             being Admin's to press. ── */}
      {atAccountStep && (
        <div
          className="rounded-2xl p-4 mb-4 flex items-start gap-2.5"
          style={{ background: "var(--bg-info-yellow)", border: "1px solid var(--border-info-yellow)" }}
        >
          <AlertCircle size={16} style={{ color: "var(--text-info-yellow)", marginTop: 2 }} className="shrink-0" />
          <p className="text-[13px] m-0" style={{ color: "var(--text-info-yellow)" }}>
            Admin จองให้เรียบร้อยแล้ว — รอบัญชีตรวจสอบและอนุมัติปิดงาน
          </p>
        </div>
      )}

      {/* ── Approval timeline (+ manager action bar) ── */}
      <Section title="ขั้นตอนการอนุมัติ" icon={<CheckCircle size={15} />}>
        {canActManager && (
          <div className="mb-4 pb-4 flex flex-col gap-3" style={{ borderBottom: "1px solid var(--border-light)" }}>
            {/* Only when the bypass is what grants this — see the gate above. */}
            {isDevHost && !isAssignedManagerViewer ? (
              <p className="text-[10px] m-0" style={{ color: "var(--text-faint)" }}>
                โหมดทดสอบ (localhost:3081) — ผู้ใช้ที่ล็อกอินกดอนุมัติแทนผู้จัดการได้
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setMgAction("approve");
                  setMgComment("");
                }}
                className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer"
                style={{ background: "var(--bg-info-green)", color: "var(--text-info-green)", border: "1px solid var(--border-info-green)" }}
              >
                <ThumbsUp size={14} /> อนุมัติ
              </button>
              <button
                type="button"
                onClick={() => {
                  setMgAction("return");
                  setMgComment("");
                }}
                className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer"
                style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}
              >
                <RotateCcw size={14} /> ส่งกลับแก้ไข
              </button>
              <button
                type="button"
                onClick={() => {
                  setMgAction("reject");
                  setMgComment("");
                }}
                className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer"
                style={{ color: "var(--color-danger)", border: "1px solid rgba(220,38,38,0.25)", background: "rgba(220,38,38,0.06)" }}
              >
                <ThumbsDown size={14} /> ไม่อนุมัติ
              </button>
            </div>
          </div>
        )}
        <div className="flex flex-col gap-0">
          {request.approvals.length === 0 ? (
            <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
              ยังไม่มีขั้นตอนอนุมัติ (ฉบับร่าง)
            </p>
          ) : (
            request.approvals
              .slice()
              .sort((a, b) => a.stepOrder - b.stepOrder)
              .map((approval, idx, arr) => {
                const isLast = idx === arr.length - 1;
                return (
                  <div key={approval.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold"
                        style={approvalDotStyle(approval.status)}
                      >
                        {approvalIcon(approval.status)}
                      </div>
                      {!isLast && (
                        <div className="w-px flex-1 my-1" style={{ background: "var(--border-light)", minHeight: 16 }} />
                      )}
                    </div>
                    <div className="flex-1 pb-4">
                      <div className="mb-1">
                        <ApprovalStatusBadge status={approval.status} />
                      </div>
                      <div className="mb-0.5">
                        <span className="text-[13px] font-medium" style={{ color: "var(--text-heading)" }}>
                          ผู้จัดการ (Manager)
                        </span>
                      </div>
                      {(() => {
                        const actor = approvalActorLabel(approval);
                        if (!actor) return null;
                        return (
                          <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
                            {approvalActorPrefix(approval.status)} {actor}
                          </p>
                        );
                      })()}
                      {approval.comment && (
                        <p
                          className="text-[12px] mt-1 px-2 py-1.5 rounded-lg"
                          style={{ color: "var(--text-secondary)", background: "var(--bg-card-alt)", border: "1px solid var(--border-light)" }}
                        >
                          {approval.comment}
                        </p>
                      )}
                      {approval.actionedAt && (
                        <p className="text-[10px] mt-1" style={{ color: "var(--text-faint)" }}>
                          {fmtDateTime(approval.actionedAt)}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })
          )}
        </div>
      </Section>

      {/* ── Admin fill-in (account-area viewers only, while ManagerApproved) ── */}
      {showAdminPanel && <AdminBookingPanel request={request} onChanged={() => onChanged?.()} />}

      {/* ── Read-only booking details — requester view, or once the request is completed ── */}
      {showBookingSummary && (
        <Section title="รายละเอียดการจอง" icon={<Paperclip size={15} />}>
          <div className="flex flex-col gap-3">
            {bookingRules.map((rule) => {
              /* One booking type can hold several rows (e.g. two hotels) — Admin adds them per trip. */
              const rows = request.bookingDetails.filter(
                (d) => d.bookingType === rule.type && (!!d.bookingNo?.trim() || d.files.length > 0),
              );
              return (
                <div
                  key={rule.type}
                  className="rounded-xl overflow-hidden"
                  style={{ border: "1px solid var(--border-card)" }}
                >
                  <div
                    className="flex items-center justify-between gap-2 px-4 py-2.5"
                    style={{ background: "var(--bg-card-header)", borderBottom: "1px solid var(--border-light)" }}
                  >
                    <span className="flex items-center gap-2 text-[12.5px] font-bold" style={{ color: "var(--text-heading)" }}>
                      <span style={{ color: "var(--nav-active-text)" }}>{BOOKING_TYPE_ICON[rule.type]}</span>
                      {rule.label}
                    </span>
                    {rows.length > 1 && (
                      <span className="text-[11px] font-medium shrink-0" style={{ color: "var(--text-muted)" }}>
                        {rows.length} รายการ
                      </span>
                    )}
                  </div>

                  <div className="px-4 py-3.5 flex flex-col gap-3.5">
                    {/* What was requested — same context strip the Admin fill-in panel shows. */}
                    <InfoStrip groups={typeInfo(request, rule.type, icons)} />

                    {rows.length === 0 ? (
                      <p className="text-[12.5px] m-0 inline-flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
                        <Clock size={13} className="shrink-0" /> กำลังรอ Admin กรอกข้อมูลการจอง
                      </p>
                    ) : (
                      /* One bordered sub-card per booking row — same shape as the Admin
                         fill-in card, minus the inputs. */
                      rows.map((d, idx) => (
                        <div
                          key={d.id}
                          className="rounded-xl px-4 py-3.5 flex flex-col gap-3"
                          style={{ border: "1px solid var(--border-light)" }}
                        >
                          {rows.length > 1 && (
                            <p className="text-[11.5px] font-bold m-0" style={{ color: "var(--text-secondary)" }}>
                              รายการที่ {idx + 1}
                            </p>
                          )}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                            {/* Caption and value share one line — the caption never wraps. */}
                            <div className="flex items-baseline gap-2 min-w-0">
                              <FieldLabel inline>เลขที่การจอง / Booking No.</FieldLabel>
                              <p className="text-[13px] m-0 break-all min-w-0" style={{ color: "var(--text-primary)" }}>
                                {d.bookingNo?.trim() || (
                                  <span style={{ color: "var(--text-faint)" }}>ยังไม่ระบุ</span>
                                )}
                              </p>
                            </div>
                            {/* The figures are Admin/accounting information — not shown in the
                                requester view, but shown wherever the viewer is approving the
                                payout. Each is rendered only when it holds something: null
                                means nobody recorded it (every row written before migration
                                123 reads null for the last three), and a row of "0.00 บาท"
                                would claim a booking carried no VAT rather than that its VAT
                                is unknown. */}
                            {showPrice && d.priceExVat != null && (
                              <div className="flex items-baseline gap-2 min-w-0">
                                <FieldLabel inline>ราคา (ก่อน VAT)</FieldLabel>
                                <p className="text-[13px] m-0 tabular-nums" style={{ color: "var(--color-action)" }}>
                                  {fmtBaht(d.priceExVat)} บาท
                                </p>
                              </div>
                            )}
                            {showPrice && d.vatAmount != null && (
                              <div className="flex items-baseline gap-2 min-w-0">
                                <FieldLabel inline>ภาษี (VAT)</FieldLabel>
                                <p className="text-[13px] m-0 tabular-nums" style={{ color: "var(--text-primary)" }}>
                                  {fmtBaht(d.vatAmount)} บาท
                                </p>
                              </div>
                            )}
                            {showPrice && d.discountAmount != null && (
                              <div className="flex items-baseline gap-2 min-w-0">
                                <FieldLabel inline>ส่วนลด</FieldLabel>
                                <p className="text-[13px] m-0 tabular-nums" style={{ color: "var(--text-primary)" }}>
                                  {fmtBaht(d.discountAmount)} บาท
                                </p>
                              </div>
                            )}
                            {showPrice && d.totalAmount != null && (
                              <div className="flex items-baseline gap-2 min-w-0">
                                <FieldLabel inline>ราคารวม</FieldLabel>
                                <p className="text-[13px] m-0 tabular-nums font-bold" style={{ color: "var(--color-action)" }}>
                                  {fmtBaht(d.totalAmount)} บาท
                                </p>
                              </div>
                            )}
                          </div>
                          {d.files.length > 0 && (
                            <div className="pt-2" style={{ borderTop: "1px solid var(--border-light)" }}>
                              <FieldLabel>ไฟล์แนบ (ใบยืนยันการจอง) — {d.files.length} ไฟล์</FieldLabel>
                              <div className="flex flex-wrap gap-2">
                                {d.files.map((f) => (
                                  <FileThumb key={f.id} file={f} onImageClick={(src, alt) => setLightbox({ src, alt })} />
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* ── Summary ── */}
      <Section title="รายละเอียดคำขอ" icon={<FileText size={15} />}>
        <div className="flex flex-col gap-2.5">
          <DetailRow label="เลขที่คำขอ" value={request.requestNo ?? "ฉบับร่าง"} />
          <DetailRow label="สถานะ" value={<TravelBookingStatusBadge status={request.status} />} />
          {request.submittedAt && <DetailRow label="วันที่ส่ง" value={fmtDateTime(request.submittedAt)} />}
          {request.paymentDate && (
            <DetailRow
              label="กำหนดจ่าย"
              value={`${payoutMonthLabel(request.paymentDate.slice(0, 7)) ?? request.paymentDate} (ภายในวันที่ ${fmtYmdDisplay(request.paymentDate)})`}
              valueStyle={{ color: "var(--text-info-green)" }}
            />
          )}
        </div>
      </Section>

      {/* ── Requester + manager (side by side, like the form) ── */}
      <Section title="ผู้ขอ" icon={<User size={15} />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          {/* requester */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="shrink-0 rounded-2xl overflow-hidden" style={{ boxShadow: "0 0 0 2px var(--nav-active-bg)" }}>
              <Avatar name={request.requesterFullName || "?"} size={48} photo={request.requesterPhotoUrl ?? undefined} color="var(--nav-active-text)" />
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
              <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap text-[12px]" style={{ color: "var(--text-secondary)" }}>
                <span className="inline-flex items-center gap-1"><Phone size={11} /> {request.phone ?? "-"}</span>
                <span className="inline-flex items-center gap-1"><Wallet size={11} /> ฿{request.allowanceSnapshot != null ? fmtBaht(request.allowanceSnapshot) : "-"}/วัน</span>
              </div>
              {request.requesterEmail && (
                <span className="inline-flex items-center gap-1 text-[12px] truncate" style={{ color: "var(--text-secondary)" }}>
                  <Mail size={11} className="shrink-0" /> <span className="truncate">{request.requesterEmail}</span>
                </span>
              )}
            </div>
          </div>

          {/* manager (from the MANAGER approval step) */}
          <div className="flex items-center gap-3 min-w-0 border-t md:border-t-0 md:border-l border-[var(--border-light)] pt-4 md:pt-0 md:pl-6">
            {managerApproval && (managerApproval.assignedToHrName || managerApproval.assignedTo != null) ? (
              <>
                <div className="shrink-0 rounded-2xl overflow-hidden" style={{ boxShadow: "0 0 0 2px var(--nav-active-bg)" }}>
                  <Avatar name={managerApproval.assignedToHrName || "?"} size={48} photo={managerApproval.assignedToHrPhotoUrl ?? undefined} color="var(--nav-active-text)" />
                </div>
                <div className="min-w-0 flex flex-col gap-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>หัวหน้างาน (ผู้จัดการ)</span>
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="text-[14px] font-bold truncate" style={{ color: "var(--text-primary)" }}>{managerApproval.assignedToHrName || "-"}</span>
                    {managerApproval.assignedTo != null && <span className="text-[11px] shrink-0" style={{ color: "var(--text-muted)" }}>#{managerApproval.assignedTo}</span>}
                  </div>
                  {(managerApproval.assignedToHrEmail || managerApproval.assignedEmail) && (
                    <span className="inline-flex items-center gap-1 text-[12px] truncate" style={{ color: "var(--text-secondary)" }}>
                      <Mail size={11} className="shrink-0" /> <span className="truncate">{managerApproval.assignedToHrEmail || managerApproval.assignedEmail}</span>
                    </span>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>หัวหน้างาน (ผู้จัดการ)</span>
                <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>—</span>
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* ── Trip (same grouping/order as the form) ── */}
      <Section title="รายละเอียดการเดินทาง" icon={<Briefcase size={15} />}>
        <div className="flex flex-col gap-3">
          <DetailRow
            label="เหตุผล"
            value={withIcon(
              request.reasonId != null ? icons.reason[request.reasonId] : null,
              `${request.reasonName ?? "—"}${request.reasonCustomText ? ` — ${request.reasonCustomText}` : ""}`,
            )}
          />
          <DetailRow label="รายละเอียดงาน" value={<span className="whitespace-pre-wrap">{request.workDetail}</span>} />
          <DetailRow
            label="สถานที่ปฏิบัติงาน"
            value={
              request.workLocations.length > 0 ? (
                <div className="flex flex-col gap-1">
                  {request.workLocations.map((w) => (
                    <span key={w.id} className="flex items-center gap-1.5">
                      <MapPin size={12} style={{ color: "var(--text-faint)" }} />
                      {w.name}
                    </span>
                  ))}
                </div>
              ) : (
                "—"
              )
            }
          />
          <DetailRow label="จังหวัด" value={request.provinceName} />
        </div>
      </Section>

      {/* ── Dates + accommodation (grouped like the form's "วันเดินทางและที่พัก") ── */}
      <Section title="วันเดินทางและที่พัก" icon={<Calendar size={15} />}>
        <div className="flex flex-col gap-2.5">
          <DetailRow
            label="วันเดินทาง"
            value={
              request.departDate && request.returnDate
                ? `${fmtYmdDisplay(request.departDate)} – ${fmtYmdDisplay(request.returnDate)}`
                : "—"
            }
          />
          {/* Which day went, and where it went to.

              "ต่อเนื่องจากทริปก่อนหน้า (-1 วัน)" was the whole note, and on a
              one-day trip that leaves Per diem reading 0 วัน · 0.00 บาท with
              nothing on the page saying why.

              Two lines rather than one sentence: the fact and the consequence
              read at different speeds, and as a single run of text it wrapped
              mid-clause and had to be read twice. The request number is a link
              — the next thing anybody does with it is go and look. */}
          {request.isContinuation && (
            <DetailRow
              label="หมายเหตุ"
              value={
                <span className="flex flex-col gap-0.5">
                  <span>
                    วันแรก{" "}
                    <strong>{request.departDate ? fmtYmdDisplay(request.departDate) : "—"}</strong>{" "}
                    นับ Per diem ไปแล้วใน{" "}
                    {request.continuationFromRequestId && request.continuationFromRequestNo && !nested ? (
                      <button
                        type="button"
                        onClick={() => setSiblingId(request.continuationFromRequestId)}
                        title="ดูรายละเอียดคำขอนั้น"
                        className="font-bold underline underline-offset-2 cursor-pointer border-none bg-transparent p-0"
                        style={{ color: "var(--nav-active-text)" }}
                      >
                        {request.continuationFromRequestNo}
                      </button>
                    ) : request.continuationFromRequestNo ? (
                      <strong>{request.continuationFromRequestNo}</strong>
                    ) : (
                      <strong>ทริปก่อนหน้า</strong>
                    )}
                  </span>
                  <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    ต่อเนื่องจากทริปก่อนหน้า จึงไม่นับซ้ำที่นี่ (−1 วัน)
                  </span>
                </span>
              }
            />
          )}

          <DetailRow
            label="ที่พักค้างคืน"
            value={withIcon(
              request.accommodationId != null ? icons.accommodation[request.accommodationId] : null,
              `${request.accommodationName ?? "—"}${request.accommodationCustomText ? ` — ${request.accommodationCustomText}` : ""}`,
            )}
          />
          {request.needsRoomBooking && <FlagChip label="ต้องจองห้องพัก" />}
        </div>
      </Section>

      {/* ── Transport (one vehicle for both directions → shown once; only เวลา/จุดขึ้น differ) ── */}
      <Section title="ยานพาหนะ" icon={<Car size={15} />}>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {request.goVehicleId != null && icons.vehicle[request.goVehicleId] ? (
              <span aria-hidden className="text-[15px] leading-none shrink-0">{icons.vehicle[request.goVehicleId]}</span>
            ) : (
              <Car size={14} className="shrink-0" style={{ color: "var(--text-muted)" }} />
            )}
            <span className="text-[13px] font-semibold break-words" style={{ color: "var(--text-heading)" }}>
              {request.goVehicleName ?? "—"}
              {request.goVehicleCustomText ? ` — ${request.goVehicleCustomText}` : ""}
            </span>
          </div>
          {(request.goNeedsTicketBooking || request.goNeedsVehicleRent || request.goNeedsDepartureLocations) && (
            <div className="flex flex-wrap gap-1.5">
              {request.goNeedsTicketBooking && <FlagChip label="ต้องจองตั๋ว" />}
              {request.goNeedsVehicleRent && <FlagChip label="ต้องเช่ารถ" />}
              {request.goNeedsDepartureLocations && <FlagChip label="กำหนดจุดขึ้น" />}
            </div>
          )}
          {(request.goNeedsDepartTime || request.goNeedsDepartureLocations ||
            request.returnNeedsDepartTime || request.returnNeedsDepartureLocations) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <DirectionCard direction="go" request={request} />
              <DirectionCard direction="return" request={request} />
            </div>
          )}
          {hasRentBlock && (
            <div
              className="rounded-xl px-4 py-3 flex flex-col gap-2"
              style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
            >
              <p className="text-[12px] font-bold m-0 flex items-center gap-1.5" style={{ color: "var(--text-heading)" }}>
                <Truck size={13} /> เช่ายานพาหนะ
              </p>
              <DetailRow
                label="ยานพาหนะที่เช่า"
                value={withIcon(
                  request.rentVehicleId != null ? icons.rent[request.rentVehicleId] : null,
                  `${request.rentVehicleName ?? "—"}${request.rentVehicleCustomText ? ` — ${request.rentVehicleCustomText}` : ""}`,
                )}
              />
              {request.rentStartDate && request.rentEndDate && (
                <DetailRow label="วันที่เช่า" value={`${fmtYmdDisplay(request.rentStartDate)} – ${fmtYmdDisplay(request.rentEndDate)}`} />
              )}
              {request.needsRentBooking && <FlagChip label="ต้องจองรถเช่า" />}
            </div>
          )}
        </div>
      </Section>

      {/* ── Attachments (บัตรประชาชน) — before the summary, like the form ── */}
      <Section title="เอกสารแนบ" icon={<Paperclip size={15} />}>
        <label className="text-[11px] font-semibold uppercase tracking-wide block mb-1.5" style={{ color: "var(--text-muted)" }}>
          บัตรประชาชน
        </label>
        {request.idCardFiles.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {request.idCardFiles.map((f) => (
              <FileThumb key={f.id} file={f} onImageClick={(src, alt) => setLightbox({ src, alt })} />
            ))}
          </div>
        ) : (
          <p className="text-[13px] m-0" style={{ color: "var(--text-muted)" }}>—</p>
        )}
      </Section>

      {/* ── Notes + summary (grouped like the form's "หมายเหตุและสรุป") ── */}
      <Section title="หมายเหตุและสรุป" icon={<FileText size={15} />}>
        <div className="flex flex-col gap-3">
          {request.notes?.trim() && (
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide block mb-1" style={{ color: "var(--text-muted)" }}>
                หมายเหตุ
              </label>
              <p className="text-[13px] whitespace-pre-wrap m-0" style={{ color: "var(--text-primary)" }}>
                {request.notes}
              </p>
            </div>
          )}
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-card)" }}>
            <div className="px-4 py-3 flex items-center justify-between gap-3" style={{ background: "var(--nav-active-bg)" }}>
              <span className="text-[13px] font-bold flex items-center gap-2" style={{ color: "var(--text-heading)" }}>
                <Wallet size={15} /> Per diem ({request.perDiemDays} วัน)
              </span>
              <span className="text-[16px] font-bold tabular-nums" style={{ color: "var(--color-action)" }}>
                {fmtBaht(request.perDiemTotal)} บาท
              </span>
            </div>
          </div>
        </div>
      </Section>

      {/* ── Manager approve confirm dialog ── */}
      <Dialog
        open={mgAction === "approve"}
        onOpenChange={(open) => {
          if (!open) setMgAction(null);
        }}
        title="ยืนยันการอนุมัติ"
        uniformSurface
      >
        <p className="text-[13px] mb-6" style={{ color: "var(--text-secondary)" }}>
          อนุมัติคำขอเลขที่ <strong style={{ color: "var(--text-heading)" }}>{request.requestNo ?? "ฉบับร่าง"}</strong> ใช่หรือไม่?
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setMgAction(null)}
            disabled={mgLoading}
            className="text-[13px] font-medium px-4 py-2 rounded-lg"
            style={{ color: "var(--text-secondary)", background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={handleManagerAction}
            disabled={mgLoading}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium px-4 py-2 rounded-lg"
            style={{ background: "var(--bg-info-green)", color: "var(--text-info-green)", border: "1px solid var(--border-info-green)", opacity: mgLoading ? 0.7 : 1 }}
          >
            {mgLoading ? "กำลังดำเนินการ..." : "ยืนยัน อนุมัติ"}
          </button>
        </div>
      </Dialog>

      {/* ── Manager return / reject reason dialog ── */}
      <Dialog
        open={mgAction === "return" || mgAction === "reject"}
        onOpenChange={(open) => {
          if (!open) setMgAction(null);
        }}
        title={mgAction === "return" ? "ส่งกลับแก้ไข — ระบุเหตุผล" : "ไม่อนุมัติ — ระบุเหตุผล"}
        uniformSurface
      >
        <div className="flex flex-col gap-3 mb-5">
          <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
            คำขอเลขที่ <strong style={{ color: "var(--text-heading)" }}>{request.requestNo ?? "ฉบับร่าง"}</strong>
          </p>
          <textarea
            rows={3}
            className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
            style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
            placeholder="ระบุเหตุผล / ความคิดเห็น..."
            value={mgComment}
            onChange={(e) => setMgComment(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setMgAction(null)}
            disabled={mgLoading}
            className="text-[13px] font-medium px-4 py-2 rounded-lg"
            style={{ color: "var(--text-secondary)", background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={handleManagerAction}
            disabled={mgLoading || !mgComment.trim()}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium px-4 py-2 rounded-lg"
            style={{
              background: mgAction === "return" ? "var(--bg-info-yellow)" : "var(--color-danger)",
              color: mgAction === "return" ? "var(--text-info-yellow)" : "#ffffff",
              opacity: mgLoading || !mgComment.trim() ? 0.7 : 1,
            }}
          >
            {mgLoading ? "กำลังดำเนินการ..." : mgAction === "return" ? "ยืนยัน ส่งกลับแก้ไข" : "ยืนยัน ไม่อนุมัติ"}
          </button>
        </div>
      </Dialog>

      {/* ── Cancel confirm dialog ── */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen} title="ยืนยันการยกเลิกคำขอ" uniformSurface>
        <p className="text-[13px] mb-6" style={{ color: "var(--text-secondary)" }}>
          คุณต้องการยกเลิกคำขอเลขที่ <strong style={{ color: "var(--text-heading)" }}>{request.requestNo ?? "ฉบับร่าง"}</strong> ใช่หรือไม่?
          การดำเนินการนี้ไม่สามารถยกเลิกคืนได้
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setCancelDialogOpen(false)}
            disabled={cancelling}
            className="text-[13px] font-medium px-4 py-2 rounded-lg"
            style={{ color: "var(--text-secondary)", background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
          >
            ไม่ใช่
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={cancelling}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium px-4 py-2 rounded-lg"
            style={{ background: "var(--btn-danger-bg)", color: "var(--btn-danger-text)", border: "1px solid var(--btn-danger-border)", opacity: cancelling ? 0.7 : 1 }}
          >
            {cancelling ? "กำลังยกเลิก..." : "ยืนยัน ยกเลิกคำขอ"}
          </button>
        </div>
      </Dialog>

      <ImageLightbox open={lightbox != null} src={lightbox?.src ?? ""} alt={lightbox?.alt} onClose={() => setLightbox(null)} />

      {/* The trip that counted this one's first day — same panel the queue and
          My Requests open a request in, so the number behaves the same
          everywhere. `nested` stops the note inside it opening a third. */}
      <SidePanel
        open={siblingId != null}
        onClose={() => setSiblingId(null)}
        width="min(760px, 100vw)"
        zIndex={60}
      >
        <div
          className="flex items-center justify-between px-4 py-3 shrink-0"
          style={{ borderBottom: "1px solid var(--border-light)" }}
        >
          <div className="min-w-0">
            <p className="text-[14px] font-bold truncate m-0" style={{ color: "var(--text-heading)" }}>
              {sibling?.requestNo ?? request.continuationFromRequestNo ?? "รายละเอียดคำขอ"}
            </p>
            <p className="text-[11px] m-0 mt-0.5" style={{ color: "var(--text-muted)" }}>
              ทริปที่นับ Per diem ของวันแรกไปแล้ว
            </p>
          </div>
          <SidePanelClose onClick={() => setSiblingId(null)} />
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-4 acc-theme">
          {siblingLoading && !sibling ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin" style={{ color: "var(--text-muted)" }} />
            </div>
          ) : sibling ? (
            <TravelBookingDetail request={sibling} readOnlyBooking nested />
          ) : (
            <p className="text-[13px] py-16 text-center" style={{ color: "var(--text-muted)" }}>
              โหลดรายละเอียดไม่สำเร็จ
            </p>
          )}
        </div>
      </SidePanel>
    </div>
  );
}
