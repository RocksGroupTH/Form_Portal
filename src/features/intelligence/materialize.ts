/**
 * Materialized report tables in Fast_Data.
 *
 * Historical dates are computed once and stored permanently.
 * Today's data is refreshed on first access (stale after 1 hour).
 *
 * Tables: Intel_DailySales, Intel_SalesItem, Intel_Tender,
 *         Intel_VAT, Intel_Waste, Intel_Promotion
 */

import { getDataPool, getFoodstoryPool, sql } from "@/lib/db/mssql";

const STALE_MS = 60 * 60 * 1000; // 1 hour — today's data refreshes after this

/* ── Types ── */

interface DateGap {
  missing: string[]; // dates that need computation
  staleToday: boolean; // today's row exists but is older than STALE_MS
}

/* ── Helpers ── */

/** Generate array of date strings between from and to (inclusive) */
function dateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const d = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  while (d <= end) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    dates.push(`${y}-${m}-${day}`);
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Find which dates are missing from a materialized table */
async function findGaps(
  tableName: string,
  brand: string,
  from: string,
  to: string,
): Promise<DateGap> {
  const pool = await getDataPool();
  const result = await pool
    .request()
    .input("brand", sql.NVarChar, brand)
    .input("from", sql.Date, from)
    .input("to", sql.Date, to)
    .query(`
      SELECT CONVERT(VARCHAR(10), ReportDate, 120) AS d, MAX(ComputedAt) AS ComputedAt
      FROM ${tableName}
      WHERE Brand = @brand AND ReportDate >= @from AND ReportDate <= @to
      GROUP BY CONVERT(VARCHAR(10), ReportDate, 120)
    `);

  const existing = new Map<string, Date>();
  for (const row of result.recordset) {
    existing.set(row.d, new Date(row.ComputedAt));
  }

  const allDates = dateRange(from, to);
  const today = todayStr();
  const missing: string[] = [];
  let staleToday = false;

  for (const d of allDates) {
    if (!existing.has(d)) {
      missing.push(d);
    } else if (d === today) {
      const computedAt = existing.get(d)!;
      if (Date.now() - computedAt.getTime() > STALE_MS) {
        staleToday = true;
      }
    }
  }

  return { missing, staleToday };
}

/* ── Promise lock per table+brand to prevent concurrent materialization ── */

const locks = new Map<string, Promise<void>>();

function withLock(key: string, fn: () => Promise<void>): Promise<void> {
  const existing = locks.get(key);
  const work = (existing ?? Promise.resolve()).then(fn).finally(() => {
    if (locks.get(key) === work) locks.delete(key);
  });
  locks.set(key, work);
  return work;
}

/* ── Materialization functions per report ── */

async function materializeDailySales(brand: string, dates: string[]): Promise<void> {
  if (dates.length === 0) return;
  const fsPool = await getFoodstoryPool(brand);
  const dataPool = await getDataPool();

  for (const date of dates) {
    // Delete existing rows for this date (for refresh)
    await dataPool.request()
      .input("brand", sql.NVarChar, brand)
      .input("date", sql.Date, date)
      .query("DELETE FROM Intel_DailySales WHERE Brand = @brand AND ReportDate = @date");

    const result = await fsPool.request()
      .input("date", sql.Date, date)
      .query(`
        SELECT
          m.branch_name AS branchName,
          b.order_type AS orderType,
          b.channel,
          COUNT(DISTINCT b.receipt_no) AS bills,
          SUM(b.quantity_num) AS items,
          SUM(b.discounted_price_num) AS revenue
        FROM FS_BillDetail b
        LEFT JOIN (SELECT branch_id, branch_name, branch_code FROM FS_MasterBranch GROUP BY branch_id, branch_name, branch_code) m ON CAST(b.branch_id AS NVARCHAR) = m.branch_id
        WHERE b.void_flag != '1' AND b.is_revenue = '1' AND b.IngestDate = @date
        GROUP BY m.branch_name, b.order_type, b.channel
      `);

    if (result.recordset.length > 0) {
      const table = new sql.Table("Intel_DailySales");
      table.columns.add("Brand", sql.NVarChar(10));
      table.columns.add("ReportDate", sql.Date);
      table.columns.add("BranchName", sql.NVarChar(200));
      table.columns.add("OrderType", sql.NVarChar(100));
      table.columns.add("Channel", sql.NVarChar(100));
      table.columns.add("Bills", sql.Int);
      table.columns.add("Items", sql.Float);
      table.columns.add("Revenue", sql.Float);
      table.columns.add("ComputedAt", sql.DateTime2);

      const now = new Date();
      for (const row of result.recordset) {
        table.rows.add(brand, date, row.branchName, row.orderType, row.channel, row.bills, row.items, row.revenue, now);
      }
      await dataPool.request().bulk(table);
    }
  }
}

