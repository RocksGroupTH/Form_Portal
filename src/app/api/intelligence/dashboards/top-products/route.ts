import { NextRequest, NextResponse } from "next/server";
import { getFoodstoryPool, sql } from "@/lib/db/mssql";
import { requireAuth } from "@/lib/api-auth";

/* ── GET /api/intelligence/dashboards/top-products ── */

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
    const prodReq = pool.request().input("from", sql.Date, from).input("to", sql.Date, to);
    const catReq = pool.request().input("from", sql.Date, from).input("to", sql.Date, to);
    if (branch) {
      branchFilter = "AND CAST(b.branch_id AS NVARCHAR) = @branch";
      prodReq.input("branch", sql.NVarChar, branch);
      catReq.input("branch", sql.NVarChar, branch);
    }

    const [productsResult, categoriesResult] = await Promise.all([
      prodReq.query(`
        SELECT TOP 50
          b.menu_name_base AS menuName,
          b.category,
          SUM(b.discounted_price_num) AS revenue,
          SUM(b.quantity_num) AS quantity,
          CASE WHEN SUM(b.quantity_num) > 0 THEN SUM(b.discounted_price_num) / SUM(b.quantity_num) ELSE 0 END AS avgPrice
        FROM FS_BillDetail b
        WHERE b.void_flag != '1' AND b.is_revenue = '1'
          AND b.IngestDate >= @from AND b.IngestDate <= @to
          AND b.menu_name_base IS NOT NULL AND b.menu_name_base != ''
          ${branchFilter}
        GROUP BY b.menu_name_base, b.category
        ORDER BY revenue DESC
      `),
      catReq.query(`
        SELECT
          b.category,
          SUM(b.discounted_price_num) AS revenue,
          SUM(b.quantity_num) AS quantity
        FROM FS_BillDetail b
        WHERE b.void_flag != '1' AND b.is_revenue = '1'
          AND b.IngestDate >= @from AND b.IngestDate <= @to
          AND b.category IS NOT NULL AND b.category != ''
          ${branchFilter}
        GROUP BY b.category
        ORDER BY revenue DESC
      `),
    ]);

    const products = productsResult.recordset.map((r: Record<string, unknown>) => ({
      menuName: r.menuName as string,
      category: r.category as string,
      revenue: (r.revenue as number) ?? 0,
      quantity: (r.quantity as number) ?? 0,
      avgPrice: (r.avgPrice as number) ?? 0,
    }));

    const categories = categoriesResult.recordset.map((r: Record<string, unknown>) => ({
      category: r.category as string,
      revenue: (r.revenue as number) ?? 0,
      quantity: (r.quantity as number) ?? 0,
    }));

    // Grand totals from categories (covers all products, no TOP limit)
    const totalRevenue = categories.reduce((s: number, c: { revenue: number }) => s + c.revenue, 0);
    const totalQuantity = categories.reduce((s: number, c: { quantity: number }) => s + c.quantity, 0);

    return NextResponse.json({ ok: true, data: { products, categories, totalRevenue, totalQuantity } });
  } catch (err) {
    console.error("[api/intelligence/dashboards/top-products] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
