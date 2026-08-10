import { getCorePool, sql } from "@/lib/db/mssql";

function nthFridayOfMonth(year: number, month0: number, nth: number): Date {
  const d = new Date(year, month0, 1);
  const offset = (5 - d.getDay() + 7) % 7; // 5 = Friday
  return new Date(year, month0, 1 + offset + (nth - 1) * 7);
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Fetch holiday date strings (YYYY-MM-DD) within [from,to] from Rocks_Codex. */
async function getHolidaySet(from: Date, to: Date): Promise<Set<string>> {
  const pool = await getCorePool();
  const r = await pool
    .request()
    .input("from", sql.Date, from)
    .input("to", sql.Date, to)
    .query(`
      SELECT CONVERT(varchar(10), [Date], 23) AS d
      FROM [Rocks_Codex].[dbo].[Holiday]
      WHERE [Date] BETWEEN @from AND @to
        AND IsActive = 1
    `);
  return new Set(r.recordset.map((x: { d: string }) => x.d));
}

/** Shift backward when the payment Friday falls on a weekend or public holiday. */
function shiftPaymentDay(d: Date, holidays: Set<string>): Date {
  const cur = new Date(d);
  while (cur.getDay() === 0 || cur.getDay() === 6 || holidays.has(ymd(cur))) {
    cur.setDate(cur.getDate() - 1);
  }
  return cur;
}

/** Valid payment dates (2nd & 4th Friday, holiday-shifted) for the next `months`. */
export async function getPaymentDates(from: Date = new Date(), months = 4): Promise<string[]> {
  const start = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(from.getFullYear(), from.getMonth() + months + 1, 0);
  const holidays = await getHolidaySet(start, end);

  const out: string[] = [];
  for (let m = 0; m <= months; m++) {
    const anchor = new Date(from.getFullYear(), from.getMonth() + m, 1);
    for (const nth of [2, 4]) {
      const base = nthFridayOfMonth(anchor.getFullYear(), anchor.getMonth(), nth);
      const shifted = shiftPaymentDay(base, holidays);
      const s = ymd(shifted);
      const todayMidnight = new Date(from.getFullYear(), from.getMonth(), from.getDate());
      if (shifted >= todayMidnight && !out.includes(s)) out.push(s);
    }
  }
  return out.sort();
}

/** The default next payment date (first upcoming). */
export async function getDefaultPaymentDate(from: Date = new Date()): Promise<string | null> {
  const dates = await getPaymentDates(from);
  return dates[0] ?? null;
}
