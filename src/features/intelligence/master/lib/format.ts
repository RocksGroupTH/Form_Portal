const thb0 = new Intl.NumberFormat("th-TH", {
  style: "decimal",
  maximumFractionDigits: 0,
});

const thb2 = new Intl.NumberFormat("th-TH", {
  style: "decimal",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const int0 = new Intl.NumberFormat("th-TH", {
  style: "decimal",
  maximumFractionDigits: 0,
});

const pct2 = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function formatTHB(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "-";
  return decimals === 0 ? thb0.format(n) : thb2.format(n);
}

export function formatInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "-";
  return int0.format(n);
}

export function formatPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "-";
  return pct2.format(n);
}

export function formatMonthYear(ym: string): string {
  const [y, m] = ym.split("-").map((s) => parseInt(s, 10));
  if (!y || !m) return ym;
  return `${MONTHS_SHORT[m - 1]} ${y}`;
}

/** Compact "MMM-YY" form for filter chips and tight labels (e.g. "Apr-26"). */
export function formatMonthYearShort(ym: string): string {
  const [y, m] = ym.split("-").map((s) => parseInt(s, 10));
  if (!y || !m) return ym;
  return `${MONTHS_SHORT[m - 1]}-${String(y).slice(-2)}`;
}

/**
 * Last `count` months ending in the current month, as YYYY-MM.
 * Mirrors the server-side `defaultWindowStart()` in lib/filters.ts so the
 * client-side default Date filter selection matches the API's default window.
 *
 * Example (now = April 2026, count = 3) → ["2026-02","2026-03","2026-04"].
 */
export function getDefaultYms(count: number): string[] {
  return getDefaultYmsAsOf(count, 0);
}

/**
 * Same as `getDefaultYms` but anchored `monthsAgo` months in the past — used
 * to detect whether a stored URL still holds the default window from a
 * previous month so we can roll it forward.
 *
 * Example (now = April 2026, count = 3, monthsAgo = 1) → Jan/Feb/Mar 2026.
 */
export function getDefaultYmsAsOf(count: number, monthsAgo: number): string[] {
  const out: string[] = [];
  const now = new Date();
  const baseY = now.getUTCFullYear();
  const baseM = now.getUTCMonth() - monthsAgo;
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(baseY, baseM - i, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    out.push(`${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`);
  }
  return out;
}

export function shortDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map((s) => parseInt(s, 10));
  if (!y || !m || !d) return ymd;
  return `${y}/${m}/${d}`;
}

/* ------------------------------------------------------------------
 * ISO 8601 week helpers — used by the Full-Data export's "Weekly"
 * granularity. Week IDs are formatted "YYYY-Www" (e.g. "2026-W10").
 * Weeks start Monday and the year of a week is the year that contains
 * its Thursday (so the last few days of December may belong to week 1
 * of next year, and vice versa).
 * ------------------------------------------------------------------ */

/** Pad a 1- or 2-digit number to 2 chars: 5 → "05". */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** YYYY-MM-DD for a UTC Date. */
export function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** ISO 8601 week ID for a given UTC date — `2026-W10`. */
export function getISOWeek(date: Date): string {
  // Copy & normalise to UTC midnight.
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  // ISO week: shift to the Thursday of the same week (Mon=1 … Sun=7).
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  // First Thursday of the year defines week 1.
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );
  return `${d.getUTCFullYear()}-W${pad2(weekNum)}`;
}

/**
 * Convert an ISO week ID back to its [start, end) range — Monday 00:00
 * UTC inclusive through the following Monday 00:00 UTC exclusive.
 * Returns null on malformed input so callers can skip cleanly.
 */
export function isoWeekRange(
  weekId: string
): { start: Date; end: Date } | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekId);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (!Number.isFinite(year) || week < 1 || week > 53) return null;
  // ISO week 1 is the week containing Jan 4. Find the Monday of that week.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - day + 1);
  const start = new Date(week1Mon);
  start.setUTCDate(week1Mon.getUTCDate() + (week - 1) * 7);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 7);
  return { start, end };
}

/**
 * Every distinct ISO week ID that overlaps the given month
 * (`YYYY-MM`). Sorted ascending. Includes weeks whose Monday falls in
 * the previous month if any of their days are in this one — matches
 * how Excel-style "weeks of March" is usually understood.
 */
export function weeksInMonth(yearMonth: string): string[] {
  const m = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!m) return [];
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const set = new Set<string>();
  // Iterate every day of the month, collect unique ISO week IDs.
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  for (let d = 1; d <= lastDay; d++) {
    set.add(getISOWeek(new Date(Date.UTC(y, mo - 1, d))));
  }
  return Array.from(set).sort();
}

/**
 * Pretty-print a week's date range — "Mar 2 – 8" if start and end share
 * a month, "Feb 23 – Mar 1" otherwise. End date is the inclusive Sunday.
 */
export function formatWeekRange(weekId: string): string {
  const r = isoWeekRange(weekId);
  if (!r) return weekId;
  // Inclusive Sunday = end - 1 day.
  const sun = new Date(r.end);
  sun.setUTCDate(sun.getUTCDate() - 1);
  const sM = MONTHS_SHORT[r.start.getUTCMonth()];
  const sD = r.start.getUTCDate();
  const eM = MONTHS_SHORT[sun.getUTCMonth()];
  const eD = sun.getUTCDate();
  if (r.start.getUTCMonth() === sun.getUTCMonth()) {
    return `${sM} ${sD} – ${eD}`;
  }
  return `${sM} ${sD} – ${eM} ${eD}`;
}

/** Just the week number portion of an ISO week ID (e.g. "2026-W10" → 10). */
export function weekNumber(weekId: string): number {
  const m = /^\d{4}-W(\d{2})$/.exec(weekId);
  return m ? Number(m[1]) : 0;
}

/* ------------------------------------------------------------------
 * Day-level helpers — used by the Full-Data export's "Daily"
 * granularity. Day IDs are ISO calendar dates "YYYY-MM-DD".
 * ------------------------------------------------------------------ */

/**
 * Every calendar day in a `YYYY-MM` month as `YYYY-MM-DD` strings,
 * ascending. Returns [] on malformed input.
 */
export function daysInMonth(yearMonth: string): string[] {
  const m = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!m) return [];
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const out: string[] = [];
  for (let d = 1; d <= lastDay; d++) {
    out.push(`${m[1]}-${m[2]}-${pad2(d)}`);
  }
  return out;
}

/**
 * Half-open UTC range for one ISO day — `[YYYY-MM-DD 00:00, next-day 00:00)`.
 * Matches `isoWeekRange()`'s convention so callers can build SQL
 * predicates the same way. Returns null on malformed input.
 */
export function dayDateRange(
  day: string
): { start: Date; end: Date } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return null;
  const start = new Date(Date.UTC(y, mo - 1, d));
  if (isNaN(start.getTime())) return null;
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 1);
  return { start, end };
}

/** Year-month part of an ISO day — "2026-04-12" → "2026-04". */
export function ymOfDay(day: string): string {
  return day.slice(0, 7);
}

/** Day-of-week (Mon=0 … Sun=6) for an ISO day. */
export function dayOfWeekMonFirst(day: string): number {
  const r = dayDateRange(day);
  if (!r) return 0;
  const js = r.start.getUTCDay(); // Sun=0…Sat=6
  return (js + 6) % 7; // Mon=0…Sun=6
}
