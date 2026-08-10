"use client";

import React from "react";
import { FilterPanel } from "@/features/intelligence/master/components/filters/FilterPanel";
import { ViewSelect } from "@/features/intelligence/master/components/filters/ViewSelect";
import { ViewLegend } from "@/features/intelligence/master/components/charts/ViewLegend";
import { ColorByKey, MetricKey, ViewKey } from "@/features/intelligence/master/types";

interface Props {
  brand: string;
  view: ViewKey;
  colorBy: ColorByKey;
  metric?: MetricKey;
  onViewChange: (v: ViewKey) => void;
}

export function RightRail({
  brand,
  view,
  colorBy,
  metric = "netSales",
  onViewChange,
}: Props) {
  return (
    <>
      <div
        className="card p-2 shrink-0"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-card)",
        }}
        data-tour="view-select"
      >
        <div className="flex items-center justify-between mb-1 gap-2">
          <div
            className="text-[11px] uppercase tracking-[0.08em] font-semibold"
            style={{ color: "var(--text-muted)" }}
          >
            Select a View
          </div>
        </div>
        <ViewSelect value={view} onChange={onViewChange} />
      </div>

      <FilterPanel brand={brand} />

      <div
        className="card p-2 shrink-0"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-card)",
        }}
      >
        <div
          className="text-[11px] uppercase tracking-[0.08em] font-semibold mb-1.5 font-display"
          style={{ color: "var(--text-muted)" }}
        >
          Legend — {view}
        </div>
        <ViewLegend brand={brand} colorBy={colorBy} metric={metric} />
      </div>
    </>
  );
}
