"use client";
import React from "react";

interface KpiCardProps {
  label: string;
  value: string;
  subtitle?: string;
  trend?: number;
  icon?: React.ReactNode;
}

export function KpiCard({ label, value, subtitle, trend, icon }: KpiCardProps) {
  const trendColor =
    trend !== undefined
      ? trend >= 0
        ? "var(--color-success)"
        : "var(--color-danger)"
      : undefined;

  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-1"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-card)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      {/* Top: icon + label */}
      <div className="flex items-center gap-1.5">
        {icon && (
          <span className="shrink-0" style={{ color: "var(--text-muted)" }}>
            {icon}
          </span>
        )}
        <span
          className="text-[12px] font-medium"
          style={{ color: "var(--text-muted)" }}
        >
          {label}
        </span>
      </div>

      {/* Middle: value */}
      <span
        className="text-[22px] font-bold leading-tight"
        style={{ color: "var(--text-heading)" }}
      >
        {value}
      </span>

      {/* Bottom: subtitle + trend */}
      {(subtitle || trend !== undefined) && (
        <div className="flex items-center gap-1.5 mt-0.5">
          {subtitle && (
            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {subtitle}
            </span>
          )}
          {trend !== undefined && (
            <span
              className="inline-flex items-center gap-0.5 text-[11px] font-semibold"
              style={{ color: trendColor }}
            >
              {trend >= 0 ? (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 9V3" />
                  <path d="M3 5l3-3 3 3" />
                </svg>
              ) : (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M6 3v6" />
                  <path d="M3 7l3 3 3-3" />
                </svg>
              )}
              {trend >= 0 ? "+" : ""}
              {trend.toFixed(1)}%
            </span>
          )}
        </div>
      )}
    </div>
  );
}
