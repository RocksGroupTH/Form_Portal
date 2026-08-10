"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { errLabelStyle, labelClass, requiredStar } from "./shared";

/**
 * Depart/return range picker (ข้อ6, ข้อ16). Matches AP-1's FilterMultiDatePicker look —
 * Thai weekdays, Buddhist-year month header, rose palette, portaled panel below — but
 * selects a start→end range (connected band) instead of independent days. ISO 'yyyy-mm-dd'
 * in/out, built with local getters (no toISOString). Stays open until closed manually.
 */

const TH_DAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"] as const;
const TH_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
] as const;

const pad = (n: number) => String(n).padStart(2, "0");
const toYmd = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;
function parseYmd(ymd: string): { year: number; month0: number } | null {
  const [ys, ms] = ymd.split("-");
  const year = Number(ys);
  const month0 = Number(ms) - 1;
  if (!year || month0 < 0 || month0 > 11) return null;
  return { year, month0 };
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
const fmtDisplay = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

export function DateRangeField({
  label,
  departDate,
  returnDate,
  onChange,
  hasError,
  continuationHint,
  minDate,
  maxDate,
  disabledDates,
  disabled,
  disabledHint,
}: {
  label: string;
  /** @deprecated retained for call-site compatibility. */
  startLabel?: string;
  endLabel?: string;
  departDate: string | null;
  returnDate: string | null;
  onChange: (next: { departDate: string | null; returnDate: string | null }) => void;
  hasError?: boolean;
  continuationHint?: string | null;
  /** Inclusive selectable bounds (YYYY-MM-DD); days outside are disabled. */
  minDate?: string | null;
  maxDate?: string | null;
  /** Specific days (YYYY-MM-DD) that cannot be selected — and a range may not span them. */
  disabledDates?: string[];
  /** Block opening the picker (e.g. until a prerequisite is set), showing `disabledHint`. */
  disabled?: boolean;
  disabledHint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [panelRect, setPanelRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Latest values/handler for closePicker (avoids stale closures inside listeners).
  const stateRef = useRef({ departDate, returnDate, onChange });
  stateRef.current = { departDate, returnDate, onChange };

  // Closing with only a start chosen commits it as a single-day trip (start = end).
  const closePicker = () => {
    const { departDate: d, returnDate: r, onChange: oc } = stateRef.current;
    if (d && !r) oc({ departDate: d, returnDate: d });
    setOpen(false);
  };

  const anchor = departDate ?? minDate ?? todayYmd();
  const initial = useMemo(() => parseYmd(anchor) ?? { year: new Date().getFullYear(), month0: new Date().getMonth() }, [anchor]);
  const [viewYear, setViewYear] = useState(initial.year);
  const [viewMonth0, setViewMonth0] = useState(initial.month0);

  // Re-anchor the view to the start date whenever it changes.
  useEffect(() => {
    setViewYear(initial.year);
    setViewMonth0(initial.month0);
  }, [initial.year, initial.month0]);

  const updatePanelRect = useCallback(() => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPanelRect({ top: r.bottom + 4, left: r.left, width: Math.min(window.innerWidth - 32, 300) });
  }, []);

  useEffect(() => {
    if (!open) {
      setPanelRect(null);
      return;
    }
    updatePanelRect();
    window.addEventListener("resize", updatePanelRect);
    window.addEventListener("scroll", updatePanelRect, true);
    return () => {
      window.removeEventListener("resize", updatePanelRect);
      window.removeEventListener("scroll", updatePanelRect, true);
    };
  }, [open, updatePanelRect]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      closePicker();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closePicker();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const cells = useMemo(() => buildMonthCells(viewYear, viewMonth0), [viewYear, viewMonth0]);
  const today = todayYmd();

  const inBounds = (ymd: string) => (!minDate || ymd >= minDate) && (!maxDate || ymd <= maxDate);
  const blockedSet = useMemo(() => new Set(disabledDates ?? []), [disabledDates]);
  const isDisabled = (ymd: string) => !inBounds(ymd) || blockedSet.has(ymd);
  // A locked day strictly inside the candidate range means it would overlap another trip.
  const rangeSpansBlocked = (a: string, b: string) => (disabledDates ?? []).some((d) => d > a && d < b);

  const pick = (ymd: string) => {
    if (isDisabled(ymd)) return;
    // Start a fresh range when nothing is chosen yet or a full range already exists.
    if (!departDate || returnDate) {
      onChange({ departDate: ymd, returnDate: null });
      return;
    }
    if (ymd >= departDate) {
      // Don't let the range straddle a locked (already-booked) day.
      if (rangeSpansBlocked(departDate, ymd)) return;
      onChange({ departDate, returnDate: ymd });
    } else {
      onChange({ departDate: ymd, returnDate: null }); // clicked before start → restart
    }
  };

  const shiftMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth0 + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth0(d.getMonth());
  };

  const display = (() => {
    if (!departDate) return "";
    if (returnDate) {
      return returnDate === departDate
        ? fmtDisplay(departDate) // single-day trip
        : `${fmtDisplay(departDate)}  –  ${fmtDisplay(returnDate)}`;
    }
    // Only a start chosen: show the "– …" hint while open, just the date once closed.
    return open ? `${fmtDisplay(departDate)}  –  …` : fmtDisplay(departDate);
  })();

  const hint = !departDate || returnDate ? "แตะเลือกวันเริ่มต้น" : "แตะเลือกวันสิ้นสุด";

  const panel = open && panelRect ? (
    <div
      ref={panelRef}
      className="rounded-xl overflow-hidden"
      style={{
        position: "fixed",
        top: panelRect.top,
        left: panelRect.left,
        width: panelRect.width,
        zIndex: 200,
        background: "var(--bg-card)",
        border: "1px solid var(--border-card)",
        boxShadow: "var(--shadow-md)",
      }}
    >
      {/* Hint line */}
      <div className="px-3 py-2 text-[12px]" style={{ borderBottom: "1px solid var(--border-light)", color: "var(--text-muted)" }}>
        {hint}
      </div>

      {/* Month nav */}
      <div className="flex items-center justify-between px-2 py-2">
        <button type="button" onClick={() => shiftMonth(-1)} className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border-none" style={{ background: "var(--bg-card-alt)", color: "var(--text-muted)" }} aria-label="เดือนก่อนหน้า">
          <ChevronLeft size={16} />
        </button>
        <span className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>
          {TH_MONTHS[viewMonth0]} {viewYear + 543}
        </span>
        <button type="button" onClick={() => shiftMonth(1)} className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border-none" style={{ background: "var(--bg-card-alt)", color: "var(--text-muted)" }} aria-label="เดือนถัดไป">
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-0.5 px-2">
        {TH_DAYS.map((d) => (
          <div key={d} className="text-center text-[11px] font-bold py-1" style={{ color: d === "อา" || d === "ส" ? "var(--text-faint)" : "var(--text-muted)" }}>
            {d}
          </div>
        ))}
      </div>

      {/* Days — connected range band; rose filled endpoints; today ring */}
      <div className="grid grid-cols-7 gap-y-1 px-2 pb-2">
        {cells.map((day, i) => {
          if (day == null) return <div key={`e-${i}`} className="h-8" />;
          const ymd = toYmd(viewYear, viewMonth0, day);
          const isStart = ymd === departDate;
          const isEnd = ymd === returnDate;
          const inRange = !!departDate && !!returnDate && ymd > departDate && ymd < returnDate;
          const isEndpoint = isStart || isEnd;
          const inBand = (isStart || isEnd || inRange) && !(isStart && isEnd);
          const col = i % 7;
          const roundL = isStart || col === 0;
          const roundR = isEnd || col === 6;
          const isToday = ymd === today;
          const disabled = isDisabled(ymd);
          return (
            <div key={ymd} className="relative h-8">
              {inBand && (
                <div
                  className="absolute inset-0"
                  style={{
                    background: "var(--nav-active-bg)",
                    borderTopLeftRadius: roundL ? 999 : 0,
                    borderBottomLeftRadius: roundL ? 999 : 0,
                    borderTopRightRadius: roundR ? 999 : 0,
                    borderBottomRightRadius: roundR ? 999 : 0,
                  }}
                />
              )}
              <button
                type="button"
                disabled={disabled}
                onClick={() => pick(ymd)}
                className="relative w-full h-full flex items-center justify-center border-none bg-transparent text-[12px] font-semibold tabular-nums"
                style={{ cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.3 : 1 }}
              >
                <span
                  className="w-8 h-8 flex items-center justify-center rounded-full"
                  style={{
                    background: isEndpoint ? "var(--nav-active-text)" : "transparent",
                    color: isEndpoint ? "var(--bg-card)" : "var(--text-primary)",
                    boxShadow: isToday && !isEndpoint && !inRange ? "inset 0 0 0 1px var(--nav-active-text)" : undefined,
                  }}
                >
                  {day}
                </span>
              </button>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-2" style={{ borderTop: "1px solid var(--border-light)" }}>
        <button
          type="button"
          onClick={() => onChange({ departDate: null, returnDate: null })}
          className="text-[12px] font-medium cursor-pointer border-none bg-transparent"
          style={{ color: "var(--text-muted)" }}
        >
          ล้าง
        </button>
        <button
          type="button"
          onClick={() => {
            const p = parseYmd(today);
            if (p) {
              setViewYear(p.year);
              setViewMonth0(p.month0);
            }
          }}
          className="text-[12px] font-semibold cursor-pointer border-none bg-transparent"
          style={{ color: "var(--nav-active-text)" }}
        >
          วันนี้
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div ref={rootRef}>
      <label className={labelClass} style={errLabelStyle(!!hasError)}>
        {label}{requiredStar}
      </label>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => (open ? closePicker() : setOpen(true))}
        className="w-full rounded-lg px-3 py-2 text-[14px] flex items-center gap-2.5 text-left disabled:cursor-not-allowed disabled:opacity-60"
        style={{
          background: "var(--bg-input)",
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: hasError ? "var(--color-danger)" : "var(--border-input)",
          boxShadow: hasError ? "0 0 0 1px var(--color-danger)" : undefined,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        <Calendar size={15} className="shrink-0" style={{ color: "var(--text-muted)" }} />
        <span className="flex-1 truncate tabular-nums" style={{ color: display ? "var(--text-primary)" : "var(--text-faint)" }}>
          {disabled ? (disabledHint ?? "—") : display || "เลือกช่วงวันที่ (เริ่ม–สิ้นสุด)"}
        </span>
      </button>

      {typeof document !== "undefined" && panel ? createPortal(panel, document.body) : null}

      {continuationHint && (
        <p className="text-[11px] mt-1.5" style={{ color: "var(--color-action)" }}>
          {continuationHint}
        </p>
      )}
    </div>
  );
}
