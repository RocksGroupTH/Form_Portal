"use client";

import React from "react";

/**
 * Shared loading / empty / error states for chart cards.
 * Patterns derived from the Rocksgroup Dashboard Design Guide:
 *   - Loading  → skeleton shimmer (never blank the screen)
 *   - Empty    → centered icon + short title + optional hint
 *   - Error    → centered red message with subtle backdrop
 */

export function ChartError({ message }: { message: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden>
        ⚠️
      </div>
      <div className="empty-title text-red-600">Couldn't load data</div>
      <div className="empty-hint text-red-500/80 break-all">{message}</div>
    </div>
  );
}

export function ChartEmpty({
  icon = "📭",
  title = "No data in this range",
  hint,
}: {
  icon?: string;
  title?: string;
  hint?: React.ReactNode;
}) {
  return (
    <div className="empty-state chart-enter">
      <div className="empty-icon" aria-hidden>
        {icon}
      </div>
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
    </div>
  );
}

/** Generic block skeleton — for cards with custom internal layout. */
export function ChartSkeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton h-full w-full ${className}`} />;
}

/** Skeleton for stacked horizontal bar lists (e.g. hour heatmap). */
export function BarsSkeleton({ rows = 24 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-[2px]">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <div className="w-9 h-3 skeleton" />
          <div
            className="flex-1 h-3 skeleton"
            style={{
              width: `${30 + Math.abs(Math.sin(i * 1.7)) * 65}%`,
            }}
          />
        </div>
      ))}
    </div>
  );
}

/** Skeleton for KPI strip — N month cells. */
export function StripSkeleton({ cells = 5 }: { cells?: number }) {
  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${cells}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: cells }).map((_, i) => (
        <div key={i} className="skeleton h-14 rounded-lg" />
      ))}
    </div>
  );
}
