"use client";

import React from "react";

export function ChartCard({
  title,
  subtitle,
  children,
  className = "",
  height,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  height?: number;
}) {
  return (
    <div
      className={`card p-2 overflow-hidden flex flex-col min-h-0 min-w-0 ${className}`}
      style={height ? { height } : undefined}
    >
      <div className="flex items-baseline justify-between mb-1 shrink-0">
        <div
          className="text-[11px] uppercase tracking-[0.08em] font-semibold font-display"
          style={{ color: "var(--text-muted)" }}
        >
          {title}
        </div>
        {subtitle ? (
          <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {subtitle}
          </div>
        ) : null}
      </div>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
