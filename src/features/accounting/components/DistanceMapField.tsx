"use client";

import React from "react";
import dynamic from "next/dynamic";
import type { LegValue } from "@/features/accounting/hooks/useTravelExpenseForm";

const RouteMapPicker = dynamic(() => import("./RouteMapPicker"), {
  ssr: false,
  loading: () => (
    <div
      className="w-full flex items-center justify-center text-[13px]"
      style={{ height: 300, borderRadius: "var(--radius-lg)", background: "var(--bg-card-alt)", color: "var(--text-muted)" }}
    >
      กำลังโหลดแผนที่...
    </div>
  ),
});

interface DistanceMapFieldProps {
  label: string;
  value: LegValue | null;
  onChange: (next: LegValue | null) => void;
  hqEnd?: "origin" | "destination";
  /** Show multi-stop fields and「เพิ่มจุดแวะ」— onward leg only. */
  allowWaypoints?: boolean;
}

export function DistanceMapField({ label, value, onChange, hqEnd, allowWaypoints = true }: DistanceMapFieldProps) {
  return (
    <div className="w-full">
      <label
        className="block text-[13px] font-medium mb-2"
        style={{ color: "var(--text-secondary)" }}
      >
        {label}
      </label>
      <RouteMapPicker value={value} onChange={onChange} hqEnd={hqEnd} allowWaypoints={allowWaypoints} />
    </div>
  );
}
