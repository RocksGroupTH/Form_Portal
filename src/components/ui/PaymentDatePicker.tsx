"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";

interface PaymentDatePickerProps {
  value: string;
  onChange: (date: string) => void;
  allowedDates: string[]; // YYYY-MM-DD
}

const DAY_HEADERS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const MONTHS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

export function PaymentDatePicker({ value, onChange, allowedDates }: PaymentDatePickerProps) {
  const [open, setOpen] = useState(false);
  const [popupPos, setPopupPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const seed = value || allowedDates[0] || "";
  const [year, setYear] = useState(() => seed ? parseInt(seed.slice(0, 4)) : new Date().getFullYear());
  const [month, setMonth] = useState(() => seed ? parseInt(seed.slice(5, 7)) - 1 : new Date().getMonth());

  const calcPos = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    // position: fixed uses viewport coords — no scrollY/scrollX offset needed
    const popupH = 300;
    const fitsBelow = r.bottom + popupH + 4 < window.innerHeight;
    setPopupPos({
      top: fitsBelow ? r.bottom + 4 : r.top - popupH - 4,
      left: r.left,
    });
  }, []);

  function openPicker() {
    calcPos();
    setOpen(o => !o);
  }

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (
        btnRef.current && btnRef.current.contains(e.target as Node)
      ) return;
      if (
        popupRef.current && !popupRef.current.contains(e.target as Node)
      ) setOpen(false);
    }
    function onScroll() { calcPos(); }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, calcPos]);

  const allowedSet = new Set(allowedDates);

  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = Array.from({ length: firstDow }, () => null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  function ymd(d: number) {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  function prev() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }
  function next() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }

  function label() {
    if (!value) return "— เลือกวันจ่าย —";
    const d = new Date(value + "T00:00:00");
    return `${d.getDate()} ${MONTHS_TH[d.getMonth()]} ${d.getFullYear() + 543}`;
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={openPicker}
        className="text-[13px] px-2 py-1 rounded-lg flex items-center gap-1.5"
        style={{
          background: "var(--bg-card)",
          color: value ? "var(--text-primary)" : "var(--text-muted)",
          border: "1px solid var(--border-card)",
          minWidth: 148,
        }}
      >
        <CalendarDays size={13} />
        {label()}
      </button>

      {open && (
        <div
          ref={popupRef}
          className="rounded-xl shadow-lg p-3 w-[224px]"
          style={{
            position: "fixed",
            top: popupPos.top,
            left: popupPos.left,
            zIndex: 9999,
            background: "var(--bg-card)",
            border: "1px solid var(--border-card)",
          }}
        >
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={prev} className="p-1 rounded hover:opacity-70" style={{ color: "var(--text-muted)" }}>
              <ChevronLeft size={14} />
            </button>
            <span className="text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>
              {MONTHS_TH[month]} {year + 543}
            </span>
            <button type="button" onClick={next} className="p-1 rounded hover:opacity-70" style={{ color: "var(--text-muted)" }}>
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Day-of-week headers */}
          <div className="grid grid-cols-7 mb-1">
            {DAY_HEADERS.map(h => (
              <div key={h} className="text-center text-[10px] font-semibold py-0.5" style={{ color: "var(--text-muted)" }}>{h}</div>
            ))}
          </div>

          {/* Date cells */}
          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((d, i) => {
              if (d === null) return <div key={i} />;
              const dateStr = ymd(d);
              const allowed = allowedSet.has(dateStr);
              const selected = dateStr === value;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={!allowed}
                  onClick={() => { onChange(dateStr); setOpen(false); }}
                  className="text-[11px] h-7 w-full rounded-lg font-medium"
                  style={{
                    background: selected ? "var(--nav-active-bg)" : "transparent",
                    color: selected ? "var(--nav-active-text)" : allowed ? "var(--text-primary)" : "var(--text-muted)",
                    opacity: allowed ? 1 : 0.25,
                    cursor: allowed ? "pointer" : "default",
                  }}
                >
                  {d}
                </button>
              );
            })}
          </div>

          <div className="mt-2 pt-2" style={{ borderTop: "1px solid var(--border-card)" }}>
            <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>เฉพาะวันจ่ายที่กำหนด (ศุกร์ที่ 2/4 ของเดือน)</p>
          </div>
        </div>
      )}
    </>
  );
}
