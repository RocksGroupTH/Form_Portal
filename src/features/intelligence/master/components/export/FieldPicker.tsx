"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  all: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  /** Called when the user clicks "Reset" — restores the parent's
   *  default field order AND re-selects every field. */
  onReset?: () => void;
}

const PANEL_WIDTH = 280;

/** Multi-select dropdown for picking which fields to include in the export. */
export function FieldPicker({ all, selected, onChange, onReset }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null
  );
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!open) return;
    function update() {
      const btn = triggerRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const vw = window.innerWidth;
      let left = r.left;
      if (left + PANEL_WIDTH > vw - 8) left = vw - PANEL_WIDTH - 8;
      if (left < 8) left = 8;
      setCoords({ top: r.bottom + 4, left });
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = all.filter(
    (f) => query.length === 0 || f.toLowerCase().includes(query.toLowerCase())
  );

  function toggle(f: string) {
    if (selected.includes(f)) onChange(selected.filter((x) => x !== f));
    else onChange([...selected, f]);
  }

  const panel = open && coords && (
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        top: coords.top,
        left: coords.left,
        width: PANEL_WIDTH,
        zIndex: 10001,
        boxShadow: "0 12px 40px rgba(15,23,42,0.18)",
        background: "var(--bg-card)",
        border: "1px solid var(--border-card)",
      }}
      className="rounded-xl"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="p-2 flex items-center gap-1.5"
        style={{ borderBottom: "1px solid var(--border-card)" }}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search fields…"
          className="flex-1 text-xs rounded px-2 py-1 focus:outline-none focus:ring-1"
          style={{
            border: "1px solid var(--border-card)",
            background: "var(--bg-elevated)",
            color: "var(--text-primary)",
          }}
        />
      </div>
      <div className="max-h-[260px] overflow-y-auto py-1 scroll-thin">
        {filtered.length === 0 ? (
          <div className="px-3 py-2 text-xs" style={{ color: "var(--text-muted)" }}>No fields</div>
        ) : (
          filtered.map((f) => {
            const checked = selected.includes(f);
            return (
              <button
                key={f}
                type="button"
                onClick={() => toggle(f)}
                className="w-full flex items-center gap-2 px-2 py-1 text-xs text-left transition-colors"
                style={{
                  background: checked ? "var(--accent-subtle)" : undefined,
                }}
              >
                <span
                  aria-hidden
                  className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded"
                  style={{
                    background: checked ? "var(--accent)" : "var(--bg-elevated)",
                    border: checked ? "1px solid var(--accent)" : "1px solid var(--border-card)",
                    color: checked ? "#fff" : undefined,
                  }}
                >
                  {checked && (
                    <svg viewBox="0 0 12 12" className="h-3 w-3">
                      <path
                        d="M2.5 6.5l2.5 2.5 4.5-5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </span>
                <span className="truncate" style={{ color: "var(--text-primary)" }}>{f}</span>
              </button>
            );
          })
        )}
      </div>
      <div
        className="flex items-center justify-between gap-2 p-2"
        style={{ borderTop: "1px solid var(--border-card)" }}
      >
        <button
          type="button"
          onClick={() => {
            if (onReset) onReset();
            else onChange(Array.from(all));
          }}
          className="text-[11px]"
          style={{ color: "var(--text-muted)" }}
          title="Reset to default field order with every field selected"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={() => onChange(Array.from(all))}
          disabled={selected.length === all.length}
          className="text-[11px] disabled:opacity-40"
          style={{ color: "var(--text-muted)" }}
        >
          Select all
        </button>
        <span className="text-[11px] ml-auto" style={{ color: "var(--text-muted)" }}>
          {selected.length}/{all.length} selected
        </span>
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left text-xs rounded-md h-8 px-2 transition-colors"
        style={{
          background: "var(--bg-elevated)",
          border: open
            ? "1px solid var(--accent)"
            : "1px solid var(--border-card)",
          outline: open ? "1px solid var(--accent)" : undefined,
          color: "var(--text-primary)",
        }}
      >
        <span>
          {selected.length === all.length
            ? "All fields"
            : selected.length === 0
            ? "Pick fields…"
            : `${selected.length} fields`}
        </span>
        <span
          className="float-right text-[11px] mt-[2px]"
          style={{ color: "var(--text-muted)" }}
        >
          {open ? "▴" : "▾"}
        </span>
      </button>
      {mounted && panel ? createPortal(panel, document.body) : null}
    </>
  );
}
