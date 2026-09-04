"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";

const TH_MONTHS = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
] as const;

const TH_MONTH_NAMES = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
] as const;

function toYm(year: number, month0: number): string {
  return `${year}-${String(month0 + 1).padStart(2, "0")}`;
}

function parseYm(ym: string): { year: number; month0: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month0 = Number(m[2]) - 1;
  if (!year || month0 < 0 || month0 > 11) return null;
  return { year, month0 };
}

export function fmtSentMonthLabel(ym: string): string {
  const parsed = parseYm(ym);
  if (!parsed) return ym;
  return `${TH_MONTH_NAMES[parsed.month0]} ${parsed.year}`;
}

function currentYm(): string {
  const now = new Date();
  return toYm(now.getFullYear(), now.getMonth());
}

function isFutureMonth(year: number, month0: number): boolean {
  const now = new Date();
  const cy = now.getFullYear();
  const cm = now.getMonth();
  return year > cy || (year === cy && month0 > cm);
}

export interface FilterMonthPickerProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Months with sent data — highlighted in the grid. */
  availableMonths?: string[];
  /** Quick jump to latest month (e.g. newest sent batch). */
  latestMonth?: string;
}

/** Month-only filter — pick year and month on a calendar-style panel. */
export function FilterMonthPicker({
  label,
  value,
  onChange,
  placeholder = "เลือกเดือน...",
  availableMonths,
  latestMonth,
}: FilterMonthPickerProps) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  const available = useMemo(
    () => (availableMonths != null ? new Set(availableMonths) : null),
    [availableMonths],
  );

  const initialView = useMemo(() => {
    const anchor = value || latestMonth || currentYm();
    const parsed = parseYm(anchor);
    if (parsed) return parsed;
    const now = new Date();
    return { year: now.getFullYear(), month0: now.getMonth() };
  }, [value, latestMonth]);

  const [viewYear, setViewYear] = useState(initialView.year);

  useEffect(() => {
    setViewYear(initialView.year);
  }, [initialView.year]);

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(window.innerWidth - 16, Math.max(r.width, 280));
      let left = r.left;
      const overflow = left + width - window.innerWidth + 8;
      if (overflow > 0) left = Math.max(8, left - overflow);
      const panelHeight = 320;
      let top = r.bottom + 4;
      if (top + panelHeight > window.innerHeight - 8) {
        top = Math.max(8, r.top - panelHeight - 4);
      }
      setCoords({ top, left, width });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, viewYear]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    }
    // Defer so the opening click does not immediately close the panel.
    const id = window.setTimeout(() => {
      document.addEventListener("mousedown", onDoc);
    }, 0);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const parsed = parseYm(value || latestMonth || currentYm());
    if (parsed) setViewYear(parsed.year);
  }, [open, value, latestMonth]);

  const display = value ? fmtSentMonthLabel(value) : "";
  const now = new Date();
  const maxYear = now.getFullYear();
  const canGoNextYear = viewYear < maxYear;

  function shiftYear(delta: number) {
    if (delta > 0 && !canGoNextYear) return;
    setViewYear((y) => y + delta);
  }

  function handleMonthClick(month0: number) {
    if (isFutureMonth(viewYear, month0)) return;
    onChange(toYm(viewYear, month0));
    setOpen(false);
  }

  function handleLatest() {
    if (!latestMonth) return;
    onChange(latestMonth);
    const parsed = parseYm(latestMonth);
    if (parsed) setViewYear(parsed.year);
    setOpen(false);
  }

  const yearHasAvailable = useMemo(() => {
    if (!available || available.size === 0) return false;
    for (const ym of Array.from(available)) {
      const p = parseYm(ym);
      if (p && p.year === viewYear) return true;
    }
    return false;
  }, [available, viewYear]);

  const calendarPanel =
    open && coords ? (
      <div
        ref={panelRef}
        className="rounded-xl overflow-hidden"
        style={{
          position: "fixed",
          top: coords.top,
          left: coords.left,
          width: coords.width,
          zIndex: 9999,
          background: "var(--bg-card)",
          border: "1px solid var(--border-card)",
          boxShadow: "var(--shadow-md)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="px-3 py-2 text-[11px]"
          style={{
            borderBottom: "1px solid var(--border-light)",
            color: "var(--text-muted)",
          }}
        >
          เลือกปีและเดือน
        </div>

        <div className="flex items-center justify-between px-2 py-2">
          <button
            type="button"
            onClick={() => shiftYear(-1)}
            className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border-none"
            style={{ background: "var(--bg-card-alt)", color: "var(--text-muted)" }}
            aria-label="ปีก่อนหน้า"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-[13px] font-bold tabular-nums" style={{ color: "var(--text-heading)" }}>
            {viewYear}
          </span>
          <button
            type="button"
            onClick={() => shiftYear(1)}
            disabled={!canGoNextYear}
            className="w-8 h-8 rounded-lg flex items-center justify-center border-none"
            style={{
              background: "var(--bg-card-alt)",
              color: "var(--text-muted)",
              cursor: canGoNextYear ? "pointer" : "not-allowed",
              opacity: canGoNextYear ? 1 : 0.4,
            }}
            aria-label="ปีถัดไป"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="grid grid-cols-4 gap-1.5 px-3 pb-2">
          {TH_MONTHS.map((label, month0) => {
            const ym = toYm(viewYear, month0);
            const selectable = !isFutureMonth(viewYear, month0);
            const selected = value === ym;
            const hasData = available?.has(ym) ?? false;
            const isCurrent =
              viewYear === now.getFullYear() && month0 === now.getMonth();

            return (
              <button
                key={ym}
                type="button"
                disabled={!selectable}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleMonthClick(month0);
                }}
                className="py-2.5 text-[11px] font-semibold transition-colors border-none rounded-lg"
                style={{
                  background: selected
                    ? "var(--nav-active-text)"
                    : hasData
                      ? "var(--nav-active-bg)"
                      : "var(--bg-card-alt)",
                  color: !selectable
                    ? "var(--text-faint)"
                    : selected
                      ? "var(--bg-card)"
                      : hasData
                        ? "var(--nav-active-text)"
                        : "var(--text-primary)",
                  cursor: selectable ? "pointer" : "not-allowed",
                  opacity: selectable ? 1 : 0.35,
                  boxShadow: isCurrent && !selected && selectable
                    ? "inset 0 0 0 1px var(--nav-active-text)"
                    : undefined,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {available && !yearHasAvailable && (
          <p className="text-[10px] text-center px-3 pb-2 m-0" style={{ color: "var(--text-faint)" }}>
            ไม่มีรายการส่งในปีนี้ — เลือกปีอื่น
          </p>
        )}

        <div
          className="flex items-center justify-between px-3 py-2"
          style={{ borderTop: "1px solid var(--border-light)" }}
        >
          {latestMonth ? (
            <button
              type="button"
              onClick={handleLatest}
              className="text-[11px] font-semibold cursor-pointer border-none bg-transparent"
              style={{ color: "var(--nav-active-text)" }}
            >
              เดือนล่าสุด
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-[11px] font-medium cursor-pointer border-none bg-transparent"
            style={{ color: "var(--text-muted)" }}
          >
            ปิด
          </button>
        </div>
      </div>
    ) : null;

  return (
    <div className="relative min-w-0">
      <span
        className="block text-[10px] font-semibold mb-1"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </span>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-[12px] px-2.5 py-2 rounded-lg outline-none flex items-center gap-2 cursor-pointer"
        style={{
          background: "var(--bg-input)",
          color: display ? "var(--text-primary)" : "var(--text-muted)",
          border: "1px solid var(--border-input)",
        }}
        aria-label={label}
      >
        <Calendar size={14} className="shrink-0" style={{ color: "var(--text-muted)" }} />
        <span className="truncate text-left flex-1 tabular-nums">
          {display || placeholder}
        </span>
      </button>

      {mounted && calendarPanel ? createPortal(calendarPanel, document.body) : null}
    </div>
  );
}
