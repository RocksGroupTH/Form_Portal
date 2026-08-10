"use client";
import React from "react";
import { PERIOD_OPTIONS } from "@/features/intelligence/constants";

interface DateRangeFilterProps {
  value: string;
  onChange: (period: string) => void;
}

export function DateRangeFilter({ value, onChange }: DateRangeFilterProps) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {PERIOD_OPTIONS.map((opt) => {
        const isActive = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className="text-[11px] font-semibold px-3 py-1 rounded-full cursor-pointer transition-colors"
            style={{
              background: isActive
                ? "var(--nav-active-bg)"
                : "transparent",
              color: isActive
                ? "var(--nav-active-text)"
                : "var(--text-muted)",
              border: isActive
                ? "1px solid transparent"
                : "1px solid var(--border-card)",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
