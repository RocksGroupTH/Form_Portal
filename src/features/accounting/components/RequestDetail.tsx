"use client";

import React, { useState, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import {
  FileText,
  User,
  Calendar,
  Car,
  ArrowRight,
  MapPin,
  CheckCircle,
  XCircle,
  Clock,
  RotateCcw,
  AlertCircle,
  Ban,
  ThumbsUp,
  ThumbsDown,
  ChevronLeft,
  ChevronRight,
  Mail,
} from "lucide-react";
import { Dialog } from "@/components/ui";
import { Avatar } from "@/components/ui/Avatar";
import {
  AttachmentViewer,
  attachmentKind,
  type AttachmentKind,
  type AttachmentSource,
} from "@/components/ui/AttachmentViewer";
import { FileSpreadsheet, Globe } from "lucide-react";

/**
 * One attachment tile.
 *
 * Three byte-identical copies of this markup sat inline before AP-1's receipt
 * slot was widened to take any file (2026-08-26) — at which point all three
 * needed the same "not an image" fallback, which is what made one copy worth
 * having. A stored PDF's URL in an `<img>` renders as a broken image.
 */
function FileTile({ file, onOpen }: { file: AccFileMeta; onOpen: (f: AccFileMeta) => void }) {
  const kind = attachmentKind(file.fileName, file.contentType);
  return (
    <button
      type="button"
      onClick={() => onOpen(file)}
      title={`${file.fileName} — คลิกเพื่อเปิดดู`}
      className="w-16 h-16 rounded-lg overflow-hidden cursor-pointer border-none p-0 flex items-center justify-center"
      style={{ background: "var(--bg-card)", color: "var(--nav-active-text)" }}
    >
      {kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={file.url} alt={file.fileName} className="w-full h-full object-cover" />
      ) : kind === "excel" ? (
        <FileSpreadsheet size={24} />
      ) : (
        <FileText size={24} />
      )}
    </button>
  );
}
import { UatDataBanner } from "@/components/UatDataBanner";
import { canActManagerStep } from "@/lib/acc/manager-auth";
import { useErpSandboxDevHost } from "@/features/accounting/hooks/useErpSandboxDevHost";
import { useRole } from "@/lib/hooks/useRole";
import { computeTotalAmount, computeTotalDistance, dayCostBreakdown } from "@/lib/acc/calc";
import {
  currencyWord,
  fmtAmountWithCurrency,
  fmtMoneyTh,
  fmtRateAsOfTh,
  fmtRateTh,
  referenceRateNote,
  showsForeignCurrency,
} from "@/lib/acc/currency-display";
import { isOverriddenRate, isBaht } from "@/lib/acc/currency";
import { countryLabel, currencyForCountry, countryFlag } from "@/lib/acc/country-currency";
import { claimRateFacts, multiRateCurrencies } from "@/features/accounting/lib/claim-rates";
import type { ClaimRateFact } from "@/features/accounting/lib/claim-rates";
import {
  formatDayVehicleNames,
  hasRateVehicle,
  normalizeTravelDay,
} from "@/features/accounting/lib/travel-sections";
import type { AccRequest, AccApproval, AccFileMeta, AccVehicle, TravelExpenseDetail, TravelExpenseItem, RouteWaypoint } from "@/features/accounting/types";
import { extraDestinationLabel, ROUTE_FIRST_DEST_LABEL, ROUTE_ORIGIN_LABEL } from "@/features/accounting/lib/route-waypoints";
import { fmtYmdDisplay } from "@/features/accounting/lib/format-travel-dates";

/* Read-only route map (Leaflet touches window → client-only). */
const RouteMapView = dynamic(() => import("./RouteMapView"), {
  ssr: false,
  loading: () => (
    <div
      className="w-full flex items-center justify-center text-[12px]"
      style={{ height: 220, borderRadius: "var(--radius-lg)", background: "var(--bg-card-alt)", color: "var(--text-muted)" }}
    >
      กำลังโหลดแผนที่...
    </div>
  ),
});
import { statusLabelDisplay } from "@/features/accounting/constants";
import type { StepCode } from "@/features/accounting/constants";

/* ── Helpers ── */

