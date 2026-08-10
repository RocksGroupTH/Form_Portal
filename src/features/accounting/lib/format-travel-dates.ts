const TH_WEEKDAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"] as const;
const TH_MONTHS_SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
] as const;

/** Weekday + "DD MMM" for day chips, from YYYY-MM-DD (local). */
export function fmtDayChipDate(ymd: string | null): { weekday: string; dayMonth: string } | null {
  if (!ymd) return null;
  const p = ymd.split("-").map(Number);
  if (p.length !== 3 || !p[0]) return null;
  const dt = new Date(p[0], p[1] - 1, p[2]);
  return { weekday: TH_WEEKDAYS[dt.getDay()], dayMonth: `${p[2]} ${TH_MONTHS_SHORT[p[1] - 1]}` };
}

/** Panel title for a travel day (detail view / form tabs). */
export function fmtDayPanelTitle(ymd: string | null, fallbackIndex?: number): string {
  if (ymd) return fmtYmdDisplay(ymd);
  if (fallbackIndex != null) return `วันเดินทางที่ ${fallbackIndex + 1}`;
  return "ข้อมูลการเดินทาง";
}

/** DD/MM/YYYY display from YYYY-MM-DD */
export function fmtYmdDisplay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

/** DD/MM from YYYY-MM-DD */
export function fmtYmdShort(ymd: string): string {
  const [, m, d] = ymd.split("-");
  if (!m || !d) return ymd;
  return `${d}/${m}`;
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
