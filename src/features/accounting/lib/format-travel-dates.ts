// Both vocabularies come from `thai-calendar.ts`, which its own header says
// exists so that "a third hand-written copy" cannot disagree with the others.
// This file kept private copies of the Thai pair, and now names the English
// one: AP-1's form reads its dates in English since 2026-09-15, and the Thai
// tables left with the last function here that used them.
//
// **Everything here reads in English since 2026-09-15**, form and report
// alike. The first cut added English twins beside the numeric originals and
// left the reports alone; the user then asked for the views too, and a twin
// would have meant the same date reading `04/09/2026` in a report and
// `4 Sep 2026` on the panel that report links to. One spelling, one function.
import { EN_DAYS, EN_MONTHS_SHORT } from "./thai-calendar";

/**
 * Weekday + "DD MMM" for AP-1's day chips, from YYYY-MM-DD (local).
 *
 * **English since 2026-09-15** (user), and changed in place rather than added
 * beside the Thai version because AP-1's form is this function's only caller —
 * there is no report or export reading it to be surprised. `fmtTravelDatesList`
 * below is a different matter — `report-service.ts` builds a column out of it —
 * so it keeps its numeric form and `fmtTravelDatesListEn` is what the form
 * calls.
 */
export function fmtDayChipDate(ymd: string | null): { weekday: string; dayMonth: string } | null {
  if (!ymd) return null;
  const p = ymd.split("-").map(Number);
  if (p.length !== 3 || !p[0]) return null;
  const dt = new Date(p[0], p[1] - 1, p[2]);
  return { weekday: EN_DAYS[dt.getDay()], dayMonth: `${p[2]} ${EN_MONTHS_SHORT[p[1] - 1]}` };
}

/** Panel title for a travel day (detail view / form tabs). */
export function fmtDayPanelTitle(ymd: string | null, fallbackIndex?: number): string {
  if (ymd) return fmtYmdDisplay(ymd);
  if (fallbackIndex != null) return `วันเดินทางที่ ${fallbackIndex + 1}`;
  return "ข้อมูลการเดินทาง";
}

/**
 * `"2026-09-04"` → `"4 Sep 2026"`.
 *
 * **English since 2026-09-15**, and changed in place rather than beside the
 * DD/MM/YYYY it replaced. The alternative was briefly tried and is worse: this
 * function prints both detail panels, three queues and the report columns, so a
 * twin would have left the same date reading `04/09/2026` in a report and
 * `4 Sep 2026` on the panel the report links to.
 */
export function fmtYmdDisplay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return `${d} ${EN_MONTHS_SHORT[m - 1]} ${y}`;
}

/** `"2026-09-04"` → `"4 Sep"` — for a list where the line carries the year. */
export function fmtYmdShort(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  if (!m || !d) return ymd;
  return `${d} ${EN_MONTHS_SHORT[m - 1]}`;
}

/** Inclusive list of YYYY-MM-DD from lo to hi. */
export function enumerateTravelDates(from: string, to: string): string[] {
  if (!from) return [];
  const lo = from <= to ? from : to;
  const hi = to || from;
  const hiNorm = lo <= hi ? hi : lo;
  const dates: string[] = [];
  const cur = new Date(lo + "T00:00:00");
  const end = new Date(hiNorm + "T00:00:00");
  while (cur <= end) {
    dates.push(
      `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`,
    );
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

/** Comma-separated short labels for selected travel dates. */
export function fmtTravelDatesList(dates: string[]): string {
  if (dates.length === 0) return "";
  if (dates.length === 1) return fmtYmdDisplay(dates[0]);
  return dates.map(fmtYmdShort).join(", ");
}

/** True when every calendar day between min and max is included. */
export function isConsecutiveDateSpan(from: string, to: string, dayCount: number): boolean {
  if (!from || dayCount <= 1) return true;
  const hi = to || from;
  return enumerateTravelDates(from, hi).length === dayCount;
}

/**
 * Label for list/report when only min, max, and count are known.
 * Non-consecutive spans avoid "A – B" implying every day in between.
 */
export function fmtTravelSpanLabel(
  travelDate: string | null,
  travelDateTo: string | null,
  dayCount: number,
): string {
  if (!travelDate) return "ยังไม่ระบุ";
  if (dayCount <= 1 || !travelDateTo || travelDateTo === travelDate) {
    return fmtYmdDisplay(travelDate);
  }
  if (isConsecutiveDateSpan(travelDate, travelDateTo, dayCount)) {
    return `${fmtYmdDisplay(travelDate)} – ${fmtYmdDisplay(travelDateTo)} (${dayCount} วัน)`;
  }
  return `${dayCount} วัน · ${fmtYmdShort(travelDate)} – ${fmtYmdShort(travelDateTo)}`;
}

/** Travel date column for report / approval queues (lists every day when known). */
export function fmtReportTravelDate(row: {
  travelDate: string | null;
  travelDateTo?: string | null;
  dayCount?: number;
  travelDates?: string[];
}): string {
  if (row.travelDates && row.travelDates.length > 1) {
    return `${row.travelDates.length} วัน · ${fmtTravelDatesList(row.travelDates)}`;
  }
  if (row.travelDates && row.travelDates.length === 1) {
    return fmtYmdDisplay(row.travelDates[0]);
  }
  if (row.dayCount && row.dayCount > 1) {
    return fmtTravelSpanLabel(row.travelDate, row.travelDateTo ?? null, row.dayCount);
  }
  if (!row.travelDate) return "—";
  return fmtYmdDisplay(row.travelDate);
}
