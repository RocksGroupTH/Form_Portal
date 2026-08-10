"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MapPin, Search, Loader2, Star } from "lucide-react";
import { errInputStyle, inputClass, inputStyle } from "./shared";

interface OrsPlace {
  label: string;
  lat: number;
  lng: number;
  region?: string | null;
}

/**
 * Departure-place picker backed by ORS geocoding (ข้อ13). The requester types a place
 * name → debounced `/api/ors/geocode` search → pick a result. Admin-configured places
 * for the vehicle show as quick picks, and any typed text can be committed directly so
 * the field still works when ORS is unavailable. Stores the chosen label as a string.
 */
export function OrsPlaceField({
  value,
  onChange,
  onSelectPlace,
  filter,
  suggestions = [],
  hasError,
  placeholder = "พิมพ์ค้นหาสถานที่ (เช่น สนามบินสุวรรณภูมิ)...",
}: {
  value: string | null;
  onChange: (name: string | null) => void;
  /** Fired when the user picks an ORS result — carries `region` (province) for auto-fill. */
  onSelectPlace?: (place: OrsPlace) => void;
  /** Keep only results matching this predicate (e.g. same province). */
  filter?: (place: OrsPlace) => boolean;
  /** Admin-configured places for this vehicle, shown as quick picks. */
  suggestions?: string[];
  hasError?: boolean;
  placeholder?: string;
}) {
  const [query, setQuery] = useState(value ?? "");
  const [results, setResults] = useState<OrsPlace[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxH: number } | null>(null);

  // Reflect external value changes (e.g. switching vehicle resets the place).
  useEffect(() => setQuery(value ?? ""), [value]);

  // Debounced ORS search — skipped while closed, for short queries, or when the query
  // still equals the already-committed value (just picked).
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/ors/geocode?mode=search&q=${encodeURIComponent(q)}`);
        const json = await res.json();
        setResults(json.ok && Array.isArray(json.data) ? (json.data as OrsPlace[]) : []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query, open]);

  useLayoutEffect(() => {
    if (!open) return;
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Always anchor directly under the input; shrink (scroll) instead of flipping up.
    const top = r.bottom + 4;
    const maxH = Math.max(140, Math.min(300, window.innerHeight - top - 12));
    setPos({ top, left: r.left, width: r.width, maxH });
  }, [open, query, results.length, loading]);

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

  const commit = (name: string) => {
    const v = name.trim();
    onChange(v || null);
    setQuery(v);
    setOpen(false);
  };

  const q = query.trim();
  const shownResults = filter ? results.filter(filter) : results;
  const matchingSuggestions = suggestions.filter(
    (s) => !q || s.toLowerCase().includes(q.toLowerCase()),
  );
  const showRawCommit = q.length >= 2 && !suggestions.some((s) => s === q) && !shownResults.some((r) => r.label === q);

  return (
    <div ref={anchorRef} className="relative">
      <div className="flex items-center gap-2 rounded-lg px-3" style={{ ...inputStyle, ...errInputStyle(!!hasError), padding: 0 }}>
        <Search size={15} className="ml-3 shrink-0" style={{ color: "var(--text-muted)" }} />
        <input
          value={query}
          onChange={(e) => {
            const v = e.target.value;
            setQuery(v);
            onChange(v || null); // keep free-typed text even without picking a result
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className={`${inputClass} border-none bg-transparent px-2`}
          style={{ background: "transparent", borderWidth: 0, boxShadow: "none" }}
        />
        {loading && <Loader2 size={14} className="mr-3 shrink-0 animate-spin" style={{ color: "var(--text-muted)" }} />}
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
              {/* Admin-configured quick picks */}
              {matchingSuggestions.length > 0 && (
                <>
                  <p className="px-3 pt-1.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>
                    ตัวเลือกที่กำหนดไว้
                  </p>
                  {matchingSuggestions.map((s) => (
                    <button
                      key={`sg-${s}`}
                      type="button"
                      onClick={() => commit(s)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer border-none text-[13px]"
                      style={{ background: value === s ? "var(--nav-active-bg)" : "transparent", color: "var(--text-primary)" }}
                    >
                      <Star size={13} className="shrink-0" style={{ color: "var(--nav-active-text)" }} />
                      <span className="truncate">{s}</span>
                    </button>
                  ))}
                </>
              )}

              {/* ORS search results */}
              {q.length >= 2 && (
                <>
                  <p className="px-3 pt-1.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-faint)" }}>
                    ผลการค้นหา
                  </p>
                  {loading && shownResults.length === 0 ? (
                    <p className="px-3 py-2 text-[12.5px]" style={{ color: "var(--text-muted)" }}>กำลังค้นหา...</p>
                  ) : shownResults.length === 0 ? (
                    <p className="px-3 py-2 text-[12.5px]" style={{ color: "var(--text-muted)" }}>ไม่พบผลลัพธ์</p>
                  ) : (
                    shownResults.map((r, i) => (
                      <button
                        key={`ors-${i}-${r.label}`}
                        type="button"
                        onClick={() => {
                          commit(r.label);
                          onSelectPlace?.(r);
                        }}
                        className="w-full flex items-start gap-2 px-3 py-2 text-left cursor-pointer border-none text-[13px]"
                        style={{ background: "transparent", color: "var(--text-primary)" }}
                      >
                        <MapPin size={13} className="shrink-0 mt-0.5" style={{ color: "var(--text-muted)" }} />
                        <span className="min-w-0">{r.label}</span>
                      </button>
                    ))
                  )}
                </>
              )}

              {/* Manual fallback — commit whatever was typed */}
              {showRawCommit && (
                <button
                  type="button"
                  onClick={() => commit(query)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer border-none text-[13px]"
                  style={{ background: "transparent", color: "var(--text-secondary)", borderTop: "1px solid var(--border-card)" }}
                >
                  <span className="truncate">ใช้ข้อความนี้: <b>{query}</b></span>
                </button>
              )}

              {matchingSuggestions.length === 0 && q.length < 2 && (
                <p className="px-3 py-2 text-[12.5px]" style={{ color: "var(--text-muted)" }}>
                  พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหา
                </p>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
