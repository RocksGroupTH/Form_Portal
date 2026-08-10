"use client";

import { useState } from "react";
import { Columns3 } from "lucide-react";
import { SelectAllRow } from "@/features/travel-booking/components/MultiSelectFilter";

export interface ColumnToggleOption<K extends string> {
  key: K;
  label: string;
}

/**
 * Generic show/hide-columns dropdown — a button that opens a checkbox list.
 * Deliberately a plain absolute-positioned panel (no portal, not a Radix menu),
 * factored out here so any AP-17 report table can reuse it.
 */
export function ColumnToggleMenu<K extends string>({
  columns,
  visible,
  onChange,
  label = "คอลัมน์",
}: {
  columns: ColumnToggleOption<K>[];
  visible: Record<K, boolean>;
  onChange: (next: Record<K, boolean>) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);

  function toggle(key: K) {
    onChange({ ...visible, [key]: !(visible[key] ?? true) });
  }

  const shownCount = columns.filter((c) => visible[c.key] ?? true).length;
  const allShown = shownCount === columns.length;

  function toggleAll() {
    const next = {} as Record<K, boolean>;
    for (const c of columns) next[c.key] = !allShown;
    onChange(next);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg cursor-pointer border-none transition-colors"
        style={{
          background: open ? "var(--nav-active-bg)" : "var(--bg-badge)",
          color: open ? "var(--nav-active-text)" : "var(--text-secondary)",
        }}
        title="แสดง/ซ่อนคอลัมน์"
      >
        <Columns3 size={13} />
        {label}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div
            className="absolute top-full right-0 mt-1 z-30 rounded-xl p-2 min-w-[220px] max-h-[360px] overflow-y-auto shadow-lg"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
          >
            <SelectAllRow checked={allShown} partial={shownCount > 0 && !allShown} onToggle={toggleAll} />
            <div className="my-1" style={{ borderTop: "1px solid var(--border-light)" }} />
            {columns.map((col) => (
              <label
                key={col.key}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-[12px]"
                style={{ color: "var(--text-primary)" }}
              >
                <input
                  type="checkbox"
                  checked={visible[col.key] ?? true}
                  onChange={() => toggle(col.key)}
                  className="rounded"
                />
                {col.label}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
