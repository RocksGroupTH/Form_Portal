"use client";

import { ERP_INTERFACE_BRANDS } from "@/lib/acc/erp-interface-brands";
import { Building2 } from "lucide-react";

export const ADVANCE_COMPANY_ALL = "__ALL__";

/**
 * Company (ERP interface target) selector — mirrors AP-1's per-company view.
 * Shows every configured interface brand plus an "ทั้งหมด" option, each with a
 * live count of rows currently in the queue for that Company.
 */
export function AdvanceCompanyBar({
  value,
  onChange,
  counts,
}: {
  value: string;
  onChange: (code: string) => void;
  counts: Record<string, number>;
}) {
  const options: { id: string; name: string; logo: string | null }[] = [
    { id: ADVANCE_COMPANY_ALL, name: "ทั้งหมด", logo: null },
    ...ERP_INTERFACE_BRANDS.map((b) => ({
      id: b.id,
      name: b.name,
      logo: `/brandlogo/${b.id.toLowerCase()}-200.png`,
    })),
  ];
  return (
    <div className="flex items-center gap-2 mb-4 flex-wrap">
      <Building2 size={15} style={{ color: "var(--text-muted)" }} />
      <span className="text-[12px] font-semibold" style={{ color: "var(--text-muted)" }}>Company:</span>
      <div className="flex gap-1 flex-wrap">
        {options.map((o) => {
          const active = value === o.id;
          const count = o.id === ADVANCE_COMPANY_ALL
            ? Object.values(counts).reduce((s, x) => s + x, 0)
            : counts[o.id] ?? 0;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onChange(o.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold rounded-lg cursor-pointer border transition-colors"
              style={{
                background: active ? "var(--nav-active-bg)" : "transparent",
                color: active ? "var(--nav-active-text)" : "var(--text-muted)",
                borderColor: active ? "var(--nav-active-text)" : "var(--border-card)",
              }}
            >
              {o.logo && (
                <img
                  src={o.logo}
                  alt=""
                  className="h-4 w-auto object-contain shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
              )}
              {o.name}
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{
                  background: active ? "var(--nav-active-text)" : "var(--bg-card-alt)",
                  color: active ? "var(--nav-active-bg)" : "var(--text-faint)",
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
