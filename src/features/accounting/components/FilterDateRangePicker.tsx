"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";

const TH_DAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"] as const;
const TH_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
] as const;

function fmtDisplay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

function toYmd(year: number, month0: number, day: number): string {
  return `${year}-${String(month0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseYmd(ymd: string): { year: number; month0: number; day: number } | null {
  const [ys, ms, ds] = ymd.split("-");
  const year = Number(ys);
  const month0 = Number(ms) - 1;
  const day = Number(ds);
  if (!year || month0 < 0 || month0 > 11 || !day) return null;
  return { year, month0, day };
}

function buildMonthCells(year: number, month0: number): (number | null)[] {
  const firstDow = new Date(year, month0, 1).getDay();
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  return cells;
}

function todayYmd(): string {
  const now = new Date();
  return toYmd(now.getFullYear(), now.getMonth(), now.getDate());
}

function orderedRange(from: string, to: string): { lo: string; hi: string } | null {
  if (!from) return null;
  const hi = to || from;
  return from <= hi ? { lo: from, hi } : { lo: hi, hi: from };
}

function formatRangeLabel(from: string, to: string): string {
  if (!from) return "";
  if (!to) return `${fmtDisplay(from)} – เลือกวันสิ้นสุด`;
  if (from === to) return fmtDisplay(from);
  const range = orderedRange(from, to);
  if (!range) return fmtDisplay(from);
  return `${fmtDisplay(range.lo)} – ${fmtDisplay(range.hi)}`;
}

export interface FilterDateRangePickerProps {
  label: string;
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  placeholder?: string;
  /** When true, future dates are selectable (e.g. payment date filter on reports). */
  allowFuture?: boolean;
  /** When set, only these YYYY-MM-DD values are selectable. */
  allowedDates?: string[];
  /** Inclusive min YYYY-MM-DD (e.g. travel form: 1 month ago). */
  minDate?: string;
  /** Inclusive max YYYY-MM-DD (e.g. travel form: today). */
  maxDate?: string;
  /** Highlight border when validation failed. */
  hasError?: boolean;
}

/** Single-field date range filter — pick start then end on one calendar. */
export function FilterDateRangePicker({
  label,
  from,
  to,
  onChange,
  placeholder = "เลือกช่วงวันที่...",
  allowFuture = false,
  allowedDates,
  minDate,
  maxDate,
  hasError = false,
}: FilterDateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [awaitingEnd, setAwaitingEnd] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  const allowed = useMemo(
    () => (allowedDates != null ? new Set(allowedDates) : null),
    [allowedDates],
  );

  const initialMonth = useMemo(() => {
    const anchor =
      from ||
      to ||
      (allowedDates && allowedDates.length > 0 ? allowedDates[allowedDates.length - 1] : "") ||
      todayYmd();
    const parsed = parseYmd(anchor);
    if (parsed) return { year: parsed.year, month0: parsed.month0 };
    const now = new Date();
    return { year: now.getFullYear(), month0: now.getMonth() };
  }, [from, to, allowedDates]);

  const [viewYear, setViewYear] = useState(initialMonth.year);
  const [viewMonth0, setViewMonth0] = useState(initialMonth.month0);

  useEffect(() => {
    setViewYear(initialMonth.year);
    setViewMonth0(initialMonth.month0);
  }, [initialMonth.year, initialMonth.month0]);

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(window.innerWidth - 16, Math.max(r.width, 300));
      let left = r.left;
      const overflow = left + width - window.innerWidth + 8;
      if (overflow > 0) left = Math.max(8, left - overflow);
      const panelHeight = 360;
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
  }, [open, viewYear, viewMonth0]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!from) setAwaitingEnd(false);
    else if (from && !to) setAwaitingEnd(true);
  }, [from, to]);

  const cells = useMemo(() => buildMonthCells(viewYear, viewMonth0), [viewYear, viewMonth0]);
  const range = from && to ? orderedRange(from, to) : null;
  const display = formatRangeLabel(from, to);
  const today = todayYmd();
  const now = new Date();
  const maxYear = now.getFullYear() + 5;
  const canGoNext = allowed
    ? true
    : allowFuture
      ? viewYear < maxYear || (viewYear === maxYear && viewMonth0 < 11)
      : viewYear < now.getFullYear() ||
        (viewYear === now.getFullYear() && viewMonth0 < now.getMonth());

  const monthHasAllowed = useMemo(() => {
    if (!allowed) return true;
    if (allowed.size === 0) return false;
    for (const d of Array.from(allowed)) {
      const p = parseYmd(d);
      if (p && p.year === viewYear && p.month0 === viewMonth0) return true;
    }
    return false;
  }, [allowed, viewYear, viewMonth0]);

  function isDaySelectable(ymd: string): boolean {
    if (minDate && ymd < minDate) return false;
    if (maxDate && ymd > maxDate) return false;
    if (allowed) return allowed.has(ymd);
    if (!allowFuture && ymd > today) return false;
    return true;
  }

  function shiftMonth(delta: number) {
    if (delta > 0 && !canGoNext) return;
    const d = new Date(viewYear, viewMonth0 + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth0(d.getMonth());
  }

  function handleDayClick(ymd: string) {
    if (!isDaySelectable(ymd)) return;
    if (!from || (from && to)) {
      onChange(ymd, "");
      setAwaitingEnd(true);
      return;
    }
    if (ymd < from) onChange(ymd, from);
    else onChange(from, ymd);
    setAwaitingEnd(false);
    setOpen(false);
  }

  function handleClear() {
    onChange("", "");
    setAwaitingEnd(false);
  }

  function handleToday() {
    const t = todayYmd();
    if (!isDaySelectable(t)) return;
    onChange(t, t);
    setAwaitingEnd(false);
  }

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
            color: awaitingEnd && from && !to ? "var(--nav-active-text)" : "var(--text-muted)",
          }}
        >
          {awaitingEnd && from && !to ? "เลือกวันสิ้นสุด" : "เลือกวันเริ่มต้น"}
        </div>

        <div className="flex items-center justify-between px-2 py-2">
          <button
            type="button"
            onClick={() => shiftMonth(-1)}
            className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border-none"
            style={{ background: "var(--bg-card-alt)", color: "var(--text-muted)" }}
            aria-label="เดือนก่อนหน้า"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-[12px] font-bold" style={{ color: "var(--text-heading)" }}>
            {TH_MONTHS[viewMonth0]} {viewYear + 543}
          </span>
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            disabled={!canGoNext}
            className="w-8 h-8 rounded-lg flex items-center justify-center border-none"
            style={{
              background: "var(--bg-card-alt)",
              color: "var(--text-muted)",
              cursor: canGoNext ? "pointer" : "not-allowed",
              opacity: canGoNext ? 1 : 0.4,
            }}
            aria-label="เดือนถัดไป"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-0.5 px-2">
          {TH_DAYS.map((d) => (
            <div
              key={d}
              className="text-center text-[10px] font-bold py-1"
              style={{ color: d === "อา" || d === "ส" ? "var(--text-faint)" : "var(--text-muted)" }}
            >
              {d}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-0.5 px-2 pb-2">
          {cells.map((day, i) => {
            if (day == null) {
              return <div key={`e-${i}`} className="h-8" />;
            }
            const ymd = toYmd(viewYear, viewMonth0, day);
            const selectable = isDaySelectable(ymd);
            const inRange = range ? ymd >= range.lo && ymd <= range.hi : false;
            const isStart = from === ymd;
            const isEnd = to ? range?.hi === ymd : false;
            const isToday = ymd === today;
            const hasData = allowed?.has(ymd) ?? false;

            return (
              <button
                key={ymd}
                type="button"
                disabled={!selectable}
                onClick={() => handleDayClick(ymd)}
                className="h-8 text-[11px] font-semibold tabular-nums transition-colors border-none"
                style={{
                  borderRadius: isStart && isEnd
                    ? "8px"
                    : isStart
                      ? "8px 0 0 8px"
                      : isEnd
                        ? "0 8px 8px 0"
                        : inRange
                          ? "0"
                          : "8px",
                  background: isStart || isEnd
                    ? "var(--nav-active-text)"
                    : inRange
                      ? "color-mix(in srgb, var(--nav-active-bg) 75%, transparent)"
                      : hasData
                        ? "var(--nav-active-bg)"
                        : "transparent",
                  color: !selectable
                    ? "var(--text-faint)"
                    : isStart || isEnd
                      ? "var(--bg-card)"
                      : inRange || hasData
                        ? "var(--nav-active-text)"
                        : "var(--text-primary)",
                  cursor: selectable ? "pointer" : "not-allowed",
                  opacity: selectable ? 1 : 0.35,
                  boxShadow: isToday && !inRange && selectable
                    ? "inset 0 0 0 1px var(--nav-active-text)"
                    : undefined,
                }}
              >
                {day}
              </button>
            );
          })}
        </div>

        {allowed && !monthHasAllowed && (
          <p className="text-[10px] text-center px-3 pb-2 m-0" style={{ color: "var(--text-faint)" }}>
            ไม่มีวันจ่ายในเดือนนี้ — เลื่อนดูเดือนอื่น
          </p>
        )}

        {allowed && allowed.size === 0 && (
          <p className="text-[10px] text-center px-3 pb-2 m-0" style={{ color: "var(--text-faint)" }}>
            ไม่มีวันจ่ายในข้อมูล
          </p>
        )}

        <div
          className="flex items-center justify-between px-3 py-2"
          style={{ borderTop: "1px solid var(--border-light)" }}
        >
          <button
            type="button"
            onClick={handleClear}
            className="text-[11px] font-medium cursor-pointer border-none bg-transparent"
            style={{ color: "var(--text-muted)" }}
          >
            ล้าง
          </button>
          <button
            type="button"
            onClick={handleToday}
            disabled={!isDaySelectable(today)}
            className="text-[11px] font-semibold cursor-pointer border-none bg-transparent"
            style={{
              color: isDaySelectable(today) ? "var(--nav-active-text)" : "var(--text-faint)",
              cursor: isDaySelectable(today) ? "pointer" : "not-allowed",
              opacity: isDaySelectable(today) ? 1 : 0.45,
            }}
          >
            วันนี้
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
          border: hasError
            ? "1px solid var(--color-danger)"
            : "1px solid var(--border-input)",
          boxShadow: hasError ? "0 0 0 1px var(--color-danger)" : undefined,
        }}
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
