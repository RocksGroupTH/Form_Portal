/**
 * Central SQL string templates for Intelligence routes.
 * Each exported function returns a complete SQL string given a pre-built WHERE clause.
 * Plans 5/6/7 will extend this file with one function per migrated legacy route.
 */

export const VIEW_CLEAN = "dbo.vw_Foodstory_Clean";
export const VIEW_REVENUE = "dbo.vw_Foodstory_Revenue";

const PREAMBLE = "SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;\n";
const TAIL = "\nOPTION (RECOMPILE);";

/** Sargable year-month string. Use this instead of FORMAT() which is non-sargable. */
const YM_EXPR =
  "CONCAT(YEAR(order_datetime), '-', RIGHT('0' + CAST(MONTH(order_datetime) AS VARCHAR(2)), 2))";

/* ── Color-by dimension expressions ── */

export type ColorByKey =
  | "channel"
  | "order_type"
  | "payment_type"
  | "hour"
  | "category"
  | "menu_name";

const COLOR_DIM_SQL: Record<ColorByKey, string> = {
  channel: "COALESCE(channel, '(blank)')",
  order_type: "COALESCE(order_type, '(blank)')",
  payment_type: "COALESCE(payment_type, '(blank)')",
  category: "COALESCE(category, '(blank)')",
  hour: "CAST(DATEPART(hour, order_datetime) AS NVARCHAR(8))",
  menu_name: "COALESCE(menu_name, '(blank)')",
};

export type MetricKey = "netSales" | "ticketCount" | "ticketAvg";

/* ── Query templates ── */

/** KPI strip per month — NetSales + ticketCount + distinctDays. Uses Clean. */
export const SQL_KPI = (where: string): string => `${PREAMBLE}
SELECT
  ${YM_EXPR}                                    AS ym,
  SUM(NetSalse)                                 AS netSales,
  COUNT(DISTINCT unique_order_code)             AS ticketCount,
  COUNT(DISTINCT CAST(order_datetime AS date))  AS distinctDays
FROM ${VIEW_CLEAN}
${where}
GROUP BY YEAR(order_datetime), MONTH(order_datetime)
ORDER BY YEAR(order_datetime) ASC, MONTH(order_datetime) ASC${TAIL}`;

/** Ticket counts per (month, order_type). Uses Clean. */
export const SQL_TICKET_BY_SALE_TYPE = (where: string): string => `${PREAMBLE}
SELECT
  ${YM_EXPR}                       AS ym,
  COALESCE(order_type, '(blank)')  AS order_type,
  COUNT(DISTINCT unique_order_code) AS ticketCount,
  SUM(NetSalse)                    AS netSales
FROM ${VIEW_CLEAN}
${where}
GROUP BY YEAR(order_datetime), MONTH(order_datetime), COALESCE(order_type, '(blank)')
ORDER BY YEAR(order_datetime) ASC, MONTH(order_datetime) ASC, order_type ASC${TAIL}`;

/** Share of NetSales by order_type per month. Uses Clean. */
export const SQL_MODE_PROPORTION = (where: string): string => `${PREAMBLE}
WITH m AS (
  SELECT
    YEAR(order_datetime)             AS y,
    MONTH(order_datetime)            AS mo,
    COALESCE(order_type, '(blank)')  AS order_type,
    SUM(NetSalse)                    AS netSales
  FROM ${VIEW_CLEAN}
  ${where}
  GROUP BY YEAR(order_datetime), MONTH(order_datetime), COALESCE(order_type, '(blank)')
),
t AS (
  SELECT y, mo, SUM(netSales) AS total FROM m GROUP BY y, mo
)
SELECT
  CONCAT(m.y, '-', RIGHT('0' + CAST(m.mo AS VARCHAR(2)), 2)) AS ym,
  m.order_type,
  CASE WHEN t.total = 0 OR t.total IS NULL THEN 0
       ELSE CAST(m.netSales AS FLOAT) / CAST(t.total AS FLOAT)
  END AS share
FROM m JOIN t ON t.y = m.y AND t.mo = m.mo
ORDER BY m.y ASC, m.mo ASC, m.order_type ASC${TAIL}`;

/** NetSales per hour-of-day across the window. Uses Clean. */
export const SQL_HOURLY = (where: string): string => `${PREAMBLE}
SELECT
  DATEPART(hour, order_datetime)               AS hour,
  SUM(NetSalse)                                AS netSales,
  COUNT(DISTINCT CAST(order_datetime AS date)) AS distinctDays
FROM ${VIEW_CLEAN}
${where}
GROUP BY DATEPART(hour, order_datetime)
ORDER BY hour ASC${TAIL}`;

/** Daily metric per (day, colorBy dim). Metric chosen by argument. Uses Clean. */
export const SQL_SALES_BY = (
  colorBy: ColorByKey,
  where: string,
  metric: MetricKey = "netSales",
): string => {
  let valueExpr: string;
  if (metric === "ticketCount") {
    valueExpr = "COUNT(DISTINCT unique_order_code)";
  } else if (metric === "ticketAvg") {
    valueExpr =
      "CASE WHEN COUNT(DISTINCT unique_order_code) = 0 THEN 0 " +
      "ELSE SUM(NetSalse) * 1.0 / COUNT(DISTINCT unique_order_code) END";
  } else {
    valueExpr = "SUM(NetSalse)";
  }
  return `${PREAMBLE}
SELECT
  CONVERT(nvarchar(10), order_datetime, 23) AS day,
  ${COLOR_DIM_SQL[colorBy]}                 AS dim,
  ${valueExpr}                              AS netSales
FROM ${VIEW_CLEAN}
${where}
GROUP BY CONVERT(nvarchar(10), order_datetime, 23), ${COLOR_DIM_SQL[colorBy]}
ORDER BY day ASC, dim ASC${TAIL}`;
};