async function materializeSalesItem(brand: string, dates: string[]): Promise<void> {
  if (dates.length === 0) return;
  const fsPool = await getFoodstoryPool(brand);
  const dataPool = await getDataPool();

  for (const date of dates) {
    await dataPool.request()
      .input("brand", sql.NVarChar, brand)
      .input("date", sql.Date, date)
      .query("DELETE FROM Intel_SalesItem WHERE Brand = @brand AND ReportDate = @date");

    const result = await fsPool.request()
      .input("date", sql.Date, date)
      .query(`
        SELECT
          b.menu_name_base AS menuName,
          b.category,
          m.branch_name AS branchName,
          SUM(b.quantity_num) AS quantity,
          SUM(b.discounted_price_num) AS revenue,
          CASE WHEN SUM(b.quantity_num) > 0 THEN SUM(b.discounted_price_num) / SUM(b.quantity_num) ELSE 0 END AS avgPrice,
          COUNT(DISTINCT b.receipt_no) AS bills
        FROM FS_BillDetail b
        LEFT JOIN (SELECT branch_id, branch_name, branch_code FROM FS_MasterBranch GROUP BY branch_id, branch_name, branch_code) m ON CAST(b.branch_id AS NVARCHAR) = m.branch_id
        WHERE b.void_flag != '1' AND b.is_revenue = '1' AND b.IngestDate = @date
        GROUP BY b.menu_name_base, b.category, m.branch_name
      `);

    if (result.recordset.length > 0) {
      const table = new sql.Table("Intel_SalesItem");
      table.columns.add("Brand", sql.NVarChar(10));
      table.columns.add("ReportDate", sql.Date);
      table.columns.add("MenuName", sql.NVarChar(200));
      table.columns.add("Category", sql.NVarChar(200));
      table.columns.add("BranchName", sql.NVarChar(200));
      table.columns.add("Quantity", sql.Float);
      table.columns.add("Revenue", sql.Float);
      table.columns.add("AvgPrice", sql.Float);
      table.columns.add("Bills", sql.Int);
      table.columns.add("ComputedAt", sql.DateTime2);

      const now = new Date();
      for (const row of result.recordset) {
        table.rows.add(brand, date, row.menuName, row.category, row.branchName, row.quantity, row.revenue, row.avgPrice, row.bills, now);
      }
      await dataPool.request().bulk(table);
    }
  }
}

async function materializeTender(brand: string, dates: string[]): Promise<void> {
  if (dates.length === 0) return;
  const fsPool = await getFoodstoryPool(brand);
  const dataPool = await getDataPool();

  for (const date of dates) {
    await dataPool.request()
      .input("brand", sql.NVarChar, brand)
      .input("date", sql.Date, date)
      .query("DELETE FROM Intel_Tender WHERE Brand = @brand AND ReportDate = @date");

    const result = await fsPool.request()
      .input("date", sql.Date, date)
      .query(`
        WITH TenderCTE AS (
          SELECT
            b.tender_type AS tenderGroup,
            COALESCE(b.payment_channel, b.tender_type) AS tenderDetail,
            b.receipt_no,
            b.discounted_price_num
          FROM FS_BillDetail b
          WHERE b.void_flag != '1' AND b.is_revenue = '1' AND b.IngestDate = @date
        )
        SELECT
          tenderGroup,
          tenderDetail,
          COUNT(DISTINCT receipt_no) AS bills,
          SUM(discounted_price_num) AS revenue
        FROM TenderCTE
        GROUP BY tenderGroup, tenderDetail
      `);

    if (result.recordset.length > 0) {
      const table = new sql.Table("Intel_Tender");
      table.columns.add("Brand", sql.NVarChar(10));
      table.columns.add("ReportDate", sql.Date);
      table.columns.add("TenderGroup", sql.NVarChar(100));
      table.columns.add("TenderDetail", sql.NVarChar(200));
      table.columns.add("Bills", sql.Int);
      table.columns.add("Revenue", sql.Float);
      table.columns.add("ComputedAt", sql.DateTime2);

      const now = new Date();
      for (const row of result.recordset) {
        table.rows.add(brand, date, row.tenderGroup, row.tenderDetail, row.bills, row.revenue, now);
      }
      await dataPool.request().bulk(table);
    }
  }
}

