"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Clock, Search } from "lucide-react";
import { errInputStyle, inputStyle } from "./shared";

/**
 * Compact, searchable single-time picker — the options render as a multi-column card
 * grid inside a portaled popover (so a long hour list stays short) with a filter box.
 */
export function TimeSelect({
  value,
  options,
  onChange,
  placeholder = "เลือกเวลา",
  hasError,
  disabled,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  placeholder?: string;
  hasError?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const q = query.trim();
  const filtered = q ? options.filter((o) => o.includes(q)) : options;

  useLayoutEffect(() => {
    if (!open) return;
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left, width: Math.max(200, r.width) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="flex-1 min-w-0">
      <button
        ref={anchorRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          setQuery("");
          setOpen((o) => !o);
        }}
        className="w-full rounded-lg px-2.5 py-2 text-[14px] flex items-center gap-2 text-left tabular-nums disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ ...inputStyle, ...errInputStyle(!!hasError && !value), cursor: disabled ? "not-allowed" : "pointer" }}
      >
        <Clock size={14} className="shrink-0" style={{ color: "var(--text-muted)" }} />
        <span className="flex-1 truncate" style={{ color: value ? "var(--text-primary)" : "var(--text-faint)" }}>
          {value || placeholder}
        </span>
      </button>

      {open && pos &&
        createPortal(
          <div
            ref={popRef}
            className="fixed z-[70] rounded-xl overflow-hidden"
            style={{
              top: pos.top,
              left: pos.left,
              width: pos.width,
              background: "var(--bg-card)",
              border: "1px solid var(--border-card)",
              boxShadow: "var(--shadow-modal)",
            }}
          >
            <div className="flex items-center gap-2 px-2.5 py-2" style={{ borderBottom: "1px solid var(--border-light)" }}>
              <Search size={14} className="shrink-0" style={{ color: "var(--text-muted)" }} />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ค้นหาเวลา..."
                className="w-full bg-transparent text-[13px] outline-none border-none"
                style={{ color: "var(--text-primary)" }}
              />
            </div>
            <div className="p-1.5 max-h-[210px] overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-2 py-2 text-[12.5px]" style={{ color: "var(--text-muted)" }}>ไม่พบเวลา</p>
              ) : (
                <div className="grid grid-cols-4 gap-1">
                  {filtered.map((o) => {
                    const selected = o === value;
                    return (
                      <button
                        key={o}
                        type="button"
                        onClick={() => {
                          onChange(o);
                          setOpen(false);
                        }}
                        className="px-1.5 py-1.5 rounded-lg text-[12.5px] font-semibold tabular-nums cursor-pointer border-none"
                        style={{
                          background: selected ? "var(--nav-active-text)" : "var(--bg-card-alt)",
                          color: selected ? "var(--bg-card)" : "var(--text-primary)",
                        }}
                      >
                        {o}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