/** NetSales per (store, order_type). Uses Clean. */
export const SQL_BY_STORE = (where: string): string => `${PREAMBLE}
SELECT
  COALESCE(branch_name, '(blank)') AS branch_name,
  COALESCE(order_type, '(blank)')  AS order_type,
  SUM(NetSalse)                    AS netSales
FROM ${VIEW_CLEAN}
${where}
GROUP BY COALESCE(branch_name, '(blank)'), COALESCE(order_type, '(blank)')
ORDER BY branch_name ASC, order_type ASC${TAIL}`;

/** ADS (Average Daily Sales) per (branch, month). Uses Clean. */
export const SQL_ADS_TREND = (where: string): string => `${PREAMBLE}
SELECT
  COALESCE(branch_name, '(blank)')             AS branch_name,
  ${YM_EXPR}                                   AS ym,
  SUM(NetSalse)                                AS netSales,
  COUNT(DISTINCT CAST(order_datetime AS date)) AS distinctDays
FROM ${VIEW_CLEAN}
${where}
GROUP BY COALESCE(branch_name, '(blank)'), YEAR(order_datetime), MONTH(order_datetime)
ORDER BY branch_name ASC, YEAR(order_datetime) ASC, MONTH(order_datetime) ASC${TAIL}`;

/** Whitelist of columns the distincts route may query. */
export const ALLOWED_DISTINCT_COLUMNS: Record<string, string> = {
  branch_id: "branch_id",
  branch_name: "branch_name",
  category: "category",
  channel: "channel",
  menu_code: "menu_code",
  menu_name: "menu_name",
  order_type: "order_type",
  payment_type: "payment_type",
  void_flag: "void_flag",
  is_revenue: "is_revenue",
};

/**
 * Distinct values of a single whitelisted column within a window.
 * Caller passes `col` validated against ALLOWED_DISTINCT_COLUMNS.
 * Uses Clean.
 */
export const SQL_DISTINCTS = (col: string): string => `${PREAMBLE}
SELECT DISTINCT ${col} AS v
FROM ${VIEW_CLEAN}
WHERE ${col} IS NOT NULL
  AND LTRIM(RTRIM(${col})) <> ''
  AND order_datetime >= @distinct_start
ORDER BY v ASC${TAIL}`;

/** Distinct ym buckets in the default window — populates the period picker. */
export const SQL_DISTINCT_YM = `${PREAMBLE}
SELECT DISTINCT ${YM_EXPR} AS v
FROM ${VIEW_CLEAN}
WHERE order_datetime IS NOT NULL
  AND order_datetime >= @distinct_start
ORDER BY v ASC${TAIL}`;

/**
 * Distinct calendar days within the default window — powers the
 * "fade days with no data" behaviour in the export PeriodPicker.
 * CONVERT style 23 emits ISO `YYYY-MM-DD` strings.
 */
export const SQL_DISTINCT_DAYS = `${PREAMBLE}
SELECT DISTINCT CONVERT(NVARCHAR(10), order_datetime, 23) AS v
FROM ${VIEW_CLEAN}
WHERE order_datetime IS NOT NULL
  AND order_datetime >= @distinct_start
ORDER BY v ASC${TAIL}`;

/**
 * Whitelist of columns that the full-data export endpoint may return.
 * Order here is the default presentation order in CSV/XLSX exports.
 */
export const FULL_DATA_COLUMNS: string[] = [
  "Id",
  "branch_id",
  "branch_name",
  "order_datetime",
  "time",
  "unique_order_code",
  "receipt_no",
  "inv_no",
  "cash_drawer_code",
  "menu_code",
  "menu_name",
  "category",
  "order_type",
  "channel",
  "quantity_num",
  "price_num",
  "total_price",
  "discount_value",
  "discounted_price",
  "payment_type",
  "payment_channel",
  "payment_channel_original",
  "custompay_name",
  "bill_open_by",
  "bill_close_by",
  "CreatedAt",
  "payment_id",
  "void_flag",
  "is_revenue",
];

/**
 * Streaming export query. `cols` must be a subset of FULL_DATA_COLUMNS —
 * the caller is responsible for whitelisting; this function does not
 * validate to avoid double work in the hot streaming path.
 * `limit` is clamped to [1, 1_000_000] defensively.
 */
export const SQL_FULL_DATA = (
  cols: string[],
  where: string,
  limit: number,
): string => `${PREAMBLE}
SELECT TOP ${Math.max(1, Math.min(limit, 1_000_000))}
  ${cols.join(", ")}
FROM ${VIEW_CLEAN}
${where}
ORDER BY order_datetime DESC, Id DESC${TAIL}`;

/** Row count for the same filter scope — used to size export progress UI. */
export const SQL_FULL_DATA_COUNT = (where: string): string => `${PREAMBLE}
SELECT COUNT_BIG(*) AS cnt
FROM ${VIEW_CLEAN}
${where}${TAIL}`;
