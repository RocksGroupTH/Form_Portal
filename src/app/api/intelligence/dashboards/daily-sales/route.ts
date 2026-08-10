import { NextRequest, NextResponse } from "next/server";
import { getFoodstoryPool, sql } from "@/lib/db/mssql";
import { requireAuth } from "@/lib/api-auth";

interface ChannelRow {
  channel: string;
  revenue: number;
  bills: number;
}

interface DailySalesData {
  daily: (Record<string, number> & { date: string })[];
  channels: ChannelRow[];
  channelNames: string[];
  kpi: {
    totalRevenue: number;
    totalBills: number;
    totalItems: number;
    avgTicket: number;
    avgDailyRevenue: number;
    daysCount: number;
  };
}

/* ── GET /api/intelligence/dashboards/daily-sales ── */

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;

    const brand = req.nextUrl.searchParams.get("brand") ?? "UNO";
    const validBrands = ["UNO", "KSI"];
    if (!validBrands.includes(brand)) {
      return NextResponse.json({ ok: false, error: "Invalid brand" }, { status: 400 });
    }
    // Support both from/to (preferred) and days (legacy)
    const fromParam = req.nextUrl.searchParams.get("from");
    const toParam = req.nextUrl.searchParams.get("to");
    const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days")) || 30, 1), 365);
    const branch = req.nextUrl.searchParams.get("branch") ?? null;

    const pool = await getFoodstoryPool(brand);

    const request = pool.request();
    let dateFilter: string;
    if (fromParam && toParam) {
      request.input("from", sql.Date, fromParam);
      request.input("to", sql.Date, toParam);
      dateFilter = "b.IngestDate >= @from AND b.IngestDate <= @to";
    } else {
      request.input("days", sql.Int, days);
      dateFilter = "b.IngestDate >= DATEADD(DAY, -@days, GETDATE())";
    }

    let branchFilter = "";
    if (branch) {
      branchFilter = "AND CAST(b.branch_id AS NVARCHAR) = @branch";
      request.input("branch", sql.NVarChar, branch);
    }

    // Aggregate revenue, bill count, item count by date + channel
    const result = await request.query(`
        SELECT
          CONVERT(VARCHAR(10), b.IngestDate, 120) AS date,
          b.menu_group_name AS channel,
          SUM(b.discounted_price_num) AS revenue,
          COUNT(DISTINCT b.receipt_no) AS billCount,
          SUM(b.quantity_num) AS itemCount
        FROM FS_BillDetail b
        WHERE b.void_flag != '1' AND b.is_revenue = '1'
          AND ${dateFilter}
          ${branchFilter}
        GROUP BY b.IngestDate, b.menu_group_name
        ORDER BY b.IngestDate
      `);

    const channelLabel = (name: string) => name === "Takeaway" ? "Storefront" : name;

    // Pivot: group by date, split by channel
    const dateMap = new Map<string, Record<string, number>>();
    const channelSet = new Set<string>();
    for (const r of result.recordset) {
      const date = r.date as string;
      const ch = channelLabel((r.channel as string) ?? "Other");
      channelSet.add(ch);
      let entry = dateMap.get(date);
      if (!entry) { entry = { revenue: 0, billCount: 0, itemCount: 0 }; dateMap.set(date, entry); }
      entry.revenue += (r.revenue as number) ?? 0;
      entry.billCount += (r.billCount as number) ?? 0;
      entry.itemCount += (r.itemCount as number) ?? 0;
      entry[`revenue_${ch}`] = ((entry[`revenue_${ch}`] ?? 0) as number) + ((r.revenue as number) ?? 0);
      entry[`bills_${ch}`] = ((entry[`bills_${ch}`] ?? 0) as number) + ((r.billCount as number) ?? 0);
    }

    const channelNames = Array.from(channelSet);
    const daily = Array.from(dateMap.entries()).map(([date, e]) => ({
      date,
      revenue: e.revenue,
      billCount: e.billCount,
      itemCount: e.itemCount,
      avgTicket: e.billCount ? e.revenue / e.billCount : 0,
      ...Object.fromEntries(channelNames.flatMap((ch) => [
        [`revenue_${ch}`, e[`revenue_${ch}`] ?? 0],
        [`bills_${ch}`, e[`bills_${ch}`] ?? 0],
      ])),
    }));

    // Channel breakdown (by menu_group_name)
    const chReq = pool.request();
    if (fromParam && toParam) {
      chReq.input("from", sql.Date, fromParam);
      chReq.input("to", sql.Date, toParam);
    } else {
      chReq.input("days", sql.Int, days);
    }
    if (branch) chReq.input("branch", sql.NVarChar, branch);
    const channelResult = await chReq.query(`
        SELECT
          b.menu_group_name AS channel,
          SUM(b.discounted_price_num) AS revenue,
          COUNT(DISTINCT b.receipt_no) AS bills
        FROM FS_BillDetail b
        WHERE b.void_flag != '1' AND b.is_revenue = '1'
          AND ${dateFilter}
          ${branchFilter}
        GROUP BY b.menu_group_name
        ORDER BY revenue DESC
      `);

    const channels: ChannelRow[] = channelResult.recordset.map((r: ChannelRow) => ({
      channel: channelLabel(r.channel ?? "Other"),
      revenue: r.revenue ?? 0,
      bills: r.bills ?? 0,
    }));

    // Build KPI values from actual period data
    const totalRevenue = daily.reduce((s, r) => s + r.revenue, 0);
    const totalBills = daily.reduce((s, r) => s + r.billCount, 0);
    const totalItems = daily.reduce((s, r) => s + r.itemCount, 0);
    const avgTicket = totalBills > 0 ? totalRevenue / totalBills : 0;
    const avgDailyRevenue = daily.length > 0 ? totalRevenue / daily.length : 0;

    const kpi = {
      totalRevenue,
      totalBills,
      totalItems,
      avgTicket,
      avgDailyRevenue,
      daysCount: daily.length,
    };

    const data = { daily, channels, channelNames, kpi };

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/intelligence/dashboards/daily-sales] GET", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
