"use client";

import { statusLabelDisplay } from "@/features/travel-booking/constants";
import type { TravelBookingStatus } from "@/features/travel-booking/types";

const COLOR_MAP: Record<TravelBookingStatus, { bg: string; text: string; border: string }> = {
  Draft: { bg: "var(--bg-badge)", text: "var(--text-muted)", border: "var(--border-card)" },
  Submitted: { bg: "var(--bg-info-yellow)", text: "var(--text-info-yellow)", border: "var(--border-info-yellow)" },
  ManagerApproved: { bg: "var(--bg-info-yellow)", text: "var(--text-info-yellow)", border: "var(--border-info-yellow)" },
  Completed: { bg: "var(--bg-info-green)", text: "var(--text-info-green)", border: "var(--border-info-green)" },
  Rejected: { bg: "rgba(220,38,38,0.08)", text: "var(--color-danger)", border: "rgba(220,38,38,0.2)" },
  Returned: { bg: "var(--bg-info-yellow)", text: "var(--text-info-yellow)", border: "var(--border-info-yellow)" },
  Cancelled: { bg: "var(--bg-badge)", text: "var(--text-faint)", border: "var(--border-light)" },
};

/** Status pill for AP-17 requests — mirrors AP-1's RequestStatusBadge (private to RequestDetail.tsx, so not reusable directly). */
export function TravelBookingStatusBadge({
  status,
  className,
}: {
  status: TravelBookingStatus;
  className?: string;
}) {
  const label = statusLabelDisplay(status);
  const c = COLOR_MAP[status] ?? COLOR_MAP.Draft;
  return (
    <span
      className={`inline-flex items-center text-[11px] font-medium px-2.5 py-1 rounded-full ${className ?? ""}`}
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
    >
      {label}
    </span>
  );
}