async function materializeVAT(brand: string, dates: string[]): Promise<void> {
  if (dates.length === 0) return;
  const fsPool = await getFoodstoryPool(brand);
  const dataPool = await getDataPool();

  for (const date of dates) {
    await dataPool.request()
      .input("brand", sql.NVarChar, brand)
      .input("date", sql.Date, date)
      .query("DELETE FROM Intel_VAT WHERE Brand = @brand AND ReportDate = @date");

    const result = await fsPool.request()
      .input("date", sql.Date, date)
      .query(`
        SELECT
          m.branch_name AS branchName,
          SUM(b.discounted_price_num) AS grossSales,
          SUM(b.discounted_price_num / 1.07) AS netSales,
          SUM(b.discounted_price_num - b.discounted_price_num / 1.07) AS vatAmount,
          COUNT(DISTINCT b.receipt_no) AS bills
        FROM FS_BillDetail b
        LEFT JOIN (SELECT branch_id, branch_name, branch_code FROM FS_MasterBranch GROUP BY branch_id, branch_name, branch_code) m ON CAST(b.branch_id AS NVARCHAR) = m.branch_id
        WHERE b.void_flag != '1' AND b.is_revenue = '1' AND b.IngestDate = @date
        GROUP BY m.branch_name
      `);

    if (result.recordset.length > 0) {
      const table = new sql.Table("Intel_VAT");
      table.columns.add("Brand", sql.NVarChar(10));
      table.columns.add("ReportDate", sql.Date);
      table.columns.add("BranchName", sql.NVarChar(200));
      table.columns.add("GrossSales", sql.Float);
      table.columns.add("NetSales", sql.Float);
      table.columns.add("VatAmount", sql.Float);
      table.columns.add("Bills", sql.Int);
      table.columns.add("ComputedAt", sql.DateTime2);

      const now = new Date();
      for (const row of result.recordset) {
        table.rows.add(brand, date, row.branchName, row.grossSales, row.netSales, row.vatAmount, row.bills, now);
      }
      await dataPool.request().bulk(table);
    }
  }
}

async function materializeWaste(brand: string, dates: string[]): Promise<void> {
  if (dates.length === 0) return;
  const fsPool = await getFoodstoryPool(brand);
  const dataPool = await getDataPool();

  for (const date of dates) {
    await dataPool.request()
      .input("brand", sql.NVarChar, brand)
      .input("date", sql.Date, date)
      .query("DELETE FROM Intel_Waste WHERE Brand = @brand AND ReportDate = @date");

    const result = await fsPool.request()
      .input("date", sql.Date, date)
      .query(`
        WITH WasteCTE AS (
          SELECT
            m.branch_name AS branchName,
            CASE
              WHEN b.void_flag = '1' AND b.void_by IS NOT NULL THEN 'Normal Waste'
              WHEN b.is_revenue != '1' AND b.category LIKE '%Barista%' THEN 'Barista Quota'
              WHEN b.is_revenue != '1' AND b.category LIKE '%Marketing%' THEN 'Marketing Waste'
              WHEN b.is_revenue != '1' AND b.order_type = 'Grab' THEN 'Grab Waste'
              ELSE 'Normal Waste'
            END AS wasteType,
            b.menu_name_base AS menuName,
            b.quantity_num,
            b.discounted_price_num
          FROM FS_BillDetail b
          LEFT JOIN (SELECT branch_id, branch_name, branch_code FROM FS_MasterBranch GROUP BY branch_id, branch_name, branch_code) m ON CAST(b.branch_id AS NVARCHAR) = m.branch_id
          WHERE (b.void_flag = '1' OR b.is_revenue != '1') AND b.IngestDate = @date
        )
        SELECT branchName, wasteType, menuName,
          SUM(quantity_num) AS quantity,
          SUM(discounted_price_num) AS amount
        FROM WasteCTE
        GROUP BY branchName, wasteType, menuName
      `);

    if (result.recordset.length > 0) {
      const table = new sql.Table("Intel_Waste");
      table.columns.add("Brand", sql.NVarChar(10));
      table.columns.add("ReportDate", sql.Date);
      table.columns.add("BranchName", sql.NVarChar(200));
      table.columns.add("WasteType", sql.NVarChar(100));
      table.columns.add("MenuName", sql.NVarChar(200));
      table.columns.add("Quantity", sql.Float);
      table.columns.add("Amount", sql.Float);
      table.columns.add("ComputedAt", sql.DateTime2);

      const now = new Date();
      for (const row of result.recordset) {
        table.rows.add(brand, date, row.branchName, row.wasteType, row.menuName, row.quantity, row.amount, now);
      }
      await dataPool.request().bulk(table);
    }
  }
}

