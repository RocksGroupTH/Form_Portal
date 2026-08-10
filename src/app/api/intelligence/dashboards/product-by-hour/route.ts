import { NextRequest, NextResponse } from "next/server";
import { getFoodstoryPool, sql } from "@/lib/db/mssql";
import { requireAuth } from "@/lib/api-auth";

/* ── GET /api/intelligence/dashboards/product-by-hour ── */

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
    const request = pool.request().input("from", sql.Date, from).input("to", sql.Date, to);
    let branchFilter = "";
    if (branch) {
      branchFilter = "AND CAST(b.branch_id AS NVARCHAR) = @branch";
      request.input("branch", sql.NVarChar, branch);
    }

    const result = await request.query(`
      SELECT
        b.menu_name_base AS menuName,
        SUBSTRING(b.time, 1, 2) AS hour,
        SUM(b.quantity_num) AS qty,
        SUM(b.discounted_price_num) AS revenue
      FROM FS_BillDetail b
      WHERE b.void_flag != '1' AND b.is_revenue = '1'
        AND b.IngestDate >= @from AND b.IngestDate <= @to
        AND b.menu_name_base IS NOT NULL AND b.menu_name_base != ''
        AND b.time IS NOT NULL AND b.time != ''
        ${branchFilter}
      GROUP BY b.menu_name_base, SUBSTRING(b.time, 1, 2)
      ORDER BY SUM(b.quantity_num) DESC
    `);

    // Build matrix: { menuName, totalQty, totalRevenue, hours: { "07": qty, "08": qty, ... } }
    const productMap = new Map<string, { totalQty: number; totalRevenue: number; hours: Record<string, number> }>();
    const hourSet = new Set<string>();

    for (const r of result.recordset) {
      const name = r.menuName as string;
      const hour = r.hour as string;
      const qty = (r.qty as number) ?? 0;
      const revenue = (r.revenue as number) ?? 0;
      hourSet.add(hour);

      let entry = productMap.get(name);
      if (!entry) {
        entry = { totalQty: 0, totalRevenue: 0, hours: {} };
        productMap.set(name, entry);
      }
      entry.totalQty += qty;
      entry.totalRevenue += revenue;
      entry.hours[hour] = qty;
    }

    const hours = Array.from(hourSet).sort();
    const products = Array.from(productMap.entries())
      .map(([menuName, data]) => ({
        menuName,
        totalQty: data.totalQty,
        totalRevenue: data.totalRevenue,
        hours: data.hours,
      }))
      .sort((a, b) => b.totalQty - a.totalQty);

    // Hour totals
    const hourTotals: Record<string, number> = {};
    for (const h of hours) {
      hourTotals[h] = products.reduce((s, p) => s + (p.hours[h] ?? 0), 0);
    }

    return NextResponse.json({
      ok: true,
      data: {
        products,
        hours,
        hourTotals,
        totalProducts: products.length,
        totalQty: products.reduce((s, p) => s + p.totalQty, 0),
        totalRevenue: products.reduce((s, p) => s + p.totalRevenue, 0),
      },
    });
  } catch (err) {
    console.error("[api/intelligence/dashboards/product-by-hour] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
