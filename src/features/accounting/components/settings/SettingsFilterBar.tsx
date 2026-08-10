"use client";

import { Search, X } from "lucide-react";

interface SegGroup {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}

/** Reusable search box + segmented filter groups for settings lists. */
export function SettingsFilterBar({
  search,
  onSearch,
  placeholder,
  groups,
}: {
  search: string;
  onSearch: (v: string) => void;
  placeholder?: string;
  groups?: SegGroup[];
}) {
  return (
    <div className="flex items-center gap-2 mb-3 flex-wrap">
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-lg flex-1 min-w-[180px]"
        style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)" }}
      >
        <Search size={14} style={{ color: "var(--text-muted)" }} />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={placeholder ?? "ค้นหา..."}
          className="flex-1 text-[12px] outline-none bg-transparent"
          style={{ color: "var(--text-primary)" }}
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearch("")}
            className="inline-flex items-center justify-center cursor-pointer border-none"
            style={{ background: "transparent", color: "var(--text-faint)" }}
            aria-label="ล้างคำค้นหา"
          >
            <X size={13} />
          </button>
        )}
      </div>
      {groups?.map((g, gi) => (
        <div
          key={gi}
          className="flex gap-0.5 rounded-lg p-0.5"
          style={{ background: "var(--bg-badge)" }}
        >
          {g.options.map((o) => {
            const active = g.value === o.value;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => g.onChange(o.value)}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-md cursor-pointer border-none transition-colors"
                style={{
                  background: active ? "var(--bg-card)" : "transparent",
                  color: active ? "var(--nav-active-text)" : "var(--text-muted)",
                  boxShadow: active ? "var(--shadow-sm)" : undefined,
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