/* ── Public API ── */

export type ReportType = "daily-sales" | "sales-item" | "tender" | "vat" | "waste";

const materializeFns: Record<ReportType, (brand: string, dates: string[]) => Promise<void>> = {
  "daily-sales": materializeDailySales,
  "sales-item": materializeSalesItem,
  "tender": materializeTender,
  "vat": materializeVAT,
  "waste": materializeWaste,
};

const tableNames: Record<ReportType, string> = {
  "daily-sales": "Intel_DailySales",
  "sales-item": "Intel_SalesItem",
  "tender": "Intel_Tender",
  "vat": "Intel_VAT",
  "waste": "Intel_Waste",
};

/**
 * Ensure materialized data exists for the given report, brand, and date range.
 * Fills in any missing dates and refreshes today if stale.
 * Uses a lock to prevent concurrent materialization of the same report.
 */
export async function ensureMaterialized(
  report: ReportType,
  brand: string,
  from: string,
  to: string,
): Promise<void> {
  const tableName = tableNames[report];
  const fn = materializeFns[report];
  const lockKey = `${report}:${brand}`;

  await withLock(lockKey, async () => {
    // Check gaps inside the lock to prevent duplicate materialization
    const gaps = await findGaps(tableName, brand, from, to);
    const datesToCompute = [...gaps.missing];
    if (gaps.staleToday) datesToCompute.push(todayStr());
    if (datesToCompute.length === 0) return;
    await fn(brand, datesToCompute);
  });
}

/**
 * Read materialized data from Fast_Data.
 * Returns the recordset for the given report, brand, date range, and optional branch.
 */
export async function readMaterialized(
  report: ReportType,
  brand: string,
  from: string,
  to: string,
  branch?: string | null,
): Promise<sql.IRecordSet<Record<string, unknown>>> {
  const tableName = tableNames[report];
  const pool = await getDataPool();

  const req = pool.request()
    .input("brand", sql.NVarChar, brand)
    .input("from", sql.Date, from)
    .input("to", sql.Date, to);

  // Tables without BranchName column — skip branch filter
  const noBranchTables: ReportType[] = ["tender"];
  let branchFilter = "";
  if (branch && !noBranchTables.includes(report)) {
    // Lookup branch name from Foodstory
    const fsPool = await getFoodstoryPool(brand);
    const branchResult = await fsPool.request()
      .input("bid", sql.NVarChar, branch)
      .query("SELECT TOP 1 branch_name FROM FS_MasterBranch WHERE CAST(branch_id AS NVARCHAR) = @bid");
    const branchName = branchResult.recordset[0]?.branch_name;
    if (branchName) {
      branchFilter = "AND BranchName = @branch";
      req.input("branch", sql.NVarChar, branchName);
    }
  }

  const result = await req.query(`
    SELECT * FROM ${tableName}
    WHERE Brand = @brand AND ReportDate >= @from AND ReportDate <= @to ${branchFilter}
    ORDER BY ReportDate DESC
  `);

  return result.recordset;
}
