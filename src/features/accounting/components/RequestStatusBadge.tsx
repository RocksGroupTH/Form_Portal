"use client";

import React from "react";
import { statusLabelDisplay } from "@/features/accounting/constants";

export function requestStatusStyle(status: string): React.CSSProperties {
  switch (status) {
    case "Approved":
      return {
        background: "var(--bg-info-green)",
        color: "var(--text-info-green)",
        border: "1px solid var(--border-info-green)",
      };
    case "Submitted":
    case "ManagerApproved":
      return {
        background: "var(--bg-info-yellow)",
        color: "var(--text-info-yellow)",
        border: "1px solid var(--border-info-yellow)",
      };
    case "Returned":
      return {
        background: "color-mix(in srgb, var(--color-warning) 14%, transparent)",
        color: "var(--color-warning)",
        border: "1px solid color-mix(in srgb, var(--color-warning) 35%, transparent)",
      };
    case "Rejected":
      return {
        background: "color-mix(in srgb, var(--color-danger) 10%, transparent)",
        color: "var(--color-danger)",
        border: "1px solid color-mix(in srgb, var(--color-danger) 30%, transparent)",
      };
    case "Cancelled":
      return {
        background: "var(--bg-badge)",
        color: "var(--text-faint)",
        border: "1px solid var(--border-light)",
      };
    default:
      return {
        background: "var(--bg-badge)",
        color: "var(--text-muted)",
        border: "1px solid var(--border-light)",
      };
  }
}

/** Colored chip for report status filter group ids (pending, Approved, …). */
export function reportStatusFilterStyle(filterId: string): React.CSSProperties {
  switch (filterId) {
    case "pending":
      return {
        background: "var(--bg-info-yellow)",
        color: "var(--text-info-yellow)",
        border: "1px solid var(--border-info-yellow)",
      };
    case "Approved":
      return {
        background: "var(--bg-info-green)",
        color: "var(--text-info-green)",
        border: "1px solid var(--border-info-green)",
      };
    case "Rejected":
      return {
        background: "color-mix(in srgb, var(--color-danger) 10%, transparent)",
        color: "var(--color-danger)",
        border: "1px solid color-mix(in srgb, var(--color-danger) 30%, transparent)",
      };
    case "Returned":
      return {
        background: "color-mix(in srgb, var(--color-warning) 14%, transparent)",
        color: "var(--color-warning)",
        border: "1px solid color-mix(in srgb, var(--color-warning) 35%, transparent)",
      };
    case "Cancelled":
      return {
        background: "var(--bg-badge)",
        color: "var(--text-faint)",
        border: "1px solid var(--border-light)",
      };
    default:
      return {
        background: "var(--bg-badge)",
        color: "var(--text-secondary)",
        border: "1px solid var(--border-light)",
      };
  }
}

export function RequestStatusBadge({ status }: { status: string }) {
  return (
    <span
      className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap inline-block"
      style={requestStatusStyle(status)}
    >
      {statusLabelDisplay(status)}
    </span>
  );
}
