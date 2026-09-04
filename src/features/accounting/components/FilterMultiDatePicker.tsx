"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { fmtTravelDatesList } from "@/features/accounting/lib/format-travel-dates";

// The month arithmetic and Thai labels are shared with `SingleDatePicker`
// (AP-4's per-row expense date) rather than kept as a second copy here — see
// `thai-calendar.ts` for why. `parseYmd` is stricter than the local version it
// replaces: it refuses a day the month does not have, so a corrupt stored
// value now opens the panel on the current month instead of on a month that
// silently rolled forward.
import {
  TH_DAYS,
  TH_MONTHS,
  buildMonthCells,
  parseYmd,
  toYmd,
  todayYmd,
} from "@/features/accounting/lib/thai-calendar";

export interface FilterMultiDatePickerProps {
  label: string;
  /** Sorted YYYY-MM-DD values */
  selected: string[];
  onChange: (dates: string[]) => void;
  placeholder?: string;
  minDate?: string;
  maxDate?: string;
  /** Dates already used in other requests — cannot be newly selected */
  disabledDates?: string[];
  hasError?: boolean;
}

/** Calendar picker — toggle individual days on/off (non-consecutive OK). */
export function FilterMultiDatePicker({
  label,
  selected,
  onChange,
  placeholder = "เลือกวันที่เดินทาง...",
  minDate,
  maxDate,
  disabledDates = [],
  hasError = false,
}: FilterMultiDatePickerProps) {
  const [open, setOpen] = useState(false);
  const [panelRect, setPanelRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const disabledSet = useMemo(() => new Set(disabledDates), [disabledDates]);

  const initialMonth = useMemo(() => {
    const anchor = selected.length > 0 ? selected[selected.length - 1] : todayYmd();
    const parsed = parseYmd(anchor);
    if (parsed) return { year: parsed.year, month0: parsed.month0 };
    const now = new Date();
    return { year: now.getFullYear(), month0: now.getMonth() };
  }, [selected]);

  const [viewYear, setViewYear] = useState(initialMonth.year);
  const [viewMonth0, setViewMonth0] = useState(initialMonth.month0);

  useEffect(() => {
    setViewYear(initialMonth.year);
    setViewMonth0(initialMonth.month0);
  }, [initialMonth.year, initialMonth.month0]);

  const updatePanelRect = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPanelRect({
      top: rect.bottom + 4,
      left: rect.left,
      width: Math.min(window.innerWidth - 32, 300),
    });
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
    function onDoc(e: MouseEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const cells = useMemo(() => buildMonthCells(viewYear, viewMonth0), [viewYear, viewMonth0]);
  const display = fmtTravelDatesList(selected);
  const today = todayYmd();
  const now = new Date();
  const canGoNext =
    viewYear < now.getFullYear() ||
    (viewYear === now.getFullYear() && viewMonth0 < now.getMonth());

  function isDaySelectable(ymd: string): boolean {
    if (minDate && ymd < minDate) return false;
    if (maxDate && ymd > maxDate) return false;
    if (ymd > today) return false;
    if (disabledSet.has(ymd) && !selectedSet.has(ymd)) return false;
    return true;
  }

  function shiftMonth(delta: number) {
    if (delta > 0 && !canGoNext) return;
    const d = new Date(viewYear, viewMonth0 + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth0(d.getMonth());
  }

  function toggleDay(ymd: string) {
    if (!isDaySelectable(ymd) && !selectedSet.has(ymd)) return;
    if (selectedSet.has(ymd)) {
      onChange(selected.filter((d) => d !== ymd));
    } else {
      onChange(Array.from(new Set([...selected, ymd])).sort());
    }
  }

  function handleClear() {
    onChange([]);
  }

  function handleToday() {
    if (!isDaySelectable(today)) return;
    if (selectedSet.has(today)) return;
    onChange(Array.from(new Set([...selected, today])).sort());
  }

  const calendarPanel = open && panelRect ? (
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
      <div
        className="px-3 py-2 text-[12px]"
        style={{
          borderBottom: "1px solid var(--border-light)",
          color: "var(--text-muted)",
        }}
      >
        คลิกวันเพื่อเลือก/ยกเลิก · เลือกแล้ว {selected.length} วัน
        {disabledDates.length > 0 ? " · วันที่มีคำขอแล้วเลือกไม่ได้" : ""}
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
        <span className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>
          {TH_MONTHS[viewMonth0]} {viewYear}
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
            className="text-center text-[11px] font-bold py-1"
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
          const isSelected = selectedSet.has(ymd);
          const isToday = ymd === today;

          return (
            <button
              key={ymd}
              type="button"
              disabled={!selectable && !isSelected}
              onClick={() => toggleDay(ymd)}
              className="h-8 text-[12px] font-semibold tabular-nums transition-colors border-none rounded-lg"
              style={{
                background: isSelected
                  ? "var(--nav-active-text)"
                  : "transparent",
                color: !selectable && !isSelected
                  ? "var(--text-faint)"
                  : isSelected
                    ? "var(--bg-card)"
                    : "var(--text-primary)",
                cursor: selectable || isSelected ? "pointer" : "not-allowed",
                opacity: selectable || isSelected ? 1 : 0.35,
                boxShadow: isToday && !isSelected
                  ? "inset 0 0 0 1px var(--nav-active-text)"
                  : undefined,
              }}
            >
              {day}
            </button>
          );
        })}
      </div>

      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ borderTop: "1px solid var(--border-light)" }}
      >
        <button
          type="button"
          onClick={handleClear}
          className="text-[12px] font-medium cursor-pointer border-none bg-transparent"
          style={{ color: "var(--text-muted)" }}
        >
          ล้างทั้งหมด
        </button>
        <button
          type="button"
          onClick={handleToday}
          disabled={!isDaySelectable(today) || selectedSet.has(today)}
          className="text-[12px] font-semibold cursor-pointer border-none bg-transparent"
          style={{
            color: isDaySelectable(today) && !selectedSet.has(today)
              ? "var(--nav-active-text)"
              : "var(--text-faint)",
            cursor: isDaySelectable(today) && !selectedSet.has(today) ? "pointer" : "not-allowed",
            opacity: isDaySelectable(today) && !selectedSet.has(today) ? 1 : 0.45,
          }}
        >
          เพิ่มวันนี้
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div ref={rootRef} className="relative min-w-0">
      <span
        className="block text-[11px] font-semibold mb-1"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </span>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-[13px] px-2.5 py-2 rounded-lg outline-none flex items-center gap-2 cursor-pointer"
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

      {typeof document !== "undefined" && calendarPanel
        ? createPortal(calendarPanel, document.body)
        : null}
    </div>
  );
}
