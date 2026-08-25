/**
 * The month arithmetic and Thai labels every calendar in this app draws with.
 *
 * Extracted from `FilterMultiDatePicker` when AP-4 needed a single-date picker
 * with the same look. A third hand-written copy of "which weekday does this
 * month start on" is how two calendars in one app come to disagree about a
 * leap year, so the arithmetic lives here once, imports nothing, and is unit
 * tested.
 *
 * Dates are carried as `YYYY-MM-DD` strings throughout — the same shape the
 * API and the database use — and never as `Date` objects, which would drag the
 * server's timezone into a field that means a calendar day. Buddhist years are
 * a *display* concern: `toBuddhistYear` is called when rendering and nowhere
 * near what gets stored.
 */

export const TH_DAYS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"] as const;

export const TH_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
] as const;

export interface YmdParts {
  year: number;
  month0: number;
  day: number;
}

/** `2026, 7, 25` → `"2026-08-25"`. Zero-padded, because these are compared as strings. */
export function toYmd(year: number, month0: number, day: number): string {
  return `${year}-${String(month0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** How many days that month actually has — 2024-02 is 29, 2026-02 is 28. */
export function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

/**
 * `"2026-08-25"` → parts, or null.
 *
 * Null for a day the month does not have, not only for one out of 1..31: `new
 * Date(2026, 1, 29)` silently rolls forward to 1 March, so accepting
 * "2026-02-29" would hand back a date nobody picked.
 */
export function parseYmd(ymd: string): YmdParts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const year = Number(m[1]);
  const month0 = Number(m[2]) - 1;
  const day = Number(m[3]);
  if (!year || month0 < 0 || month0 > 11 || day < 1) return null;
  if (day > daysInMonth(year, month0)) return null;
  return { year, month0, day };
}

/**
 * One month as grid cells: leading `null`s to line day 1 up under its weekday,
 * then 1..n. Sunday-first, matching `TH_DAYS`.
 */
export function buildMonthCells(year: number, month0: number): (number | null)[] {
  const firstDow = new Date(year, month0, 1).getDay();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth(year, month0); d++) cells.push(d);
  return cells;
}

/** Display only. What is stored and compared stays Gregorian. */
export function toBuddhistYear(year: number): number {
  return year + 543;
}

/** `"2026-08-25"` → `"25 สิงหาคม 2569"`; `""` for anything unparseable. */
export function formatThaiYmd(ymd: string): string {
  const p = parseYmd(ymd);
  if (!p) return "";
  return `${p.day} ${TH_MONTHS[p.month0]} ${toBuddhistYear(p.year)}`;
}

/** Step the visible month, carrying across the year boundary in both directions. */
export function addMonths(year: number, month0: number, delta: number): { year: number; month0: number } {
  const total = year * 12 + month0 + delta;
  return { year: Math.floor(total / 12), month0: ((total % 12) + 12) % 12 };
}

/** Today as `YYYY-MM-DD`, from local getters — never `toISOString()`, which is UTC. */
export function todayYmd(): string {
  const now = new Date();
  return toYmd(now.getFullYear(), now.getMonth(), now.getDate());
}
