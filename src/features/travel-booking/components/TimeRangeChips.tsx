"use client";

import { TimeSelect } from "./TimeSelect";
import { errLabelStyle, labelClass, requiredStar } from "./shared";

/**
 * Departure time-window picker (ข้อ11) — two dropdowns: a start hour and an end hour that
 * must be at least 1 hour later than the start. Stored as a "HH:mm-HH:mm" string.
 */
const pad = (n: number) => String(n).padStart(2, "0");
const START_HOURS = Array.from({ length: 24 }, (_, h) => `${pad(h)}:00`); // 00:00 … 23:00

/**
 * End hours run from (start + 1) up to midnight — "00:00" is the latest option and means
 * the end of the day. The window never extends into the next day's daytime hours.
 */
function endOptionsFor(startHour: number): string[] {
  if (startHour < 0) return [];
  const out: string[] = [];
  for (let h = startHour + 1; h <= 24; h++) out.push(h === 24 ? "00:00" : `${pad(h)}:00`);
  return out;
}

function parse(v: string | null): { start: string; end: string } {
  if (!v) return { start: "", end: "" };
  const [s, e] = v.split("-");
  return { start: s ?? "", end: e ?? "" };
}

export function TimeRangeChips({
  label,
  value,
  onChange,
  hasError,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  hasError?: boolean;
}) {
  const { start, end } = parse(value);
  const startHour = start ? Number(start.split(":")[0]) : -1;
  const endOptions = endOptionsFor(startHour);

  const setStart = (s: string) => {
    if (!s) {
      onChange(null);
      return;
    }
    // Changing the start always resets the end to start + 1 hour (the user tweaks it after).
    const opts = endOptionsFor(Number(s.split(":")[0]));
    onChange(`${s}-${opts[0]}`);
  };
  const setEnd = (e: string) => {
    if (!start || !e) return;
    onChange(`${start}-${e}`);
  };

  return (
    <div>
      <label className={labelClass} style={errLabelStyle(!!hasError)}>
        {label}{requiredStar}
      </label>
      <div className="flex items-center gap-2">
        <TimeSelect
          value={start}
          options={START_HOURS}
          onChange={setStart}
          placeholder="เวลาเริ่ม"
          hasError={hasError}
        />
        <span className="shrink-0" style={{ color: "var(--text-faint)" }}>–</span>
        <TimeSelect
          value={end}
          options={endOptions}
          onChange={setEnd}
          placeholder="เวลาสิ้นสุด"
          hasError={hasError}
          disabled={!start}
        />
      </div>
    </div>
  );
}