/** Format a currency number with thousands separators */
function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Format a date string with local getters (no toISOString) */
function fmtDate(raw: string | null | undefined): string {
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

/** Format a date-only string (no time) */
function fmtDateOnly(raw: string | null | undefined): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

const STEP_LABEL: Record<StepCode, string> = {
  MANAGER: "ผู้จัดการ",
  ACCOUNT: "บัญชี",
};

function approvalActorLabel(approval: AccApproval): string | null {
  if (approval.status === "Pending") {
    if (approval.stepCode === "ACCOUNT" && !approval.assignedEmail && !approval.assignedTo) {
      return "ฝ่ายบัญชี";
    }
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

function approvalActorPrefix(status: AccApproval["status"]): string {
  if (status === "Approved") return "อนุมัติโดย";
  if (status === "Rejected") return "ไม่อนุมัติโดย";
  if (status === "Returned") return "ส่งกลับโดย";
  return "รอดำเนินการโดย";
}

const TRAVEL_ITEM_LABEL: Record<string, string> = {
  fare: "ค่าโดยสาร",
  toll: "ค่าผ่านทาง",
  parking: "ค่าจอดรถ",
};

const DIRECTION_LABEL: Record<string, string> = {
  round: "ไป-กลับ",
  onward: "ขาไป",
  return: "ขากลับ",
};

interface ExpenseLine {
  key: string;
  title: string;
  subtitle?: string;
  /** Distinguishes vehicle blocks — only merge rows within the same section. */
  sectionKey?: string;
  amount: number;
  files: AccFileMeta[];
}

interface ExpenseLineGroup {
  key: string;
  title: string;
  entries: ExpenseLine[];
  totalAmount: number;
}

function groupExpenseLines(lines: ExpenseLine[]): ExpenseLineGroup[] {
  const groups: ExpenseLineGroup[] = [];
  const indexByKey = new Map<string, number>();

  for (const line of lines) {
    const groupKey = line.title;
    const existingIdx = indexByKey.get(groupKey);
    if (existingIdx != null) {
      const group = groups[existingIdx];
      group.entries.push(line);
      group.totalAmount += line.amount;
    } else {
      indexByKey.set(groupKey, groups.length);
      groups.push({
        key: groupKey,
        title: line.title,
        entries: [line],
        totalAmount: line.amount,
      });
    }
  }

  return groups;
}

interface ExpenseVehicleCluster {
  key: string;
  label: string;
  entries: ExpenseLine[];
  totalAmount: number;
}

/** Cluster expense rows by vehicle section — keeps each line item separate. */
function clusterEntriesByVehicle(entries: ExpenseLine[]): ExpenseVehicleCluster[] {
  const byCluster = new Map<string, ExpenseVehicleCluster>();
  const order: string[] = [];

  for (const entry of entries) {
    const vehicleLabel = entry.subtitle?.trim() || "—";
    const clusterKey = `${entry.sectionKey ?? "default"}|${vehicleLabel}`;
    const existing = byCluster.get(clusterKey);
    if (existing) {
      existing.entries.push(entry);
      existing.totalAmount += entry.amount;
    } else {
      order.push(clusterKey);
      byCluster.set(clusterKey, {
        key: clusterKey,
        label: vehicleLabel === "—" ? "—" : (entry.subtitle ?? vehicleLabel),
        entries: [entry],
        totalAmount: entry.amount,
      });
    }
  }

  const clusters: ExpenseVehicleCluster[] = [];
  for (let i = 0; i < order.length; i++) {
    const cluster = byCluster.get(order[i]);
    if (cluster) clusters.push(cluster);
  }
  return clusters;
}

/**
 * A line's subtitle, with the figure the requester actually typed appended when
 * this line was not entered in baht.
 *
 * `amount` is baht on every line written since migration 129, which is what lets
 * the day figure and the request total agree without anybody converting
 * anything. But a claim whose whole point is that somebody spent ringgit would
 * then show only the converted baht, and the approver reading it has no way back
 * to the figure on the receipt in front of them. So the original goes here, with
 * its own code beside it — `fmtAmountWithCurrency` rather than a bare number,
 * because a figure without its currency is exactly the defect this feature
 * exists to remove.
 *
 * A baht line adds nothing at all, so every claim written before 129 and every
 * Thai claim since renders character-for-character what it always did.
 *
 * **A figure with no currency at all is the third case**, and it is named
 * rather than shown as a bare number: the receipt read banks a total whose
 * currency it could not tell, and until somebody states it the line is worth
 * nothing in baht — which is why its `amount` is 0 and the day total is short by
 * it. `validateForSubmit` refuses to submit such a claim, so this only ever
 * appears on a draft or a returned one, which is exactly where it needs to be
 * read. Telling those two apart takes no extra field: a baht line records no
 * `foreignAmount`, so a `foreignAmount` with no `currency` can only be this.
 */
function withLineCurrency(
  vehicleName: string | null | undefined,
  item: TravelExpenseItem,
): string | undefined {
  const base = vehicleName ?? undefined;
  if (item.foreignAmount == null) return base;
  const own = showsForeignCurrency(item.currency)
    ? fmtAmountWithCurrency(item.foreignAmount, item.currency)
    : `${fmtMoneyTh(item.foreignAmount)} — ยังไม่ระบุสกุลเงิน`;
  return base ? `${base} · ${own}` : own;
}

function buildExpenseLines(day: TravelExpenseDetail): ExpenseLine[] {
  const d = normalizeTravelDay(day);
  const lines: ExpenseLine[] = [];

  if (hasRateVehicle(d)) {
    const km = computeTotalDistance(d);
    const rate = Number(d.ratePerKm) || 0;
    const travelAmt = km * rate;
    if (travelAmt > 0) {
      lines.push({
        key: "rate-km",
        title: "ค่าเดินทาง (คิดตามระยะทาง)",
        subtitle: `${d.vehicleName ?? "รถ"} · ${km.toFixed(2)} กม. × ${fmtMoney(rate)} บาท/กม.`,
        amount: travelAmt,
        files: [],
      });
    }
    for (let i = 0; i < d.items.length; i++) {
      const item = d.items[i];
      if (Number(item.amount) <= 0 && !(item.files?.length)) continue;
      lines.push({
        key: `rate-item-${item.id ?? i}`,
        title: TRAVEL_ITEM_LABEL[item.itemType] ?? item.itemType,
        subtitle: withLineCurrency(d.vehicleName, item),
        sectionKey: "rate",
        amount: Number(item.amount) || 0,
        files: item.files ?? [],
      });
    }
  }

  for (let si = 0; si < (d.sections ?? []).length; si++) {
    const sec = d.sections![si];
    for (let i = 0; i < (sec.items ?? []).length; i++) {
      const item = sec.items[i];
      if (Number(item.amount) <= 0 && !(item.files?.length)) continue;
      lines.push({
        key: `sec-${si}-${item.id ?? i}`,
        title: TRAVEL_ITEM_LABEL[item.itemType] ?? item.itemType,
        subtitle: withLineCurrency(sec.vehicleName, item),
        sectionKey: `sec-${sec.id ?? si}`,
        amount: Number(item.amount) || 0,
        files: item.files ?? [],
      });
    }
  }

  if (!hasRateVehicle(d) && (!d.sections || d.sections.length === 0)) {
    for (let i = 0; i < (d.items ?? []).length; i++) {
      const item = d.items[i];
      if (Number(item.amount) <= 0 && !(item.files?.length)) continue;
      lines.push({
        key: `legacy-${item.id ?? i}`,
        title: TRAVEL_ITEM_LABEL[item.itemType] ?? item.itemType,
        subtitle: withLineCurrency(d.vehicleName, item),
        sectionKey: "legacy",
        amount: Number(item.amount) || 0,
        files: item.files ?? [],
      });
    }
  }

  return lines;
}

/* ── Status badge ── */

interface StatusBadgeProps {
  status: AccApproval["status"];
}

function ApprovalStatusBadge({ status }: StatusBadgeProps) {
  const configs: Record<
    AccApproval["status"],
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
      bg: "rgba(220,38,38,0.08)",
      text: "var(--color-danger)",
      border: "rgba(220,38,38,0.2)",
    },
    Returned: {
      label: "ส่งกลับแก้ไข",
      icon: <RotateCcw size={12} />,
      bg: "var(--bg-info-yellow)",
      text: "var(--text-info-yellow)",
      border: "var(--border-info-yellow)",
    },
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

/* ── Request status badge ── */

function RequestStatusBadge({ status }: { status: string }) {
  const label = statusLabelDisplay(status);

  const colorMap: Record<string, { bg: string; text: string; border: string }> = {
    Draft: {
      bg: "var(--bg-badge)",
      text: "var(--text-muted)",
      border: "var(--border-card)",
    },
    Submitted: {
      bg: "var(--bg-info-yellow)",
      text: "var(--text-info-yellow)",
      border: "var(--border-info-yellow)",
    },
    ManagerApproved: {
      bg: "var(--bg-info-yellow)",
      text: "var(--text-info-yellow)",
      border: "var(--border-info-yellow)",
    },
    Approved: {
      bg: "var(--bg-info-green)",
      text: "var(--text-info-green)",
      border: "var(--border-info-green)",
    },
    Rejected: {
      bg: "rgba(220,38,38,0.08)",
      text: "var(--color-danger)",
      border: "rgba(220,38,38,0.2)",
    },
    Returned: {
      bg: "var(--bg-info-yellow)",
      text: "var(--text-info-yellow)",
      border: "var(--border-info-yellow)",
    },
    Cancelled: {
      bg: "var(--bg-badge)",
      text: "var(--text-faint)",
      border: "var(--border-light)",
    },
  };

  const c = colorMap[status] ?? colorMap["Draft"];
  return (
    <span
      className="inline-flex items-center text-[11px] font-medium px-2.5 py-1 rounded-full"
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
    >
      {label}
    </span>
  );
}

/* ── Section wrapper ── */

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
      {(title || icon) && (
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
          <h2 className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>
            {title}
          </h2>
        </div>
      )}
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

/* ── Row helper ── */

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
      <span
        className="text-[11px] font-medium shrink-0 sm:w-36"
        style={{ color: "var(--text-secondary)" }}
      >
        {label}
      </span>
      <span className="text-[13px]" style={{ color: "var(--text-primary)", ...valueStyle }}>
        {value ?? "—"}
      </span>
    </div>
  );
}

/* ── Grid field (matches the form's requester/ manager card cells) ── */

function GridField({
  label, value, bold = true, className = "",
}: { label: string; value: React.ReactNode; bold?: boolean; className?: string }) {
  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
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

/* ── Travel info sub-components ── */

function TravelMetaTile({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl px-3.5 py-3 min-w-0 overflow-hidden ${className}`}
      style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide m-0 mb-1.5" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <div className="text-[13px] font-semibold leading-snug min-w-0 break-words" style={{ color: "var(--text-heading)" }}>
        {children}
      </div>
    </div>
  );
}

function RouteLegCard({
  legLabel,
  origin,
  destination,
  distanceKm,
  originLat,
  originLng,
  destLat,
  destLng,
  waypoints,
}: {
  legLabel: string;
  origin: string;
  destination: string;
  distanceKm: number | null | undefined;
  originLat?: number | null;
  originLng?: number | null;
  destLat?: number | null;
  destLng?: number | null;
  waypoints?: RouteWaypoint[] | null;
}) {
  const hasMap =
    originLat != null && originLng != null && destLat != null && destLng != null;
  const stops = (waypoints ?? []).length > 0;

  // Origin = red pin, destinations = green pin (matches the route picker).
  const stopStyle = (variant: "origin" | "dest") =>
    variant === "origin"
      ? {
          border: "1px solid color-mix(in srgb, var(--color-danger) 30%, var(--border-light))",
          iconBg: "color-mix(in srgb, var(--color-danger) 14%, var(--bg-card))",
          iconColor: "var(--color-danger)",
        }
      : {
          border: "1px solid var(--border-info-green)",
          iconBg: "var(--bg-info-green)",
          iconColor: "var(--text-info-green)",
        };

  const renderStop = (subLabel: string, label: string, variant: "origin" | "dest") => {
    const s = stopStyle(variant);
    return (
      <div
        className="flex items-start gap-2 rounded-lg px-3 py-2.5 min-w-0"
        style={{ background: "var(--bg-card)", border: s.border }}
      >
        <span
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
          style={{ background: s.iconBg, color: s.iconColor }}
        >
          <MapPin size={14} />
        </span>
        <div className="min-w-0">
          <p className="text-[9px] font-bold uppercase tracking-wide m-0 mb-0.5" style={{ color: "var(--text-faint)" }}>
            {subLabel}
          </p>
          <p className="text-[12px] font-medium m-0 leading-snug break-words" style={{ color: "var(--text-primary)" }}>
            {label}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: "1px solid var(--border-card)", background: "var(--bg-card-alt)" }}
    >
      <div
        className="flex items-center justify-between gap-2 px-3.5 py-2"
        style={{ borderBottom: "1px solid var(--border-light)", background: "var(--nav-active-bg)" }}
      >
        <span className="text-[11px] font-bold" style={{ color: "var(--nav-active-text)" }}>
          {legLabel}
        </span>
        {distanceKm != null && (
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-full tabular-nums"
            style={{
              background: "var(--bg-card)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-card)",
            }}
          >
            {distanceKm.toFixed(2)} กม.
          </span>
        )}
      </div>

      <div className="px-3.5 py-3 flex flex-col gap-2.5">
        {stops ? (
          <div className="flex flex-col gap-2">
            {renderStop(ROUTE_ORIGIN_LABEL, origin, "origin")}
            <div className="flex justify-center py-0.5">
              <ArrowRight size={14} className="rotate-90" style={{ color: "var(--text-faint)" }} />
            </div>
            {renderStop(ROUTE_FIRST_DEST_LABEL, destination, "dest")}
            {(waypoints ?? []).map((w, i) => (
              <React.Fragment key={i}>
                <div className="flex justify-center py-0.5">
                  <ArrowRight size={14} className="rotate-90" style={{ color: "var(--text-faint)" }} />
                </div>
                {renderStop(extraDestinationLabel(i), w.label, "dest")}
              </React.Fragment>
            ))}
          </div>
        ) : (
        <div className="flex flex-col sm:flex-row sm:items-stretch gap-2">
          <div
            className="flex-1 flex items-start gap-2 rounded-lg px-3 py-2.5 min-w-0"
            style={{ background: "var(--bg-card)", border: "1px solid color-mix(in srgb, var(--color-danger) 30%, var(--border-light))" }}
          >
            <span
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
              style={{ background: "color-mix(in srgb, var(--color-danger) 14%, var(--bg-card))", color: "var(--color-danger)" }}
            >
              <MapPin size={14} />
            </span>
            <div className="min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-wide m-0 mb-0.5" style={{ color: "var(--text-faint)" }}>
                {ROUTE_ORIGIN_LABEL}
              </p>
              <p className="text-[12px] font-medium m-0 leading-snug break-words" style={{ color: "var(--text-primary)" }}>
                {origin}
              </p>
            </div>
          </div>

          <div className="hidden sm:flex items-center justify-center shrink-0 px-0.5">
            <ArrowRight size={16} style={{ color: "var(--text-faint)" }} />
          </div>

          <div
            className="flex-1 flex items-start gap-2 rounded-lg px-3 py-2.5 min-w-0"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-info-green)",
            }}
          >
            <span
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
              style={{ background: "var(--bg-info-green)", color: "var(--text-info-green)" }}
            >
              <MapPin size={14} />
            </span>
            <div className="min-w-0">
              <p className="text-[9px] font-bold uppercase tracking-wide m-0 mb-0.5" style={{ color: "var(--text-faint)" }}>
                {ROUTE_FIRST_DEST_LABEL}
              </p>
              <p className="text-[12px] font-medium m-0 leading-snug break-words" style={{ color: "var(--text-primary)" }}>
                {destination}
              </p>
            </div>
          </div>
        </div>
        )}

        {hasMap && (
          <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--border-light)" }}>
            <RouteMapView
              origin={{ lat: originLat!, lng: originLng! }}
              dest={{ lat: destLat!, lng: destLng! }}
              waypoints={waypoints}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function VehicleChip({
  name,
  icon,
  subLabel,
}: {
  name: string;
  icon: string | null;
  subLabel?: string | null;
}) {
  return (
    <div
      className="inline-flex items-center gap-2 px-3 py-2 rounded-xl min-w-0"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border-light)" }}
    >
      <span
        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
        style={{ background: "var(--bg-card-alt)" }}
        aria-hidden
      >
        {icon ? (
          <span className="text-[16px] leading-none">{icon}</span>
        ) : (
          <Car size={16} style={{ color: "var(--nav-active-text)" }} />
        )}
      </span>
      <span className="min-w-0">
        <span className="block text-[12px] font-bold break-words leading-snug" style={{ color: "var(--text-heading)" }}>
          {name}
        </span>
        {subLabel && (
          <span className="block text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
            {subLabel}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * What a day's total is made of, under the day's own figure.
 *
 * **`dayCostBreakdown` is the only source**, exactly as it is on the form's
 * pre-submit summary. It is built branch-for-branch alongside
 * `computeTotalAmount` and `calc.test.ts` asserts the parts sum to it, so the
 * list here cannot drift from the figure printed above it. Re-deriving the parts
 * on this page would be a second answer to what a day cost, on the screen an
 * approver reads before deciding to pay — and the first thing anybody would do
 * with two disagreeing figures is trust the wrong one.
 *
 * The parts carry no currency word. They sit directly beneath the day total,
 * which names it, and repeating it on every row is noise — the same shape the
 * form uses.
 */
function DayCostParts({ day }: { day: TravelExpenseDetail }) {
  const parts = dayCostBreakdown(day);
  if (parts.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5 mt-1.5">
      {parts.map((part, pi) => (
        <div key={`${part.label}-${pi}`} className="flex items-baseline gap-2">
          <span className="text-[11px] min-w-0 flex-1" style={{ color: "var(--text-muted)" }}>
            {part.label}
            {part.detail && (
              <span className="ml-1.5" style={{ color: "var(--text-faint)" }}>
                {part.detail}
              </span>
            )}
          </span>
          <span
            className="text-[11px] font-semibold tabular-nums shrink-0"
            style={{ color: "var(--text-secondary)" }}
          >
            {fmtMoney(part.amount)}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The rates this claim was converted at, **as stored** — never as they are today.
 *
 * This is the half of the requirement that a fresh fetch would quietly get
 * wrong. Migration 130 records, per expense line, the rate used and which day's
 * rate it was; re-asking the provider on render would print today's number
 * beside a figure converted weeks ago, and nothing on screen would say the two
 * were different questions. So every number here comes off the claim.
 *
 * **Never captioned as a Bank of Thailand rate.** `BOT_API_CLIENT_ID` is
 * deliberately unprovisioned, so every rate is an ECB mid-market reference
 * figure, which is not what a bank settles at. `referenceRateNote` is the one
 * place that sentence is written — including the `ณ <date>` clause — and it is
 * reused rather than retyped.
 *
 * **A date nobody recorded prints nothing.** Every line written before 130 reads
 * null, and `referenceRateNote` simply omits the clause; a rate with no date is
 * shown as a rate with no date rather than as one dated today.
 *
 * **One row per distinct rate**, because since migration 129 the currency is per
 * line and a claim can honestly hold more than one — a draft saved on one day
 * and submitted on another, or a line accounting has corrected by hand. Each row
 * names the lines it actually governs, so no rate is ever presented as though it
 * priced the whole claim.
 */
function ClaimRateNotes({ facts }: { facts: ClaimRateFact[] }) {
  if (facts.length === 0) return null;
  const repeated = multiRateCurrencies(facts);
  const single = facts.length === 1;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide m-0" style={{ color: "var(--text-muted)" }}>
        อัตราแลกเปลี่ยนที่ใช้คำนวณ
      </p>

      {facts.map((f, i) => (
        <div key={`${f.currency}-${f.rate ?? "none"}-${f.asOf ?? "none"}-${i}`} className="flex flex-col">
          <p className="text-[11.5px] m-0" style={{ color: "var(--text-secondary)" }}>
            {f.rate === null
              ? `${f.currency} — ไม่มีอัตราแลกเปลี่ยนที่บันทึกไว้`
              : referenceRateNote(f.currency, f.rate, f.asOf)}
            {f.rate !== null && isOverriddenRate(f.source) && (
              <span style={{ color: "var(--text-info-yellow)" }}> · แก้โดยฝ่ายบัญชีแล้ว</span>
            )}
          </p>
          {/* Which lines this rate priced. Omitted when the claim has just one
              rate: there is nothing it could be confused with, and listing every
              line under it would only bury the sentence above. */}
          {!single && (
            <p className="text-[10.5px] m-0 mt-0.5" style={{ color: "var(--text-faint)" }}>
              ใช้กับ: {f.lines.join(" · ")}
            </p>
          )}
        </div>
      ))}

      {/* Two currencies on one claim is ordinary and needs no explaining. The
          *same* currency at two rates does — otherwise the second row reads as a
          contradiction rather than as a fact about how the claim was filed. */}
      {repeated.length > 0 && (
        <p className="text-[10.5px] m-0" style={{ color: "var(--text-muted)" }}>
          บางรายการบันทึกอัตราคนละวันกัน ({repeated.join(", ")}) — แต่ละรายการคิดตามอัตราที่กำกับไว้
        </p>
      )}
    </div>
  );
}

function TravelDaySection({
  request,
  day,
  dayIdx,
  totalDays,
  vehicleIcons,
  expenseLines,
  onFileClick,
  showBrand = true,
}: {
  request: AccRequest;
  day: TravelExpenseDetail;
  dayIdx: number;
  totalDays: number;
  vehicleIcons: Record<number, string | null>;
  expenseLines: ExpenseLine[];
  onFileClick: (file: AccFileMeta) => void;
  showBrand?: boolean;
}) {
  const expenseGroups = useMemo(() => groupExpenseLines(expenseLines), [expenseLines]);
  const t = normalizeTravelDay(day);
  const rateVehicle = hasRateVehicle(t);
  const manualSections = t.sections ?? [];

  const showOnward =
    rateVehicle && (t.direction === "onward" || t.direction === "round") && t.onwardOrigin;
  const showReturn =
    rateVehicle && (t.direction === "return" || t.direction === "round") && t.returnOrigin;

  const sectionTitle =
    totalDays > 1
      ? `วันเดินทางที่ ${dayIdx + 1}`
      : "ข้อมูลการเดินทาง";

  /**
   * Whether to name the country the claim was filed against.
   *
   * **Follows the brand, deliberately.** The country is a property of the whole
   * request, so it belongs wherever the brand is shown — which is two places:
   * this tile on a single-day claim, and a chip beside the day selector when
   * there are several. `showBrand` is `travelDays.length === 1`, so gating the
   * tile on it is right; the day bar carries its own copy.
   *
   * It shipped once gated on `showBrand` with no chip, which hid it on exactly
   * the multi-day foreign claim it was added for.
   *
   * Only for a country that does not pay in baht. `resolveClaimCountry` stamps
   * a code on every claim, so an unconditional tile would say "ไทย" on every
   * Thai claim ever filed and tell nobody anything.
   *
   * Shown once per claim rather than once per day: the country is a property of
   * the request, so `dayIdx === 0` keeps a three-day trip from repeating it.
   */
  const showForeignCountry =
    showBrand &&
    !!request.countryCode &&
    !isBaht(currencyForCountry(request.countryCode));

  return (
    <Section title={sectionTitle} icon={<Car size={15} />}>
      <div className="flex flex-col gap-4">
        {showBrand && request.brandCode && (
          <TravelMetaTile label="แบรนด์ที่เบิก">
            <span className="flex items-center gap-2 min-w-0">
              <img
                src={`/brandlogo/${request.brandCode.toLowerCase()}-200.png`}
                alt=""
                className="h-5 w-auto object-contain shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
              <span className="break-words">{request.brandCode}</span>
            </span>
          </TravelMetaTile>
        )}

        {/* The country the claim was filed against.

            Only when it is not Thailand: `resolveClaimCountry` stores a code on
            every claim, so a `TH` tile would appear on every Thai claim ever
            filed and say nothing. What it earns its place for is the foreign
            case, where it is the reason a line could be in another currency at
            all — and where its absence on the detail page left an approver
            looking at converted figures with nothing saying where the trip was.

            A code the country list does not know still renders, as the bare
            code: it is what the claim was filed against, and hiding it would be
            worse than showing something unfamiliar. */}
        {showForeignCountry && (
          <TravelMetaTile label="ประเทศ">
            <span className="flex items-center gap-1.5 min-w-0">
              {/* The flag where there is one; Globe as the fallback for a code
                  the pair-of-letters rule cannot turn into one. */}
              {countryFlag(request.countryCode) ? (
                <span aria-hidden className="text-[15px] leading-none shrink-0">
                  {countryFlag(request.countryCode)}
                </span>
              ) : (
                <Globe size={14} className="shrink-0" style={{ color: "var(--nav-active-text)" }} />
              )}
              <span className="break-words">
                {countryLabel(request.countryCode) ?? request.countryCode}
              </span>
            </span>
          </TravelMetaTile>
        )}

        {/* Date — work detail follows immediately below */}
        <TravelMetaTile label="วันที่เดินทาง">
          <span className="flex items-center gap-1.5 min-w-0">
            <Calendar size={14} className="shrink-0" style={{ color: "var(--nav-active-text)" }} />
            <span className="break-words">{fmtDateOnly(t.travelDate)}</span>
          </span>
        </TravelMetaTile>

        {t.workDetail?.trim() && (
          <div
            className="rounded-xl px-4 py-3"
            style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide m-0 mb-1.5" style={{ color: "var(--text-muted)" }}>
              รายละเอียดงาน
            </p>
            <p className="text-[13px] m-0 leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text-primary)" }}>
              {t.workDetail}
            </p>
          </div>
        )}

        {rateVehicle && t.direction && (
          <TravelMetaTile label="ทิศทาง">
            <span
              className="inline-flex items-center text-[11px] font-bold px-2 py-0.5 rounded-full w-fit max-w-full"
              style={{
                background: "var(--nav-active-bg)",
                color: "var(--nav-active-text)",
                border: "1px solid color-mix(in srgb, var(--nav-active-text) 20%, transparent)",
              }}
            >
              {DIRECTION_LABEL[t.direction] ?? t.direction}
            </span>
          </TravelMetaTile>
        )}

        {/* Vehicles — grouped chips */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide m-0 mb-2" style={{ color: "var(--text-muted)" }}>
            ยานพาหนะ
          </p>
          <div className="flex flex-wrap gap-2">
            {rateVehicle && t.vehicleName && (
              <VehicleChip
                name={t.vehicleName}
                icon={t.vehicleId ? vehicleIcons[t.vehicleId] ?? null : null}
                subLabel={t.ratePerKm != null ? `${fmtMoney(t.ratePerKm)} บาท/กม.` : null}
              />
            )}
            {manualSections.map((sec, si) =>
              sec.vehicleName ? (
                <VehicleChip
                  key={`${sec.vehicleId ?? "sec"}-${si}`}
                  name={sec.vehicleName}
                  icon={sec.vehicleId ? vehicleIcons[sec.vehicleId] ?? null : null}
                  subLabel="กรอกค่าเดินทางเอง"
                />
              ) : null,
            )}
            {!rateVehicle && manualSections.length === 0 && t.vehicleName && (
              <VehicleChip
                name={t.vehicleName}
                icon={t.vehicleId ? vehicleIcons[t.vehicleId] ?? null : null}
                subLabel={t.isManualEntry ? "กรอกค่าเดินทางเอง" : null}
              />
            )}
            {!rateVehicle && manualSections.length === 0 && !t.vehicleName && (
              <span className="text-[13px]" style={{ color: "var(--text-muted)" }}>—</span>
            )}
          </div>
        </div>

        {/* Routes */}
        {(showOnward || showReturn) && (
          <div className="flex flex-col gap-2.5">
            {showOnward && (
              <RouteLegCard
                legLabel="ขาไป"
                origin={t.onwardOrigin!}
                destination={t.onwardDestination ?? "—"}
                distanceKm={t.onwardDistanceKm}
                originLat={t.onwardOriginLat}
                originLng={t.onwardOriginLng}
                destLat={t.onwardDestLat}
                destLng={t.onwardDestLng}
                waypoints={t.onwardWaypoints}
              />
            )}
            {showReturn && (
              <RouteLegCard
                legLabel="ขากลับ"
                origin={t.returnOrigin!}
                destination={t.returnDestination ?? "—"}
                distanceKm={t.returnDistanceKm}
                originLat={t.returnOriginLat}
                originLng={t.returnOriginLng}
                destLat={t.returnDestLat}
                destLng={t.returnDestLng}
                waypoints={t.returnWaypoints}
              />
            )}
          </div>
        )}

        {rateVehicle && t.totalDistanceKm != null && (
          <div
            className="flex items-center justify-between gap-3 rounded-xl px-4 py-3"
            style={{
              background: "color-mix(in srgb, var(--nav-active-text) 8%, var(--bg-card-alt))",
              border: "1px solid color-mix(in srgb, var(--nav-active-text) 18%, var(--border-card))",
            }}
          >
            <span className="text-[12px] font-semibold" style={{ color: "var(--text-secondary)" }}>
              ระยะทางรวม
            </span>
            <span className="text-[15px] font-bold tabular-nums" style={{ color: "var(--nav-active-text)" }}>
              {t.totalDistanceKm.toFixed(2)} <span className="text-[12px] font-semibold">กม.</span>
            </span>
          </div>
        )}

        {/* Expenses — same card */}
        {expenseGroups.length > 0 && (
          <div className="flex flex-col gap-2.5 pt-1" style={{ borderTop: "1px solid var(--border-light)" }}>
            {/* The figures below carry no unit — they never have. On a foreign
                claim that is no longer safe to leave implicit, so the heading
                says which money they are in. A baht claim adds nothing. */}
            <p className="text-[10px] font-semibold uppercase tracking-wide m-0 pt-3" style={{ color: "var(--text-muted)" }}>
              รายการค่าใช้จ่าย
              {showsForeignCurrency(request.currency)
                ? ` (${currencyWord(request.currency)})`
                : ""}
            </p>
            {expenseGroups.map((group) => (
              <div
                key={group.key}
                className="rounded-lg p-3"
                style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[13px] font-semibold block min-w-0" style={{ color: "var(--text-heading)" }}>
                    {group.title}
                  </span>
                  <span className="text-[13px] font-bold tabular-nums shrink-0" style={{ color: "var(--color-action)" }}>
                    {fmtMoney(group.totalAmount)}
                    {group.entries.length > 1 && (
                      <span className="text-[10px] font-semibold block text-right mt-0.5" style={{ color: "var(--text-muted)" }}>
                        รวม {group.entries.length} รายการ
                      </span>
                    )}
                  </span>
                </div>
                {group.entries.length === 1 ? (
                  <>
                    {group.entries[0].subtitle && (
                      <span className="text-[11px] block mt-0.5" style={{ color: "var(--text-muted)" }}>
                        {group.entries[0].subtitle}
                      </span>
                    )}
                    {group.entries[0].files.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2.5">
                        {group.entries[0].files.map((f) => (
                          <FileTile key={f.id} file={f} onOpen={onFileClick} />
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col gap-2 mt-2.5">
                    {clusterEntriesByVehicle(group.entries).map((cluster, ci) => (
                      <div
                        key={cluster.key}
                        style={
                          ci > 0
                            ? { borderTop: "1px solid var(--border-light)", paddingTop: "0.5rem" }
                            : undefined
                        }
                      >
                        {cluster.entries.length === 1 ? (
                          <>
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-[11px] min-w-0" style={{ color: "var(--text-muted)" }}>
                                {cluster.label}
                              </span>
                              <span className="text-[12px] font-bold tabular-nums shrink-0" style={{ color: "var(--color-action)" }}>
                                {fmtMoney(cluster.entries[0].amount)}
                              </span>
                            </div>
                            {cluster.entries[0].files.length > 0 && (
                              <div className="flex flex-wrap gap-2 mt-2">
                                {cluster.entries[0].files.map((f) => (
                                  <FileTile key={f.id} file={f} onOpen={onFileClick} />
                                ))}
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-[11px] font-semibold min-w-0" style={{ color: "var(--text-muted)" }}>
                                {cluster.label}
                              </span>
                              <span className="text-[11px] font-bold tabular-nums shrink-0" style={{ color: "var(--text-secondary)" }}>
                                {fmtMoney(cluster.totalAmount)}
                              </span>
                            </div>
                            <div className="flex flex-col gap-2 mt-1.5 pl-2" style={{ borderLeft: "2px solid var(--border-light)" }}>
                              {cluster.entries.map((entry, li) => (
                                <div key={entry.key}>
                                  <div className="flex items-start justify-between gap-2">
                                    <span className="text-[10px] min-w-0" style={{ color: "var(--text-muted)" }}>
                                      รายการที่ {li + 1}
                                    </span>
                                    <span className="text-[12px] font-bold tabular-nums shrink-0" style={{ color: "var(--color-action)" }}>
                                      {fmtMoney(entry.amount)}
                                    </span>
                                  </div>
                                  {entry.files.length > 0 && (
                                    <div className="flex flex-wrap gap-2 mt-1.5">
                                      {entry.files.map((f) => (
                                        <FileTile key={f.id} file={f} onOpen={onFileClick} />
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}

/* ── Props ── */

interface RequestDetailProps {
  request: AccRequest;
  onChanged?: () => void;
  /** When true, hides the requester self-cancel button/section (use in approver views) */
  hideCancel?: boolean;
  /**
   * Tailwind top-offset class for the sticky day selector. Defaults to `top-0`
   * (correct inside a SidePanel whose scroll container starts below the header).
   * The standalone page passes `top-14 md:top-12` to clear the fixed navbar.
   */
  stickyTopClassName?: string;
}

/* ── Main Component ── */

export function RequestDetail({ request, onChanged, hideCancel = false, stickyTopClassName = "top-0" }: RequestDetailProps) {
  const { role } = useRole();
  const isDevHost = useErpSandboxDevHost();
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  /* ── Manager action state ── */
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
    return () => { cancelled = true; };
  }, []);

  const pendingManagerApproval = useMemo(
    () => request.approvals?.find((a) => a.stepCode === "MANAGER" && a.status === "Pending") ?? null,
    [request.approvals],
  );

  /**
   * Whether the viewer is the manager this request was actually assigned to —
   * no host bypass involved.
   *
   * For a UAT request that means the requester's configured UAT manager: the
   * submit resolves `UatTester.ManagerStaffId` and writes it into
   * `request.managerStaffId`, so the snapshot compared here already *is* the
   * UAT manager. A tester who is their own manager matches it too.
   */
  const isAssignedManagerViewer =
    request.currentStepCode === "MANAGER" &&
    canActManagerStep(
      viewerStaffId,
      viewerEmail,
      request.managerStaffId,
      pendingManagerApproval,
      role,
      false,
    );

  const canActManager =
    isAssignedManagerViewer ||
    (request.currentStepCode === "MANAGER" &&
      canActManagerStep(
        viewerStaffId,
        viewerEmail,
        request.managerStaffId,
        pendingManagerApproval,
        role,
        isDevHost,
      ));

  const [mgAction, setMgAction] = useState<"approve" | "return" | "reject" | null>(null);
  const [mgComment, setMgComment] = useState("");
  const [mgLoading, setMgLoading] = useState(false);

  async function handleManagerAction() {
    if (!mgAction) return;
    if ((mgAction === "return" || mgAction === "reject") && !mgComment.trim()) {
      toast.error("กรุณาระบุเหตุผล");
      return;
    }
    setMgLoading(true);
    try {
      const endpoint =
        mgAction === "approve"
          ? `/api/request/accounting/requests/${request.id}/approve`
          : mgAction === "return"
          ? `/api/request/accounting/requests/${request.id}/return`
          : `/api/request/accounting/requests/${request.id}/reject`;

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body:
          mgAction === "approve"
            ? undefined
            : JSON.stringify({ comment: mgComment.trim() }),
      });
      const json: { ok: boolean; error?: string } = await res.json();
      if (json.ok) {
        const label =
          mgAction === "approve"
            ? "อนุมัติแล้ว"
            : mgAction === "return"
            ? "ส่งกลับแก้ไขแล้ว"
            : "ไม่อนุมัติแล้ว";
        toast.success(label);
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

  const travelDays = request.travelDays?.length
    ? request.travelDays
    : request.travel
      ? [request.travel]
      : [];

  /**
   * What the per-day and per-line figures on this page are denominated in.
   *
   * **Baht on everything written since migration 129**, where the currency moved
   * to the expense line and `AccTravelExpenseItem.Amount` became baht always —
   * so `request.currency` is NULL on those and `currencyWord` answers `บาท`.
   *
   * It is not baht on a claim filed during 125's request-level design: there
   * `AccTravelExpense.TotalAmount` and its items hold the claim's own currency
   * and only `AccRequest.TotalAmount` was converted. Those claims still carry a
   * header `Currency`, and reading it here is what keeps their days from being
   * misread as baht. Nothing on AP-1's write path records one any more.
   */
  const claimCurrencyWord = currencyWord(request.currency);
  const claimIsForeign = showsForeignCurrency(request.currency);
  /**
   * The claim's own total, for the strip above the baht line.
   *
   * `ForeignAmount` is written at submit, so a draft has none yet and the days
   * are the only source. Summing them is exactly what `computeTotalAmount` does
   * per day, in the currency the days are already in — no rate is involved.
   */
  const claimForeignTotal =
    request.foreignAmount ??
    (travelDays.length > 0
      ? travelDays.reduce((s, d) => s + (computeTotalAmount(normalizeTravelDay(d)) || 0), 0)
      : null);

  /**
   * The rates the claim's **lines** were converted at, as stored.
   *
   * This is where a modern claim's provenance lives: since migration 129 the
   * currency is on the expense line, so `request.currency` is NULL and the
   * legacy header strip above renders for nothing. Without this the detail page
   * showed a foreign claim's converted baht with no way to see what it was
   * converted at, or when — which is the gap migration 130 was written to close.
   *
   * A baht claim answers `[]` and adds no markup at all.
   */
  const rateFacts = useMemo(() => claimRateFacts(travelDays), [travelDays]);
  const showsRateStrip = claimIsForeign || rateFacts.length > 0;

  /* Enrich requester + manager (AD photo / name / title) by their emails. */
  type People = {
    requester: { photoUrl: string | null };
    manager: { staffId: number | null; fullName: string | null; position: string | null; email: string | null; photoUrl: string | null } | null;
  };
  const [people, setPeople] = useState<People | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/request/accounting/requests/${request.id}/people`)
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: People }) => {
        if (!cancelled && json.ok && json.data) setPeople(json.data);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [request.id]);

  /* Resolve vehicle emoji/icons from settings (not stored on the request). */
  const [vehicleIcons, setVehicleIcons] = useState<Record<number, string | null>>({});
  useEffect(() => {
    const ids = new Set<number>();
    for (const day of travelDays) {
      const d = normalizeTravelDay(day);
      if (d.vehicleId != null) ids.add(d.vehicleId);
      for (const sec of d.sections ?? []) {
        if (sec.vehicleId != null) ids.add(sec.vehicleId);
      }
    }
    if (ids.size === 0) return;
    let cancelled = false;
    fetch("/api/request/accounting/options/vehicles")
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: AccVehicle[] }) => {
        if (cancelled || !json.ok || !json.data) return;
        const map: Record<number, string | null> = {};
        for (const id of Array.from(ids)) {
          map[id] = json.data.find((v) => v.id === id)?.icon ?? null;
        }
        setVehicleIcons(map);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [travelDays]);

  /* Can cancel: still pending the manager (Submitted) AND within 24h of submittedAt */
  const canCancel =
    request.status === "Submitted" &&
    request.submittedAt != null &&
    Date.now() - new Date(request.submittedAt).getTime() <= 24 * 3600 * 1000;

  async function handleCancel() {
    setCancelling(true);
    try {
      const res = await fetch(`/api/request/accounting/requests/${request.id}/cancel`, {
        method: "POST",
      });
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

  const [viewing, setViewing] = useState<{ source: AttachmentSource; kind: AttachmentKind } | null>(null);

  /* Selected travel day (when multiple) — show one day at a time, like the request form. */
  const [activeDay, setActiveDay] = useState(0);
  const activeDayIdx = Math.min(activeDay, Math.max(0, travelDays.length - 1));
  useEffect(() => { setActiveDay(0); }, [request.id]);

  /* Day selector shadow only while pinned (stuck) — detect via a sentinel above it. */
  const dayBarRef = React.useRef<HTMLDivElement>(null);
  const daySentinelRef = React.useRef<HTMLDivElement>(null);
  const [dayBarStuck, setDayBarStuck] = useState(false);
  useEffect(() => {
    const bar = dayBarRef.current;
    const sentinel = daySentinelRef.current;
    if (!bar || !sentinel) return;
    let scrollParent: HTMLElement | null = bar.parentElement;
    while (scrollParent) {
      const oy = getComputedStyle(scrollParent).overflowY;
      if (oy === "auto" || oy === "scroll") break;
      scrollParent = scrollParent.parentElement;
    }
    const topPx = parseFloat(getComputedStyle(bar).top) || 0;
    const obs = new IntersectionObserver(
      ([entry]) => setDayBarStuck(!entry.isIntersecting),
      { root: scrollParent ?? null, rootMargin: `-${topPx + 1}px 0px 0px 0px`, threshold: 0 },
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [travelDays.length, stickyTopClassName]);

  /* ── Render ── */

  return (
    <div>
      <UatDataBanner requestId={request.id} />

      {/* ── Cancel bar (top) — requester self-cancel + condition ── */}
      {!hideCancel && request.status === "Submitted" && (
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
                {!canCancel && " — เลยกำหนดแล้ว กรุณาติดต่อเจ้าของฟอร์ม/ฝ่ายบัญชี"}
              </p>
            </div>
          </div>
          {canCancel && (
            <button
              type="button"
              onClick={() => setCancelDialogOpen(true)}
              className="shrink-0 inline-flex items-center gap-2 text-[13px] font-semibold px-4 py-2 rounded-lg cursor-pointer transition-colors"
              style={{ color: "var(--color-danger)", border: "1px solid rgba(220,38,38,0.3)", background: "rgba(220,38,38,0.06)" }}
            >
              <Ban size={14} /> ยกเลิกคำขอ
            </button>
          )}
        </div>
      )}

      {/* ── Approval timeline ── */}
      {request.approvals && request.approvals.length > 0 && (
        <Section title="ขั้นตอนการอนุมัติ" icon={<CheckCircle size={15} />}>
          {canActManager && (
            <div
              className="mb-4 pb-4 flex flex-col gap-3"
              style={{ borderBottom: "1px solid var(--border-light)" }}
            >
              {/* Only when the dev bypass is what is granting this, not merely
                  when the page happens to be served from a dev host. Somebody
                  who IS the assigned manager — including a UAT tester who is
                  their own UAT manager — is acting on their own authority, and
                  telling them they are approving "on behalf of the manager"
                  says the wrong thing about a real approval. */}
              {isDevHost && !isAssignedManagerViewer ? (
                <p className="text-[10px] m-0" style={{ color: "var(--text-faint)" }}>
                  โหมดทดสอบ (localhost:3081) — ผู้ใช้ที่ล็อกอินกดอนุมัติแทนผู้จัดการได้
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => { setMgAction("approve"); setMgComment(""); }}
                  className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer"
                  style={{
                    background: "var(--bg-info-green)",
                    color: "var(--text-info-green)",
                    border: "1px solid var(--border-info-green)",
                  }}
                >
                  <ThumbsUp size={14} />
                  อนุมัติ
                </button>
                <button
                  type="button"
                  onClick={() => { setMgAction("return"); setMgComment(""); }}
                  className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer"
                  style={{
                    background: "var(--bg-info-yellow)",
                    color: "var(--text-info-yellow)",
                    border: "1px solid var(--border-info-yellow)",
                  }}
                >
                  <RotateCcw size={14} />
                  ส่งกลับแก้ไข
                </button>
                <button
                  type="button"
                  onClick={() => { setMgAction("reject"); setMgComment(""); }}
                  className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer"
                  style={{
                    color: "var(--color-danger)",
                    border: "1px solid rgba(220,38,38,0.25)",
                    background: "rgba(220,38,38,0.06)",
                  }}
                >
                  <ThumbsDown size={14} />
                  ไม่อนุมัติ
                </button>
              </div>
            </div>
          )}
          <div className="flex flex-col gap-0">
            {request.approvals
              .slice()
              .sort((a, b) => a.stepOrder - b.stepOrder)
              .map((approval, idx, arr) => {
                const isLast = idx === arr.length - 1;
                return (
                  <div key={approval.id} className="flex gap-3">
                    {/* Timeline line + dot */}
                    <div className="flex flex-col items-center">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold"
                        style={
                          approval.status === "Approved"
                            ? { background: "var(--bg-info-green)", color: "var(--text-info-green)", border: "1px solid var(--border-info-green)" }
                            : approval.status === "Rejected"
                            ? { background: "rgba(220,38,38,0.08)", color: "var(--color-danger)", border: "1px solid rgba(220,38,38,0.2)" }
                            : approval.status === "Returned"
                            ? { background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }
                            : { background: "var(--bg-badge)", color: "var(--text-muted)", border: "1px solid var(--border-card)" }
                        }
                      >
                        {approval.status === "Approved" ? (
                          <CheckCircle size={14} />
                        ) : approval.status === "Rejected" ? (
                          <XCircle size={14} />
                        ) : approval.status === "Returned" ? (
                          <RotateCcw size={13} />
                        ) : (
                          <Clock size={13} />
                        )}
                      </div>
                      {!isLast && (
                        <div
                          className="w-px flex-1 my-1"
                          style={{ background: "var(--border-light)", minHeight: 16 }}
                        />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 pb-4">
                      <div className="mb-1">
                        <ApprovalStatusBadge status={approval.status} />
                      </div>
                      <div className="mb-0.5">
                        <span className="text-[13px] font-medium" style={{ color: "var(--text-heading)" }}>
                          {STEP_LABEL[approval.stepCode] ?? approval.stepCode}
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
                          style={{
                            color: "var(--text-secondary)",
                            background: "var(--bg-card-alt)",
                            border: "1px solid var(--border-light)",
                          }}
                        >
                          {approval.comment}
                        </p>
                      )}
                      {approval.actionedAt && (
                        <p className="text-[10px] mt-1" style={{ color: "var(--text-faint)" }}>
                          {fmtDate(approval.actionedAt)}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </Section>
      )}

      {/* ── Summary section ── */}
      <Section title="รายละเอียดคำขอ" icon={<FileText size={15} />}>
        <div className="flex flex-col gap-2.5">
          <DetailRow label="เลขที่คำขอ" value={request.requestNo ?? "ฉบับร่าง"} />
          <DetailRow
            label="สถานะ"
            value={<RequestStatusBadge status={request.status} />}
          />
          {request.submittedAt && (
            <DetailRow label="วันที่ส่ง" value={fmtDate(request.submittedAt)} />
          )}
          {request.paymentDate && (
            <DetailRow
              label="วันที่จ่าย"
              value={fmtDateOnly(request.paymentDate)}
              valueStyle={{ color: "var(--text-info-green)" }}
            />
          )}
        </div>
      </Section>

      {/* ── Requester info (avatar + grid, matching the form) ── */}
      <Section title="ผู้ขอเบิก" icon={<User size={15} />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          {/* requester */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="shrink-0 rounded-2xl overflow-hidden" style={{ boxShadow: "0 0 0 2px var(--nav-active-bg)" }}>
              <Avatar name={request.requesterFullName || "?"} size={48} photo={people?.requester.photoUrl ?? undefined} color="var(--nav-active-text)" />
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

          {/* manager */}
          {request.managerEmail && (
            <div className="flex items-center gap-3 min-w-0 border-t md:border-t-0 md:border-l border-[var(--border-light)] pt-4 md:pt-0 md:pl-6">
              <div className="shrink-0 rounded-2xl overflow-hidden" style={{ boxShadow: "0 0 0 2px var(--nav-active-bg)" }}>
                <Avatar name={people?.manager?.fullName || request.managerEmail} size={48} photo={people?.manager?.photoUrl ?? undefined} color="var(--nav-active-text)" />
              </div>
              <div className="min-w-0 flex flex-col gap-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>หัวหน้างาน (ผู้จัดการ)</span>
                <div className="flex items-baseline gap-2 min-w-0">
                  <span className="text-[14px] font-bold truncate" style={{ color: "var(--text-primary)" }}>{people?.manager?.fullName ?? "—"}</span>
                  {request.managerStaffId != null && <span className="text-[11px] shrink-0" style={{ color: "var(--text-muted)" }}>#{request.managerStaffId}</span>}
                </div>
                {people?.manager?.position && <span className="text-[12px] truncate" style={{ color: "var(--text-muted)" }}>{people.manager.position}</span>}
                <span className="inline-flex items-center gap-1 text-[12px] truncate" style={{ color: "var(--text-secondary)" }}>
                  <Mail size={11} className="shrink-0" /> <span className="truncate">{request.managerEmail}</span>
                </span>
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* ── Travel details ── single day, or day-selector + active day when multiple ── */}
      {travelDays.length > 1 && (
        <div aria-hidden ref={daySentinelRef} className="h-0" />
      )}
      {travelDays.length > 1 && (
        <div
          ref={dayBarRef}
          className={`sticky ${stickyTopClassName} z-20 flex items-center gap-2 mb-3 rounded-2xl p-2 backdrop-blur-md transition-shadow duration-200`}
          style={{
            background: "color-mix(in srgb, var(--bg-card) 88%, transparent)",
            border: "1px solid var(--border-card)",
            boxShadow: dayBarStuck ? "0 10px 20px -12px rgba(0,0,0,0.35)" : "none",
          }}
        >
          {/* Brand — same for every day, kept once next to the day selector */}
          {request.brandCode && (
            <div
              className="shrink-0 flex items-center gap-1.5 h-10 pl-2 pr-2.5 rounded-xl"
              style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
              title={`แบรนด์ที่เบิก: ${request.brandCode}`}
            >
              <img
                src={`/brandlogo/${request.brandCode.toLowerCase()}-200.png`}
                alt=""
                className="h-5 w-auto object-contain shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
              <span className="text-[12px] font-bold" style={{ color: "var(--text-primary)" }}>
                {request.brandCode}
              </span>
            </div>
          )}
          {/* Country — like the brand, one fact about the whole claim, so it sits
              in this bar rather than repeating inside each day's section. Only
              when it does not pay in baht: every claim carries a code, and "ไทย"
              on every Thai claim tells nobody anything. */}
          {request.countryCode && !isBaht(currencyForCountry(request.countryCode)) && (
            <div
              className="shrink-0 flex items-center gap-1.5 h-10 pl-2 pr-2.5 rounded-xl"
              style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
              title={`ประเทศ: ${countryLabel(request.countryCode) ?? request.countryCode}`}
            >
              {/* The flag where there is one; Globe as the fallback for a code
                  the pair-of-letters rule cannot turn into one. */}
              {countryFlag(request.countryCode) ? (
                <span aria-hidden className="text-[15px] leading-none shrink-0">
                  {countryFlag(request.countryCode)}
                </span>
              ) : (
                <Globe size={14} className="shrink-0" style={{ color: "var(--nav-active-text)" }} />
              )}
              <span className="text-[12px] font-bold" style={{ color: "var(--text-primary)" }}>
                {countryLabel(request.countryCode) ?? request.countryCode}
              </span>
            </div>
          )}
          <span className="shrink-0 self-stretch w-px my-1" style={{ background: "var(--border-light)" }} />
          <button
            type="button"
            onClick={() => setActiveDay((i) => Math.max(0, i - 1))}
            disabled={activeDayIdx === 0}
            className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center border-none cursor-pointer disabled:opacity-30 disabled:cursor-default"
            style={{ background: "var(--bg-card-alt)", color: "var(--text-muted)" }}
            aria-label="วันก่อนหน้า"
          >
            <ChevronLeft size={16} />
          </button>
          <div
            className="flex-1 basis-0 w-0 min-w-0 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            role="tablist"
            aria-label="เลือกวันเดินทาง"
          >
            <div className="flex w-max items-center gap-1.5 py-px">
              {travelDays.map((d, i) => {
                const active = i === activeDayIdx;
                const ymd = normalizeTravelDay(d).travelDate;
                return (
                  <button
                    key={d.id ?? i}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveDay(i)}
                    className="flex items-center gap-1.5 h-10 shrink-0 rounded-xl pl-2 pr-3 min-w-[120px] cursor-pointer transition-all text-left"
                    style={{
                      borderWidth: 1.5,
                      borderStyle: "solid",
                      borderColor: active ? "var(--nav-active-text)" : "var(--border-card)",
                      background: active ? "var(--nav-active-bg)" : "var(--bg-card)",
                    }}
                  >
                    <span
                      className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold"
                      style={
                        active
                          ? { background: "var(--nav-active-text)", color: "#fff" }
                          : { background: "var(--bg-card-alt)", color: "var(--text-muted)" }
                      }
                    >
                      {i + 1}
                    </span>
                    <span
                      className="flex-1 min-w-0 text-[12px] font-semibold truncate leading-none"
                      style={{ color: active ? "var(--nav-active-text)" : "var(--text-primary)" }}
                    >
                      {ymd ? fmtYmdDisplay(ymd) : `วัน ${i + 1}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setActiveDay((i) => Math.min(travelDays.length - 1, i + 1))}
            disabled={activeDayIdx === travelDays.length - 1}
            className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center border-none cursor-pointer disabled:opacity-30 disabled:cursor-default"
            style={{ background: "var(--bg-card-alt)", color: "var(--text-muted)" }}
            aria-label="วันถัดไป"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      {travelDays[activeDayIdx] && (
        <TravelDaySection
          key={travelDays[activeDayIdx].id ?? activeDayIdx}
          request={request}
          day={travelDays[activeDayIdx]}
          dayIdx={activeDayIdx}
          totalDays={travelDays.length}
          vehicleIcons={vehicleIcons}
          expenseLines={buildExpenseLines(travelDays[activeDayIdx])}
          onFileClick={(f) =>
            setViewing({
              source: { name: f.fileName, url: f.url },
              kind: attachmentKind(f.fileName, f.contentType),
            })
          }
          showBrand={travelDays.length === 1}
        />
      )}

      {travelDays.length > 0 && (
        <div
          className="rounded-2xl overflow-hidden mb-4"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-sm)" }}
        >
          {travelDays.length > 1 && (
            <>
              <div
                className="px-5 py-3"
                style={{ borderBottom: "1px solid var(--border-card)", background: "var(--bg-card-header)" }}
              >
                <p className="text-[11px] font-semibold uppercase tracking-wide m-0" style={{ color: "var(--text-muted)" }}>
                  รายละเอียดแต่ละวัน
                </p>
              </div>
              <div className="px-5 py-4 flex flex-col gap-3">
                {travelDays.map((day, i) => {
                  const d = normalizeTravelDay(day);
                  return (
                    <div
                      key={day.id ?? i}
                      style={{
                        borderTop: i > 0 ? "1px solid var(--border-light)" : undefined,
                        paddingTop: i > 0 ? 12 : 0,
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] font-semibold m-0" style={{ color: "var(--text-primary)" }}>
                            {d.travelDate ? fmtDateOnly(d.travelDate) : `วัน ${i + 1}`}
                          </p>
                          {formatDayVehicleNames(d) && (
                            <p className="text-[11px] m-0 mt-0.5" style={{ color: "var(--text-muted)" }}>
                              {formatDayVehicleNames(d)}
                            </p>
                          )}
                        </div>
                        {/* The day's own figure, in the claim's own currency —
                            `AccTravelExpense.TotalAmount` is never converted, only
                            the request header is. This said `บาท` unconditionally,
                            so a ringgit day read as baht and the days did not sum
                            to the total below. `currencyWord` answers `บาท` for
                            every baht claim, so nothing about one moved. */}
                        <span className="text-[13px] font-bold tabular-nums shrink-0" style={{ color: "var(--color-action)" }}>
                          {fmtMoney(computeTotalAmount(d))} {claimCurrencyWord}
                        </span>
                      </div>
                      {/* The same itemisation the form shows before the claim is
                          sent, so the requester recognises what they submitted
                          and the approver reads the figure's parts rather than
                          only its total. */}
                      <DayCostParts day={d} />
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {/* Only a foreign claim renders this strip. It exists because the line
              below it is baht while every figure above it is not, and without it
              the two look like the same number gone wrong.

              A **baht claim renders none of it** — neither half — which is the
              promise the whole currency feature is held to and the one most
              easily broken by a later edit. `showsRateStrip` is the single
              predicate, so it stays checkable rather than hoped for. */}
          {showsRateStrip && (
            <div
              className="px-5 py-3 flex flex-col gap-2.5"
              style={{
                borderTop: "1px solid var(--border-card)",
                background: "var(--bg-card-alt)",
              }}
            >
              {/* The legacy half: a claim filed during migration 125's
                  request-level design, where the whole request carried one
                  currency. `request.rateAsOf` is passed because it exists and
                  was being thrown away here — this was the only
                  `referenceRateNote` call in the application still omitting the
                  date, so this screen alone showed a rate with no day against
                  it. */}
              {claimIsForeign && (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[12px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                      ยอดรวมตามสกุลเงินที่เบิก
                    </span>
                    <span className="text-[14px] font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
                      {fmtAmountWithCurrency(claimForeignTotal, request.currency)}
                    </span>
                  </div>
                  <p className="text-[11.5px] m-0" style={{ color: "var(--text-muted)" }}>
                    {request.exchangeRate != null
                      ? referenceRateNote(request.currency, request.exchangeRate, request.rateAsOf)
                      : "ยังไม่มีอัตราแลกเปลี่ยนที่บันทึกไว้"}
                  </p>
                </div>
              )}

              {/* The modern half: one row per rate the claim's lines were
                  actually converted at, each with the day it was that rate. */}
              <ClaimRateNotes facts={rateFacts} />
            </div>
          )}
          <div
            className="px-5 py-4 flex items-center justify-between gap-3"
            style={{
              borderTop: travelDays.length > 1 || showsRateStrip ? "1px solid var(--border-card)" : undefined,
              background: travelDays.length > 1 || showsRateStrip ? "var(--nav-active-bg)" : "var(--bg-card)",
            }}
          >
            <span className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>
              ค่าเดินทางรวม{travelDays.length > 1 ? ` (${travelDays.length} วัน)` : ""}
              {claimIsForeign ? " (เงินบาท)" : ""}
            </span>
            <span className="text-[18px] font-bold tabular-nums" style={{ color: "var(--color-action)" }}>
              {fmtMoney(request.totalAmount)} บาท
            </span>
          </div>
        </div>
      )}

      {/* Manager approve confirm dialog */}
      <Dialog
        open={mgAction === "approve"}
        onOpenChange={(open) => { if (!open) setMgAction(null); }}
        title="ยืนยันการอนุมัติ"
        uniformSurface
      >
        <p className="text-[13px] mb-6" style={{ color: "var(--text-secondary)" }}>
          อนุมัติคำขอเลขที่{" "}
          <strong style={{ color: "var(--text-heading)" }}>
            {request.requestNo ?? "ฉบับร่าง"}
          </strong>{" "}
          ใช่หรือไม่?
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setMgAction(null)}
            disabled={mgLoading}
            className="text-[13px] font-medium px-4 py-2 rounded-lg"
            style={{
              color: "var(--text-secondary)",
              background: "var(--bg-card-alt)",
              border: "1px solid var(--border-card)",
            }}
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={handleManagerAction}
            disabled={mgLoading}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium px-4 py-2 rounded-lg"
            style={{
              background: "var(--bg-info-green)",
              color: "var(--text-info-green)",
              border: "1px solid var(--border-info-green)",
              opacity: mgLoading ? 0.7 : 1,
            }}
          >
            {mgLoading ? "กำลังดำเนินการ..." : "ยืนยัน อนุมัติ"}
          </button>
        </div>
      </Dialog>

      {/* Manager return / reject reason dialog */}
      <Dialog
        open={mgAction === "return" || mgAction === "reject"}
        onOpenChange={(open) => { if (!open) setMgAction(null); }}
        title={mgAction === "return" ? "ส่งกลับแก้ไข — ระบุเหตุผล" : "ไม่อนุมัติ — ระบุเหตุผล"}
        uniformSurface
      >
        <div className="flex flex-col gap-3 mb-5">
          <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
            คำขอเลขที่{" "}
            <strong style={{ color: "var(--text-heading)" }}>
              {request.requestNo ?? "ฉบับร่าง"}
            </strong>
          </p>
          <textarea
            rows={3}
            className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
            style={{
              background: "var(--bg-input)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-input)",
            }}
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
            style={{
              color: "var(--text-secondary)",
              background: "var(--bg-card-alt)",
              border: "1px solid var(--border-card)",
            }}
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
            {mgLoading
              ? "กำลังดำเนินการ..."
              : mgAction === "return"
              ? "ยืนยัน ส่งกลับแก้ไข"
              : "ยืนยัน ไม่อนุมัติ"}
          </button>
        </div>
      </Dialog>

      {/* ── Cancel confirm dialog (triggered from the top cancel bar) ── */}
      {!hideCancel && (
        <>
          <Dialog
            open={cancelDialogOpen}
            onOpenChange={setCancelDialogOpen}
            title="ยืนยันการยกเลิกคำขอ"
            uniformSurface
          >
            <p className="text-[13px] mb-6" style={{ color: "var(--text-secondary)" }}>
              คุณต้องการยกเลิกคำขอเลขที่{" "}
              <strong style={{ color: "var(--text-heading)" }}>
                {request.requestNo ?? "ฉบับร่าง"}
              </strong>{" "}
              ใช่หรือไม่? การดำเนินการนี้ไม่สามารถยกเลิกคืนได้
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCancelDialogOpen(false)}
                disabled={cancelling}
                className="text-[13px] font-medium px-4 py-2 rounded-lg"
                style={{
                  color: "var(--text-secondary)",
                  background: "var(--bg-card-alt)",
                  border: "1px solid var(--border-card)",
                }}
              >
                ไม่ใช่
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={cancelling}
                className="inline-flex items-center gap-1.5 text-[13px] font-medium px-4 py-2 rounded-lg"
                style={{
                  background: "var(--btn-danger-bg)", color: "var(--btn-danger-text)", border: "1px solid var(--btn-danger-border)",
                  opacity: cancelling ? 0.7 : 1,
                }}
              >
                {cancelling ? "กำลังยกเลิก..." : "ยืนยัน ยกเลิกคำขอ"}
              </button>
            </div>
          </Dialog>
        </>
      )}

      <AttachmentViewer
        open={viewing != null}
        source={viewing?.source ?? null}
        kind={viewing?.kind ?? "other"}
        onClose={() => setViewing(null)}
      />
    </div>
  );
}
