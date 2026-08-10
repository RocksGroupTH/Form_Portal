"use client";

import { Plus, Trash2 } from "lucide-react";
import type { DepartureLocationInput } from "@/features/travel-booking/hooks/useTravelBookingForm";
import type { TravelDirection } from "@/features/travel-booking/types";
import { errInputStyle, inputClass, inputStyle } from "./shared";

/**
 * ข้อ13 — จุดขึ้นรถ/ขึ้นเครื่อง for one direction (shown when that direction's 12.1
 * "กำหนดสถานที่" is checked). `all` holds both directions' rows combined
 * (matches TravelBookingRequest.departureLocations) — this component filters
 * to its own direction and writes patches back through `onChange` for the full array.
 */
export function DepartureLocationList({
  direction,
  all,
  onChange,
  hasError,
  placeholder = "เช่น สนามบินสุวรรณภูมิ (BKK)",
}: {
  direction: TravelDirection;
  all: DepartureLocationInput[];
  onChange: (all: DepartureLocationInput[]) => void;
  hasError?: boolean;
  placeholder?: string;
}) {
  const others = all.filter((d) => d.direction !== direction);
  const mine = all.filter((d) => d.direction === direction);
  const rows = mine.length > 0 ? mine : [{ direction, name: "", sortOrder: 0 }];

  const commit = (nextMine: DepartureLocationInput[]) => {
    onChange([...others, ...nextMine.map((r, i) => ({ ...r, sortOrder: i }))]);
  };

  const setRow = (idx: number, name: string) => {
    commit(rows.map((r, i) => (i === idx ? { ...r, name } : r)));
  };
  const addRow = () => commit([...rows, { direction, name: "", sortOrder: rows.length }]);
  const removeRow = (idx: number) => {
    const next = rows.filter((_, i) => i !== idx);
    commit(next.length > 0 ? next : [{ direction, name: "", sortOrder: 0 }]);
  };

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <input
            value={row.name}
            onChange={(e) => setRow(idx, e.target.value)}
            placeholder={placeholder}
            className={inputClass}
            style={{ ...inputStyle, ...errInputStyle(!!hasError && idx === 0 && !row.name.trim()) }}
          />
          <button
            type="button"
            onClick={() => removeRow(idx)}
            disabled={rows.length <= 1 && !row.name.trim()}
            aria-label="ลบรายการนี้"
            title="ลบรายการนี้"
            className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)", color: "var(--text-muted)" }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12.5px] font-medium cursor-pointer transition-colors"
        style={{ border: "1px dashed var(--border-card)", background: "transparent", color: "var(--text-muted)" }}
      >
        <Plus size={13} /> เพิ่มจุดขึ้น
      </button>
    </div>
  );
}
