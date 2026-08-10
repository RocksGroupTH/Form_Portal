"use client";

interface KpiItem {
  label: string;
  value: string;
  color?: string;
}

interface ReportKpiBarProps {
  items: KpiItem[];
}

export function ReportKpiBar({ items }: ReportKpiBarProps) {
  if (items.length === 0) return null;
  return (
    <div className="flex items-center gap-4 overflow-x-auto">
      {items.map((item, i) => (
        <div key={item.label} className="flex items-center gap-3 shrink-0">
          {i > 0 && (
            <div className="w-px h-6 shrink-0" style={{ background: "var(--border-light)" }} />
          )}
          <div className="flex flex-col">
            <span className="text-[9px] font-semibold uppercase tracking-wide leading-tight" style={{ color: "var(--text-faint)" }}>
              {item.label}
            </span>
            <span
              className="text-[14px] font-bold leading-tight"
              style={{ color: item.color ?? "var(--text-heading)" }}
            >
              {item.value}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
