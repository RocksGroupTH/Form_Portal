"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";

interface DateRangePickerProps {
  startDate: string;
  endDate: string;
  onChange: (start: string, end: string) => void;
  minDate?: string;
  maxDays?: number;
  disabled?: boolean;
}

const MONTHS_TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const DAY_HEADERS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

function addDays(ymd: string, n: number): string {
  const d = new Date(ymd + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function DateRangePicker({ startDate, endDate, onChange, minDate, maxDays, disabled }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [popupPos, setPopupPos] = useState({ top: 0, left: 0 });
  const [hover, setHover] = useState("");
  const [picking, setPicking] = useState<"start" | "end">("start");
  const [draft, setDraft] = useState({ start: startDate, end: endDate });

  const seed = startDate || minDate || "";
  const [year, setYear] = useState(() => seed ? parseInt(seed.slice(0, 4)) : new Date().getFullYear());
  const [month, setMonth] = useState(() => seed ? parseInt(seed.slice(5, 7)) - 1 : new Date().getMonth());

  const btnRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const calcPos = useCallback(() => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const popupH = 320;
    const fitsBelow = r.bottom + popupH + 4 < window.innerHeight;
    setPopupPos({ top: fitsBelow ? r.bottom + 4 : r.top - popupH - 4, left: r.left });
  }, []);

  function openPicker() {
    if (disabled) return;
    calcPos();
    setDraft({ start: startDate, end: endDate });
    setPicking(startDate ? "end" : "start");
    setHover("");
    setOpen(o => !o);
  }

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (!popupRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onScroll() { calcPos(); }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, calcPos]);

  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = Array.from({ length: firstDow }, () => null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  function ymd(d: number) {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  function dayDisabled(dateStr: string): boolean {
    if (minDate && dateStr < minDate) return true;
    if (picking === "end" && draft.start) {
      if (dateStr < draft.start) return true;
      if (maxDays !== undefined && dateStr > addDays(draft.start, maxDays)) return true;
    }
    return false;
  }

  function effectiveEnd(): string {
    return picking === "end" ? (hover || draft.end) : draft.end;
  }

  function inRange(dateStr: string): boolean {
    const s = draft.start;
    const e = effectiveEnd();
    return !!s && !!e && dateStr > s && dateStr < e;
  }

  function handleClick(d: number) {
    const dateStr = ymd(d);
    if (dayDisabled(dateStr)) return;
    if (picking === "start") {
      setDraft({ start: dateStr, end: "" });
      setPicking("end");
    } else {
      if (dateStr < draft.start) {
        setDraft({ start: dateStr, end: "" });
        setPicking("end");
      } else {
        onChange(draft.start, dateStr);
        setOpen(false);
      }
    }
  }

  function label() {
    const fmt = (s: string) => {
      const d = new Date(s + "T00:00:00");
      return `${d.getDate()} ${MONTHS_TH[d.getMonth()]}`;
    };
    if (startDate && endDate) {
      const days = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000);
      return `${fmt(startDate)} → ${fmt(endDate)}  (${days} วัน)`;
    }
    if (startDate) return `${fmt(startDate)} → ...`;
    return "— เลือกช่วงวัน —";
  }

  function prev() { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); }
  function next() { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); }

  return (
    <>
      <button ref={btnRef} type="button" onClick={openPicker} disabled={disabled}
        className="text-[13px] px-3 py-2 rounded-xl flex items-center gap-2 w-full"
        style={{
          background: "var(--bg-input, var(--bg-card))",
          color: (startDate && endDate) ? "var(--text-primary)" : "var(--text-muted)",
          border: "1px solid var(--border-card)",
        }}>
        <CalendarDays size={14} className="shrink-0" />
        <span className="truncate">{label()}</span>
      </button>

      {open && (
        <div ref={popupRef} className="rounded-xl shadow-lg p-3 w-[260px]"
          style={{ position: "fixed", top: popupPos.top, left: popupPos.left, zIndex: 9999,
            background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>

          <p className="text-[10px] text-center mb-2 font-semibold" style={{ color: "var(--nav-active-text)", background: "var(--nav-active-bg)", borderRadius: 6, padding: "2px 0" }}>
            {picking === "start" ? "คลิกเลือก วันเริ่มต้น" : "คลิกเลือก วันสิ้นสุด"}
          </p>

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

          <div className="grid grid-cols-7 mb-1">
            {DAY_HEADERS.map(h => (
              <div key={h} className="text-center text-[10px] font-semibold py-0.5" style={{ color: "var(--text-muted)" }}>{h}</div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {cells.map((d, i) => {
              if (d === null) return <div key={i} />;
              const dateStr = ymd(d);
              const dis = dayDisabled(dateStr);
              const isS = dateStr === draft.start;
              const isE = dateStr === effectiveEnd();
              const range = inRange(dateStr);
              return (
                <button key={i} type="button" disabled={dis}
                  onMouseEnter={() => picking === "end" && setHover(dateStr)}
                  onMouseLeave={() => setHover("")}
                  onClick={() => handleClick(d)}
                  className="text-[11px] h-7 w-full font-medium"
                  style={{
                    background: (isS || isE) ? "var(--nav-active-bg)" : range ? "color-mix(in srgb, var(--nav-active-bg) 30%, transparent)" : "transparent",
                    color: (isS || isE) ? "var(--nav-active-text)" : dis ? "var(--text-muted)" : "var(--text-primary)",
                    opacity: dis ? 0.3 : 1,
                    cursor: dis ? "default" : "pointer",
                    borderRadius: isS ? "8px 0 0 8px" : isE ? "0 8px 8px 0" : range ? "0" : "8px",
                  }}>
                  {d}
                </button>
              );
            })}
          </div>

          <div className="mt-2 pt-2 flex justify-between items-center" style={{ borderTop: "1px solid var(--border-card)" }}>
            <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>สูงสุด {maxDays ?? 30} วัน</p>
            {picking === "end" && draft.start && (
              <button type="button" className="text-[10px] underline" style={{ color: "var(--text-muted)" }}
                onClick={() => { setPicking("start"); setDraft({ start: "", end: "" }); setHover(""); }}>
                เริ่มใหม่
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
