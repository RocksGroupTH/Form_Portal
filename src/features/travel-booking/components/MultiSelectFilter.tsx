"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export interface MultiSelectOption {
  value: string;
  label: string;
}

/**
 * Master "ทั้งหมด" checkbox for a checkbox dropdown: checks/clears everything and shows an
 * indeterminate dash on a partial selection. `indeterminate` is a DOM property rather than an
 * attribute, so it has to be set through a ref.
 */
export function SelectAllRow({
  checked,
  partial,
  onToggle,
  label = "ทั้งหมด",
}: {
  checked: boolean;
  partial: boolean;
  onToggle: () => void;
  label?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = partial;
  });

  return (
    <label
      className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-[12px] font-bold"
      style={{ color: "var(--text-heading)" }}
    >
      <input ref={ref} type="checkbox" checked={checked} onChange={onToggle} className="rounded" />
      {label}
    </label>
  );
}

/**
 * Filter dropdown that lets several options be picked at once, headed by the "ทั้งหมด" master
 * checkbox. An empty `selected` array means "no filter" — the same meaning the plain
 * `<select>`'s empty option had, so callers can keep treating it as unset.
 */
export function MultiSelectFilter({
  options,
  selected,
  onChange,
  placeholder = "ทั้งหมด",
  disabled = false,
}: {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const allChecked = options.length > 0 && selected.length === options.length;
  const partial = selected.length > 0 && !allChecked;

  function toggle(value: string) {
    onChange(
      selected.indexOf(value) === -1
        ? selected.concat(value)
        : selected.filter((v) => v !== value),
    );
  }

  const summary =
    selected.length === 0 || allChecked
      ? placeholder
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? selected[0])
        : `เลือก ${selected.length} รายการ`;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className="w-full flex items-center justify-between gap-2 text-[12px] px-2.5 py-2 rounded-lg outline-none cursor-pointer text-left disabled:opacity-60 disabled:cursor-not-allowed"
        style={{
          background: "var(--bg-input)",
          color: partial ? "var(--text-primary)" : "var(--text-muted)",
          border: `1px solid ${open ? "var(--nav-active-text)" : "var(--border-input)"}`,
        }}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown size={13} className="shrink-0" style={{ color: "var(--text-muted)" }} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div
            className="absolute top-full left-0 mt-1 z-30 rounded-xl p-2 w-full min-w-[200px] max-h-[300px] overflow-y-auto shadow-lg"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
          >
            <SelectAllRow
              checked={allChecked}
              partial={partial}
              onToggle={() => onChange(allChecked ? [] : options.map((o) => o.value))}
            />
            <div className="my-1" style={{ borderTop: "1px solid var(--border-light)" }} />
            {options.length === 0 ? (
              <p className="text-[11.5px] px-2 py-1.5 m-0" style={{ color: "var(--text-muted)" }}>
                ไม่มีตัวเลือก
              </p>
            ) : (
              options.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-[12px]"
                  style={{ color: "var(--text-primary)" }}
                >
                  <input
                    type="checkbox"
                    checked={selected.indexOf(opt.value) !== -1}
                    onChange={() => toggle(opt.value)}
                    className="rounded"
                  />
                  <span className="truncate">{opt.label}</span>
                </label>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
