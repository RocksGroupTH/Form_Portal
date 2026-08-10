"use client";

import XLSX from "xlsx-js-style";
import { toCsv, downloadCsv } from "@/features/intelligence/master/lib/csv";

export type Row = Record<string, unknown>;

/**
 * MSSQL datetime values come back as ISO strings with a Z suffix
 * (e.g. "2026-05-04T21:01:27.000Z") because the Node mssql driver
 * serialises them through JSON.stringify. The data itself is stored
 * in Bangkok local time (UTC+07:00) — the Z is the JSON serialiser
 * being literal, not an actual UTC marker — so the wall-clock digits
 * already represent the correct local time.
 *
 * For human-friendly exports we strip the `T` and the `.000Z` so the
 * cell reads as "2026-05-04 21:01:27" — matches the dashboard's
 * preview table formatting and what the analysts paste into reports.
 */
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

export function formatExportValue(v: unknown): unknown {
  // Numeric values are passed through as-is so neither path rounds
  // them. XLSX keeps them as real Number cells with a numFmt that
  // shows a minimum of 2 decimals + up to several extra places —
  // see downloadXlsx() below. CSV stringifies via the default
  // toString() so a value of 19929.5 becomes "19929.5" rather than
  // "19929.50" — preserves the data's actual precision.
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return v;
  if (!ISO_DATETIME_RE.test(v)) return v;
  // "2026-05-04T21:01:27.000Z" → "2026-05-04 21:01:27"
  return v.replace("T", " ").slice(0, 19);
}

/** Apply the export formatter to every cell of a row. */
function formatExportRow(row: Row): Row {
  const out: Row = {};
  for (const k of Object.keys(row)) out[k] = formatExportValue(row[k]);
  return out;
}

export interface SizeBudget {
  rowCount: number;
  columnCount: number;
  estBytesCsv: number;
  estBytesXlsx: number;
}

/**
 * Rough size budget for a download. Average bytes per cell estimated
 * conservatively for mixed text + numeric content. The XLSX format hard
 * limit is 1,048,576 rows; UI does not block below that.
 */
export function estimateBudget(rowCount: number, columnCount: number): SizeBudget {
  const avgCellCsv = 9; // bytes per cell incl. comma + quotes
  const avgCellXlsx = 18; // xlsx is XML, larger per cell
  const estBytesCsv = rowCount * columnCount * avgCellCsv;
  const estBytesXlsx = rowCount * columnCount * avgCellXlsx;
  return { rowCount, columnCount, estBytesCsv, estBytesXlsx };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Per-column XLSX cell type map. Anything not listed defaults to
 * `text` (cell numFmt `@`). The numFmt patterns:
 *   • decimal  → "0.00"             (2 decimal places, no thousand sep)
 *   • integer  → "0"                (whole numbers)
 *   • datetime → "yyyy-mm-dd hh:mm:ss"
 *   • time     → "hh:mm:ss"
 *   • text     → "@"                (force Text — Excel won't strip leading 0s)
 */
type ExcelCellType = "decimal" | "integer" | "datetime" | "time" | "text";

const COLUMN_TYPES: Record<string, ExcelCellType> = {
  quantity_num: "decimal",
  price_num: "decimal",
  total_price: "decimal",
  discount_value: "decimal",
  discounted_price: "decimal",
  void_flag: "integer",
  is_revenue: "integer",
  order_datetime: "datetime",
  time: "time",
};

const NUMFMT: Record<ExcelCellType, string> = {
  decimal: "0.00",
  integer: "0",
  datetime: "yyyy-mm-dd hh:mm:ss",
  time: "hh:mm:ss",
  text: "@",
};

/** Match the `formatExportValue` output: "yyyy-mm-dd HH:mm:ss". */
const DATETIME_OUTPUT_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/** Parse "HH:mm:ss" (or "HH:mm") into Excel's fractional-day number. */
function timeToFraction(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3] ?? 0);
  if (h > 23 || mm > 59 || ss > 59) return null;
  return h / 24 + mm / 1440 + ss / 86400;
}

/** Parse a datetime that may come in as either:
 *   • the formatExportValue output "2026-05-04 21:01:27"  (BKK wall clock)
 *   • the raw ISO "2026-05-04T21:01:27.000Z"               (BKK wall clock with bogus Z)
 *  Returns a JS Date whose UTC parts match the BKK wall clock — when
 *  xlsx-js-style serialises it Excel reads back the same digits regardless
 *  of viewer locale. */
