import { NextRequest, NextResponse } from "next/server";
import { getFoodstoryPool, sql } from "@/lib/db/mssql";
import { requireAuth } from "@/lib/api-auth";

/* ── GET /api/intelligence/dashboards/hourly-products ── */

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;

    const brand = req.nextUrl.searchParams.get("brand") ?? "UNO";
    if (!["UNO", "KSI"].includes(brand)) {
      return NextResponse.json({ ok: false, error: "Invalid brand" }, { status: 400 });
    }
    const from = req.nextUrl.searchParams.get("from") ?? "";
    const to = req.nextUrl.searchParams.get("to") ?? "";
    const branch = req.nextUrl.searchParams.get("branch") ?? null;

    const pool = await getFoodstoryPool(brand);

    let branchFilter = "";
    const hourlyReq = pool.request().input("from", sql.Date, from).input("to", sql.Date, to);
    const topReq = pool.request().input("from", sql.Date, from).input("to", sql.Date, to);
    if (branch) {
      branchFilter = "AND CAST(b.branch_id AS NVARCHAR) = @branch";
      hourlyReq.input("branch", sql.NVarChar, branch);
      topReq.input("branch", sql.NVarChar, branch);
    }

    const [hourlyResult, topByHourResult] = await Promise.all([
      // Hourly aggregation
      hourlyReq.query(`
        SELECT
          SUBSTRING(b.time, 1, 2) AS hour,
          SUM(b.discounted_price_num) AS revenue,
          COUNT(DISTINCT b.receipt_no) AS bills,
          SUM(b.quantity_num) AS qty
        FROM FS_BillDetail b
        WHERE b.void_flag != '1' AND b.is_revenue = '1'
          AND b.IngestDate >= @from AND b.IngestDate <= @to
          AND b.time IS NOT NULL AND b.time != ''
          ${branchFilter}
        GROUP BY SUBSTRING(b.time, 1, 2)
        ORDER BY SUBSTRING(b.time, 1, 2)
      `),
      // Top products per hour
      topReq.query(`
        SELECT
          SUBSTRING(b.time, 1, 2) AS hour,
          b.menu_name_base AS menuName,
          SUM(b.discounted_price_num) AS revenue,
          SUM(b.quantity_num) AS qty
        FROM FS_BillDetail b
        WHERE b.void_flag != '1' AND b.is_revenue = '1'
          AND b.IngestDate >= @from AND b.IngestDate <= @to
          AND b.time IS NOT NULL AND b.time != ''
          AND b.menu_name_base IS NOT NULL AND b.menu_name_base != ''
          ${branchFilter}
        GROUP BY SUBSTRING(b.time, 1, 2), b.menu_name_base
        ORDER BY SUBSTRING(b.time, 1, 2), SUM(b.quantity_num) DESC
      `),
    ]);

    // Format hourly data
    const hourly = hourlyResult.recordset.map((r: Record<string, unknown>) => ({
      hour: String(r.hour ?? "00"),
      label: `${r.hour}:00`,
      revenue: (r.revenue as number) ?? 0,
      bills: (r.bills as number) ?? 0,
      qty: (r.qty as number) ?? 0,
    }));

    // Group top products by hour (top 5 per hour)
    const topByHourMap = new Map<string, Array<{ menuName: string; revenue: number; qty: number }>>();
    for (const r of topByHourResult.recordset) {
      const hour = String(r.hour ?? "00");
      if (!topByHourMap.has(hour)) topByHourMap.set(hour, []);
      const list = topByHourMap.get(hour)!;
      if (list.length < 5) {
        list.push({
          menuName: r.menuName as string,
          revenue: (r.revenue as number) ?? 0,
          qty: (r.qty as number) ?? 0,
        });
      }
    }
    const topByHour: Record<string, Array<{ menuName: string; revenue: number; qty: number }>> = {};
    topByHourMap.forEach((v, k) => { topByHour[k] = v; });

    // KPIs
    const totalRevenue = hourly.reduce((s, h) => s + h.revenue, 0);
    const totalBills = hourly.reduce((s, h) => s + h.bills, 0);
    const peakHour = hourly.length > 0 ? hourly.reduce((a, b) => a.revenue > b.revenue ? a : b) : null;

    return NextResponse.json({
      ok: true,
      data: {
        hourly,
        topByHour,
        kpi: {
          totalRevenue,
          totalBills,
          peakHour: peakHour?.label ?? "N/A",
          peakRevenue: peakHour?.revenue ?? 0,
          avgHourlyRevenue: hourly.length > 0 ? totalRevenue / hourly.length : 0,
        },
      },
    });
  } catch (err) {
    console.error("[api/intelligence/dashboards/hourly-products] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
