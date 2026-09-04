"use client";

import { useEffect, useMemo, useState } from "react";
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

/** The footnote under the grid when the caller does not name its own rounds. */
const AP1_ROUNDS_HINT = "วันจ่าย: ศุกร์ที่ 2 และ 4 ของเดือน (เลื่อนกลับ 1 วันถ้าตรงวันหยุด)";

export interface PaymentDatePickerProps {
  dates: string[];
  value: string;
  onChange: (ymd: string) => void;
  loading?: boolean;
  /**
   * Which rounds these dates are, in words.
   *
   * The grid itself is round-agnostic — it offers exactly `dates` and nothing
   * else — but the footnote was AP-1's wording hard-coded. AP-4 pays on the 1st
   * and 3rd Friday, so it passes its own; the default keeps every existing
   * caller identical.
   */
  hint?: string;
}

/** Calendar limited to the payment dates the caller offers (holiday-adjusted server-side). */
export function PaymentDatePicker({
  dates,
  value,
  onChange,
  loading,
  hint = AP1_ROUNDS_HINT,
}: PaymentDatePickerProps) {
  const allowed = useMemo(() => new Set(dates), [dates]);

  const initialMonth = useMemo(() => {
    const fromValue = value ? parseYmd(value) : null;
    if (fromValue) return { year: fromValue.year, month0: fromValue.month0 };
    const fromFirst = dates[0] ? parseYmd(dates[0]) : null;
    if (fromFirst) return { year: fromFirst.year, month0: fromFirst.month0 };
    const now = new Date();
    return { year: now.getFullYear(), month0: now.getMonth() };
  }, [value, dates]);

  const [viewYear, setViewYear] = useState(initialMonth.year);
  const [viewMonth0, setViewMonth0] = useState(initialMonth.month0);

  useEffect(() => {
    setViewYear(initialMonth.year);
    setViewMonth0(initialMonth.month0);
  }, [initialMonth.year, initialMonth.month0]);

  const cells = useMemo(() => buildMonthCells(viewYear, viewMonth0), [viewYear, viewMonth0]);

  const monthHasDates = useMemo(() => {
    return dates.some((d) => {
      const p = parseYmd(d);
      return p && p.year === viewYear && p.month0 === viewMonth0;
    });
  }, [dates, viewYear, viewMonth0]);

  function shiftMonth(delta: number) {
    const d = new Date(viewYear, viewMonth0 + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth0(d.getMonth());
  }

  if (loading) {
    return (
      <div
        className="rounded-xl px-4 py-8 text-center text-[12px] max-w-[320px] mx-auto w-full"
        style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)", color: "var(--text-muted)" }}
      >
        กำลังโหลดวันที่จ่าย...
      </div>
    );
  }

  if (dates.length === 0) {
    return (
      <div
        className="rounded-xl px-4 py-6 text-center text-[12px] max-w-[320px] mx-auto w-full"
        style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)", color: "var(--text-muted)" }}
      >
        ไม่พบวันที่จ่ายที่กำหนด
      </div>
    );
  }

  return (
    <div
      className="rounded-xl overflow-hidden max-w-[320px] mx-auto w-full"
      style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
    >
      {/* Selected summary */}
      <div
        className="flex items-center gap-2.5 px-3.5 py-2.5"
        style={{ borderBottom: "1px solid var(--border-light)", background: "var(--bg-card)" }}
      >
        <span
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
        >
          <Calendar size={16} />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide m-0" style={{ color: "var(--text-muted)" }}>
            วันที่เลือก
          </p>
          <p className="text-[14px] font-bold m-0 tabular-nums" style={{ color: "var(--text-heading)" }}>
            {value ? fmtDisplay(value) : "— เลือกวันที่ —"}
          </p>
        </div>
      </div>

      {/* Month nav */}
      <div className="flex items-center justify-between px-2 py-2">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border-none"
          style={{ background: "var(--bg-card)", color: "var(--text-muted)", border: "1px solid var(--border-light)" }}
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
          className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border-none"
          style={{ background: "var(--bg-card)", color: "var(--text-muted)", border: "1px solid var(--border-light)" }}
          aria-label="เดือนถัดไป"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Day headers */}
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

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-0.5 px-2 pb-3">
        {cells.map((day, i) => {
          if (day == null) {
            return <div key={`e-${i}`} className="h-9" />;
          }
          const ymd = toYmd(viewYear, viewMonth0, day);
          const isAllowed = allowed.has(ymd);
          const isSelected = value === ymd;
          const isToday = ymd === toYmd(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

          return (
            <button
              key={ymd}
              type="button"
              disabled={!isAllowed}
              onClick={() => isAllowed && onChange(ymd)}
              className="h-9 rounded-lg text-[12px] font-semibold tabular-nums transition-colors border-none"
              style={{
                background: isSelected
                  ? "var(--nav-active-text)"
                  : isAllowed
                    ? "var(--nav-active-bg)"
                    : "transparent",
                color: isSelected
                  ? "var(--bg-card)"
                  : isAllowed
                    ? "var(--nav-active-text)"
                    : "var(--text-faint)",
                cursor: isAllowed ? "pointer" : "default",
                opacity: isAllowed ? 1 : 0.35,
                boxShadow: isToday && !isSelected && isAllowed
                  ? "inset 0 0 0 1px var(--nav-active-text)"
                  : undefined,
              }}
            >
              {day}
            </button>
          );
        })}
      </div>

      {!monthHasDates && (
        <p className="text-[10px] text-center px-3 pb-3 m-0" style={{ color: "var(--text-faint)" }}>
          ไม่มีวันจ่ายในเดือนนี้ — เลื่อนดูเดือนอื่น
        </p>
      )}

      <p className="text-[10px] text-center px-3 pb-3 m-0" style={{ color: "var(--text-faint)" }}>
        {hint}
      </p>
    </div>
  );
}