function toExcelDate(s: string): Date | null {
  const iso = DATETIME_OUTPUT_RE.test(s)
    ? s.replace(" ", "T") + "Z"
    : ISO_DATETIME_RE.test(s)
      ? s
      : null;
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/** Coerce one cell's value according to the column's declared type.
 *  Returns the value plus the type — caller uses the type to set
 *  numFmt at cell level after the sheet is built.
 *
 *  Notable: numeric strings may carry a thousand-separator comma
 *  (e.g. "1,425" coming from the raw `discounted_price` text column).
 *  We strip commas before `Number()` so those rows turn into real
 *  Number cells in Excel — otherwise Excel treats them as Text and
 *  silently drops them from SUM. Without this, Apr-26 SUM in the
 *  exported file came out 12,105 THB short of the dashboard total. */
function coerceCell(value: unknown, type: ExcelCellType): unknown {
  if (value === null || value === undefined || value === "") return value;
  if (type === "text") return typeof value === "string" ? value : String(value);
  if (type === "decimal" || type === "integer") {
    if (typeof value === "number") {
      return type === "integer" ? Math.trunc(value) : value;
    }
    if (typeof value === "string") {
      const cleaned = value.replace(/,/g, "").trim();
      const n = Number(cleaned);
      if (Number.isFinite(n)) return type === "integer" ? Math.trunc(n) : n;
    }
    return value;
  }
  if (type === "datetime") {
    if (typeof value === "string") {
      const d = toExcelDate(value);
      return d ?? value;
    }
    return value;
  }
  if (type === "time") {
    if (typeof value === "string") {
      const f = timeToFraction(value);
      return f ?? value;
    }
    return value;
  }
  return value;
}

/**
 * Map an ExcelCellType to the xlsx-js-style cell type character.
 * 'n' = number, 'd' = date, 's' = string.
 */
function xlsxCellType(type: ExcelCellType, value: unknown): "n" | "d" | "s" {
  if (type === "decimal" || type === "integer") return "n";
  if (type === "time") return "n"; // fractional day stored as number
  if (type === "datetime" && value instanceof Date) return "d";
  return "s";
}

/**
 * Generate an .xlsx file (single sheet) and trigger a browser download.
 * Uses xlsx-js-style (already in RocksFast deps) instead of ExcelJS.
 *
 * Cell types are explicit via the COLUMN_TYPES map above — every column
 * either declares one of {decimal | integer | datetime | time} or falls
 * back to text. numFmt is set per-cell via the `z` property.
 */
export async function downloadXlsx(
  filename: string,
  rows: Row[],
  headerOrder?: string[]
) {
  const headers =
    headerOrder && headerOrder.length > 0
      ? headerOrder
      : Array.from(
          rows.reduce<Set<string>>((acc, r) => {
            for (const k of Object.keys(r)) acc.add(k);
            return acc;
          }, new Set())
        );

  // Build AOA (array-of-arrays): header row + data rows.
  const aoa: unknown[][] = [headers];
  for (const r of rows) {
    const rowArr: unknown[] = [];
    for (const k of headers) {
      const t = COLUMN_TYPES[k] ?? "text";
      rowArr.push(coerceCell(r[k], t));
    }
    aoa.push(rowArr);
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Apply numFmt per data cell (skip header row at index 0).
  // Cell addresses in xlsx are 0-indexed columns, 0-indexed rows via encode_cell.
  for (let ci = 0; ci < headers.length; ci++) {
    const h = headers[ci];
    const t = COLUMN_TYPES[h] ?? "text";
    const fmt = NUMFMT[t];
    for (let ri = 1; ri <= rows.length; ri++) {
      const addr = XLSX.utils.encode_cell({ r: ri, c: ci });
      const cell = ws[addr];
      if (!cell) continue;
      // Set the xlsx-js-style cell type and number format.
      const coerced = aoa[ri][ci];
      cell.t = xlsxCellType(t, coerced);
      cell.z = fmt;
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, "Data");

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Convenience wrapper that picks the format. Always normalises the
 *  rows through `formatExportRow` first so datetime cells come out as
 *  "YYYY-MM-DD HH:mm:ss" instead of the raw ISO `T...Z` string the
 *  mssql driver hands back. */
export async function downloadAs(
  format: "csv" | "xlsx",
  filename: string,
  rows: Row[],
  headerOrder?: string[]
) {
  if (rows.length === 0) {
    alert("No rows to export.");
    return;
  }
  const normalised = rows.map(formatExportRow);
  if (format === "csv") {
    downloadCsv(filename, toCsv(normalised, headerOrder));
  } else {
    await downloadXlsx(filename, normalised, headerOrder);
  }
}
