"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ViewKey } from "@/features/intelligence/master/types";

const OPTIONS: ViewKey[] = [
  "Sale Channel",
  "Sale Mode",
  "Tender",
  "Hourly",
  "Category",
  "Menu Name",
  "Ticket Count",
  "Ticket Average",
];

const PANEL_WIDTH = 240;

interface Props {
  value: ViewKey;
  onChange: (v: ViewKey) => void;
}

/**
 * Searchable single-select for the dashboard's main "View" switcher.
 * Replaces the native `<select>` so users can type to narrow the 8
 * options (and any future additions) instead of scrolling — matches
 * the `MultiSelect` panel pattern used by every other filter, just
 * without the multi-select / cascade / debounced commit layers.
 */
export function ViewSelect({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null
  );
  const [mounted, setMounted] = useState(false);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setMounted(true), []);

  const filtered = useMemo(() => {
    if (query.length === 0) return OPTIONS;
    const q = query.toLowerCase();
    return OPTIONS.filter((o) => o.toLowerCase().includes(q));
  }, [query]);

  // Reset highlight whenever the filtered list changes so the user
  // doesn't end up with an out-of-range arrow-key cursor.
  useEffect(() => {
    setActiveIdx(0);
  }, [filtered.length]);

  // Position the panel under the trigger button. Re-measures on
  // scroll / resize so the dropdown stays anchored if the surrounding
  // RightRail card scrolls.
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      // Prefer aligning to the trigger's right edge so the panel doesn't
      // overflow the viewport on narrow rails. Falls back to left-align
      // when there isn't enough room on the right.
      let left = r.left;
      const overflow = left + PANEL_WIDTH - window.innerWidth + 8;
      if (overflow > 0) left = Math.max(8, left - overflow);
      setCoords({ top: r.bottom + 4, left });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // Outside click + Escape close. Pointerdown (not click) so the close
  // fires before the next interaction starts.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node | null;
      if (!t) return;
      if (panelRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        const pick = filtered[activeIdx];
        if (pick) {
          onChange(pick);
          setOpen(false);
        }
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, filtered, activeIdx, onChange]);

  // Reset query each time the panel reopens so the user always starts
  // from the full list rather than yesterday's search.
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  function pick(v: ViewKey) {
    onChange(v);
    setOpen(false);
  }

  const panel = open && coords && (
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        top: coords.top,
        left: coords.left,
        width: PANEL_WIDTH,
        zIndex: 9999,
        background: "var(--bg-card)",
        borderColor: "var(--border-subtle)",
      }}
      className="rounded-md border shadow-lg"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="p-2 border-b"
        style={{ borderColor: "var(--border-subtle)" }}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="w-full text-xs rounded border px-2 py-1 focus:outline-none focus:ring-1 focus:ring-inset"
          style={{
            borderColor: "var(--border-subtle)",
            background: "var(--bg-card)",
            color: "var(--text-primary)",
          }}
        />
      </div>
      <div className="max-h-60 overflow-y-auto py-1 scroll-thin">
        {filtered.length === 0 ? (
          <div
            className="px-3 py-2 text-[11px] italic"
            style={{ color: "var(--text-muted)" }}
          >
            No matches
          </div>
        ) : (
          filtered.map((o, i) => {
            const selected = o === value;
            const active = i === activeIdx;
            return (
              <button
                key={o}
                type="button"
                onClick={() => pick(o)}
                onMouseEnter={() => setActiveIdx(i)}
                className="w-full text-left text-xs px-3 py-1.5 pointer-coarse:py-2.5 flex items-center justify-between gap-2"
                style={{
                  background: active ? "var(--bg-hover)" : "transparent",
                  color: selected
                    ? "var(--accent)"
                    : "var(--text-primary)",
                  fontWeight: selected ? 600 : 400,
                }}
              >
                <span className="truncate">{o}</span>
                {selected && (
                  <span aria-hidden style={{ color: "var(--accent)" }}>
                    ✓
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="View"
        className="w-full text-left font-sans text-xs rounded-md border px-2 py-1.5 pointer-coarse:py-2.5 focus:outline-none focus:ring-1 focus:ring-inset flex items-center justify-between gap-2"
        style={{
          borderColor: "var(--border-subtle)",
          background: "var(--bg-card)",
          color: "var(--text-primary)",
        }}
      >
        <span className="truncate">{value}</span>
        <span
          aria-hidden
          className="shrink-0 text-[10px]"
          style={{ color: "var(--text-muted)" }}
        >
          ▼
        </span>
      </button>
      {mounted && panel ? createPortal(panel, document.body) : null}
    </div>
  );
}
