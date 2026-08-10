"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, Check } from "lucide-react";
import { errInputStyle, inputStyle } from "./shared";

export interface LocalOption {
  value: string;
  label: string;
  subLabel?: string | null;
}

/**
 * Type-ahead single-select over a LOCAL option list (e.g. provinces). Type to filter
 * immediately — no click-to-open step — while still resolving to a fixed option value
 * (so `provinceId` stays intact). Dropdown is portaled + fixed to escape parent
 * `overflow-hidden` and always sits directly under the input.
 */
export function LocalSearchSelect({
  options,
  value,
  onChange,
  placeholder = "พิมพ์เพื่อค้นหา...",
  hasError,
  emptyLabel = "ไม่พบผลลัพธ์",
}: {
  options: LocalOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hasError?: boolean;
  emptyLabel?: string;
}) {
  const selected = options.find((o) => o.value === value) ?? null;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxH: number } | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter(
        (o) => o.label.toLowerCase().includes(q) || (o.subLabel ?? "").toLowerCase().includes(q),
      )
    : options;

  // Show the selected label when idle; show the typed query while the list is open.
  const inputValue = open ? query : selected?.label ?? "";

  useLayoutEffect(() => {
    if (!open) return;
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const top = r.bottom + 4;
    const maxH = Math.max(140, Math.min(300, window.innerHeight - top - 12));
    setPos({ top, left: r.left, width: r.width, maxH });
  }, [open, query, filtered.length]);

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
    <div ref={anchorRef} className="relative">
      <div className="flex items-center rounded-lg" style={{ ...inputStyle, ...errInputStyle(!!hasError), padding: 0 }}>
        <Search size={15} className="ml-3 shrink-0" style={{ color: "var(--text-muted)" }} />
        <input
          value={inputValue}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setQuery("");
            setOpen(true);
          }}
          placeholder={placeholder}
          className="w-full bg-transparent px-2 py-2 text-[14px] outline-none border-none"
          style={{ background: "transparent", color: "var(--text-primary)" }}
        />
      </div>

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
            <div className="overflow-y-auto py-1" style={{ maxHeight: pos.maxH }}>
              {filtered.length === 0 ? (
                <p className="px-3 py-2 text-[12.5px]" style={{ color: "var(--text-muted)" }}>{emptyLabel}</p>
              ) : (
                filtered.map((o) => {
                  const isSel = o.value === value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => {
                        onChange(o.value);
                        setOpen(false);
                        setQuery("");
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer border-none text-[13px]"
                      style={{ background: isSel ? "var(--nav-active-bg)" : "transparent", color: "var(--text-primary)" }}
                    >
                      <span className="w-4 shrink-0" style={{ color: "var(--nav-active-text)" }}>
                        {isSel && <Check size={13} />}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      {o.subLabel && <span className="text-[11px] shrink-0" style={{ color: "var(--text-faint)" }}>{o.subLabel}</span>}
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
