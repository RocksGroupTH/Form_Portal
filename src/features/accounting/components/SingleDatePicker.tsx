"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import {
  TH_DAYS,
  TH_MONTHS,
  addMonths,
  buildMonthCells,
  formatThaiYmd,
  parseYmd,
  displayYear,
  toYmd,
  todayYmd,
} from "@/features/accounting/lib/thai-calendar";

/**
 * One day, in a Thai calendar with Gregorian years — the single-select
 * counterpart to `FilterMultiDatePicker`, which AP-1's form uses for its
 * multi-day travel dates.
 *
 * It exists because a native `input type="date"` renders in the browser's own
 * locale: a Thai user reading an AP-4 expense row saw "dd/mm/yyyy" and
 * "August 2026" beside AP-1's "สิงหาคม 2026". The month arithmetic and the
 * labels are shared with the multi picker through
 * `@/features/accounting/lib/thai-calendar` rather than copied, so the two
 * calendars cannot come to disagree about, say, a leap year.
 *
 * **No built-in "not in the future" rule**, unlike the multi picker. AP-1
 * enforces that because a travel claim is filed after the trip; AP-4's expense
 * date has never been bounded — not by the native input this replaces, and not
 * by `prepareReimburseItemsForSave` — and quietly adding a rule while changing
 * a control's appearance is how a form starts refusing work it used to accept.
 * A caller that wants the bound passes `maxDate`.
 */
export interface SingleDatePickerProps {
  /** `YYYY-MM-DD`, or "" for empty. */
  value: string;
  onChange: (ymd: string) => void;
  /** Rendered above the trigger. Omit inside a grid that labels its own columns. */
  label?: string;
  placeholder?: string;
  /** Inclusive bounds, `YYYY-MM-DD`. Compared as strings — both sides are zero-padded. */
  minDate?: string;
  maxDate?: string;
  hasError?: boolean;
  disabled?: boolean;
  /** Announced to screen readers; the trigger is a button, not an input. */
  ariaLabel?: string;
}

export function SingleDatePicker({
  value,
  onChange,
  label,
  placeholder = "เลือกวันที่...",
  minDate,
  maxDate,
  hasError = false,
  disabled = false,
  ariaLabel,
}: SingleDatePickerProps) {
  const [open, setOpen] = useState(false);
  const [panelRect, setPanelRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const today = todayYmd();

  // The month the panel opens on: the chosen day, else today. Derived from
  // `value` so re-opening after a pick lands where the user left off.
  const anchor = useMemo(() => {
    const parsed = parseYmd(value) ?? parseYmd(today);
    return parsed
      ? { year: parsed.year, month0: parsed.month0 }
      : { year: new Date().getFullYear(), month0: new Date().getMonth() };
  }, [value, today]);

  const [viewYear, setViewYear] = useState(anchor.year);
  const [viewMonth0, setViewMonth0] = useState(anchor.month0);

  useEffect(() => {
    setViewYear(anchor.year);
    setViewMonth0(anchor.month0);
  }, [anchor.year, anchor.month0]);

  const updatePanelRect = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const width = Math.min(window.innerWidth - 32, 300);
    setPanelRect({
      top: rect.bottom + 4,
      // Kept on screen: a row's date cell can sit close enough to the right
      // edge that a 300px panel anchored to it would overflow the viewport.
      left: Math.max(16, Math.min(rect.left, window.innerWidth - width - 16)),
      width,
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
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const cells = useMemo(() => buildMonthCells(viewYear, viewMonth0), [viewYear, viewMonth0]);

  function isSelectable(ymd: string): boolean {
    if (minDate && ymd < minDate) return false;
    if (maxDate && ymd > maxDate) return false;
    return true;
  }

  function shiftMonth(delta: number) {
    const next = addMonths(viewYear, viewMonth0, delta);
    setViewYear(next.year);
    setViewMonth0(next.month0);
  }

  function pick(ymd: string) {
    if (!isSelectable(ymd)) return;
    onChange(ymd);
    // Closes on pick — one day is the whole answer, unlike the multi picker,
    // where the panel has to stay up to collect the rest.
    setOpen(false);
  }

  const display = formatThaiYmd(value);

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
          {TH_MONTHS[viewMonth0]} {displayYear(viewYear)}
        </span>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border-none"
          style={{ background: "var(--bg-card-alt)", color: "var(--text-muted)" }}
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
          if (day == null) return <div key={`e-${i}`} className="h-8" />;
          const ymd = toYmd(viewYear, viewMonth0, day);
          const selectable = isSelectable(ymd);
          const isSelected = ymd === value;
          const isToday = ymd === today;
          return (
            <button
              key={ymd}
              type="button"
              disabled={!selectable}
              onClick={() => pick(ymd)}
              className="h-8 text-[12px] font-semibold tabular-nums transition-colors border-none rounded-lg"
              style={{
                background: isSelected ? "var(--nav-active-text)" : "transparent",
                color: !selectable
                  ? "var(--text-faint)"
                  : isSelected
                    ? "var(--bg-card)"
                    : "var(--text-primary)",
                cursor: selectable ? "pointer" : "not-allowed",
                opacity: selectable ? 1 : 0.35,
                boxShadow: isToday && !isSelected ? "inset 0 0 0 1px var(--nav-active-text)" : undefined,
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
          onClick={() => {
            onChange("");
            setOpen(false);
          }}
          className="text-[12px] font-medium cursor-pointer border-none bg-transparent"
          style={{ color: "var(--text-muted)" }}
        >
          ล้าง
        </button>
        <button
          type="button"
          onClick={() => pick(today)}
          disabled={!isSelectable(today)}
          className="text-[12px] font-semibold border-none bg-transparent"
          style={{
            color: isSelectable(today) ? "var(--nav-active-text)" : "var(--text-faint)",
            cursor: isSelectable(today) ? "pointer" : "not-allowed",
            opacity: isSelectable(today) ? 1 : 0.45,
          }}
        >
          วันนี้
        </button>
      </div>
    </div>
  ) : null;

  return (
    <div ref={rootRef} className="relative min-w-0">
      {label && (
        <span className="block text-[11px] font-semibold mb-1" style={{ color: "var(--text-muted)" }}>
          {label}
        </span>
      )}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        className="w-full rounded-lg px-3 py-2 text-[14px] outline-none flex items-center gap-2 disabled:opacity-60"
        style={{
          background: "var(--bg-input)",
          color: display ? "var(--text-primary)" : "var(--text-muted)",
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: hasError ? "var(--color-danger)" : "var(--border-input)",
          boxShadow: hasError ? "0 0 0 1px var(--color-danger)" : undefined,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      >
        <Calendar size={14} className="shrink-0" style={{ color: "var(--text-muted)" }} />
        <span className="truncate text-left flex-1 tabular-nums">{display || placeholder}</span>
      </button>

      {typeof document !== "undefined" && panel ? createPortal(panel, document.body) : null}
    </div>
  );
}
