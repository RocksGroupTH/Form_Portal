"use client";

import React from "react";
import { ERP_INTERFACE_BRANDS } from "@/lib/acc/erp-interface-brands";
import { ERP_INTERFACE_UNASSIGNED } from "@/features/accounting/lib/erp-interface-target";

export interface ErpInterfaceBrandTabsProps {
  activeCode: string;
  onChange: (code: string) => void;
  counts: Record<string, number>;
  /** When set, only these interface brand codes are shown (uppercase). */
  visibleCodes?: string[] | null;
  showUnassigned?: boolean;
  className?: string;
}

export function ErpInterfaceBrandTabs({
  activeCode,
  onChange,
  counts,
  visibleCodes = null,
  showUnassigned = true,
  className = "",
}: ErpInterfaceBrandTabsProps) {
  const active = activeCode.trim().toUpperCase();
  const unassignedCount = counts[ERP_INTERFACE_UNASSIGNED] ?? 0;

  const brands = visibleCodes && visibleCodes.length > 0
    ? ERP_INTERFACE_BRANDS.filter((iface) => visibleCodes.includes(iface.id))
    : ERP_INTERFACE_BRANDS;

  return (
    <div
      className={`flex gap-2 overflow-x-auto overflow-y-hidden no-scrollbar pb-0.5 ${className}`}
      role="tablist"
      aria-label="Interface ERP brand group"
    >
      {brands.map((iface) => {
        const code = iface.id;
        const count = counts[code] ?? 0;
        const isActive = active === code;
        return (
          <button
            key={code}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(code)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-left shrink-0 transition-colors cursor-pointer border"
            style={{
              background: isActive ? "var(--bg-card)" : "var(--bg-card-alt)",
              borderColor: isActive ? "var(--nav-active-text)" : "var(--border-light)",
              boxShadow: isActive
                ? "0 0 0 1px color-mix(in srgb, var(--nav-active-text) 25%, transparent)"
                : "none",
            }}
          >
            <img
              src={`/brandlogo/${code.toLowerCase()}-200.png`}
              alt=""
              className="h-7 w-auto object-contain shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <span className="flex flex-col items-start min-w-0">
              <span
                className="text-[12px] font-bold leading-tight"
                style={{ color: isActive ? "var(--text-heading)" : "var(--text-secondary)" }}
              >
                {iface.name}
              </span>
              <span className="text-[10px] tabular-nums" style={{ color: "var(--text-muted)" }}>
                {count} รายการ
              </span>
            </span>
          </button>
        );
      })}

      {showUnassigned && unassignedCount > 0 && (
        <button
          type="button"
          role="tab"
          aria-selected={active === ERP_INTERFACE_UNASSIGNED}
          onClick={() => onChange(ERP_INTERFACE_UNASSIGNED)}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-left shrink-0 transition-colors cursor-pointer border"
          style={{
            background: active === ERP_INTERFACE_UNASSIGNED ? "var(--bg-info-yellow)" : "var(--bg-card-alt)",
            borderColor: active === ERP_INTERFACE_UNASSIGNED ? "var(--border-info-yellow)" : "var(--border-light)",
          }}
        >
          <span className="flex flex-col items-start">
            <span className="text-[12px] font-bold leading-tight" style={{ color: "var(--text-heading)" }}>
              ยังไม่กำหนดปลายทาง
            </span>
            <span className="text-[10px] tabular-nums" style={{ color: "var(--text-muted)" }}>
              {unassignedCount} รายการ
            </span>
          </span>
        </button>
      )}
    </div>
  );
}
