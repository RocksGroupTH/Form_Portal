import { NextRequest, NextResponse } from "next/server";
import { getFoodstoryPool, sql } from "@/lib/db/mssql";
import { requireAuth } from "@/lib/api-auth";

/* ── GET /api/intelligence/dashboards/product-option ── */

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
    const groupReq = pool.request().input("from", sql.Date, from).input("to", sql.Date, to);
    const comboReq = pool.request().input("from", sql.Date, from).input("to", sql.Date, to);
    const kpiReq = pool.request().input("from", sql.Date, from).input("to", sql.Date, to);
    if (branch) {
      branchFilter = "AND CAST(bd.branch_id AS NVARCHAR) = @branch";
      groupReq.input("branch", sql.NVarChar, branch);
      comboReq.input("branch", sql.NVarChar, branch);
      kpiReq.input("branch", sql.NVarChar, branch);
    }

    const [groupResult, comboResult, kpiResult] = await Promise.all([
      // Option group breakdown
      groupReq.query(`
        SELECT o.OptionGroup, o.OptionValue, SUM(bd.quantity_num) AS qty
        FROM FS_BillDetailOption o
        INNER JOIN FS_BillDetail bd ON o.BillDetailId = bd.Id
        WHERE bd.void_flag != '1' AND bd.is_revenue = '1'
          AND bd.IngestDate >= @from AND bd.IngestDate <= @to
          ${branchFilter}
        GROUP BY o.OptionGroup, o.OptionValue
        ORDER BY o.OptionGroup, SUM(bd.quantity_num) DESC
      `),
      // Top product + option combos
      comboReq.query(`
        SELECT TOP 30
          bd.menu_name_base AS menuName,
          o.OptionGroup AS optionGroup,
          o.OptionValue AS optionValue,
          SUM(bd.quantity_num) AS qty,
          SUM(bd.discounted_price_num) AS revenue
        FROM FS_BillDetailOption o
        INNER JOIN FS_BillDetail bd ON o.BillDetailId = bd.Id
        WHERE bd.void_flag != '1' AND bd.is_revenue = '1'
          AND bd.IngestDate >= @from AND bd.IngestDate <= @to
          AND bd.menu_name_base IS NOT NULL AND bd.menu_name_base != ''
          ${branchFilter}
        GROUP BY bd.menu_name_base, o.OptionGroup, o.OptionValue
        ORDER BY SUM(bd.quantity_num) DESC
      `),
      // KPIs — separate queries to avoid LEFT JOIN fanout inflating SUM
      kpiReq.query(`
        SELECT
          (SELECT COUNT(*) FROM FS_BillDetail bd WHERE bd.void_flag != '1' AND bd.is_revenue = '1' AND bd.IngestDate >= @from AND bd.IngestDate <= @to ${branchFilter}) AS totalItems,
          (SELECT COUNT(DISTINCT bd.Id) FROM FS_BillDetail bd INNER JOIN FS_BillDetailOption o ON o.BillDetailId = bd.Id WHERE bd.void_flag != '1' AND bd.is_revenue = '1' AND bd.IngestDate >= @from AND bd.IngestDate <= @to ${branchFilter}) AS itemsWithOption,
          (SELECT SUM(bd.discounted_price_num) FROM FS_BillDetail bd WHERE bd.void_flag != '1' AND bd.is_revenue = '1' AND bd.IngestDate >= @from AND bd.IngestDate <= @to ${branchFilter}) AS totalRevenue,
          (SELECT COUNT(DISTINCT o.OptionGroup) FROM FS_BillDetailOption o INNER JOIN FS_BillDetail bd ON o.BillDetailId = bd.Id WHERE bd.void_flag != '1' AND bd.is_revenue = '1' AND bd.IngestDate >= @from AND bd.IngestDate <= @to ${branchFilter}) AS uniqueGroups,
          (SELECT COUNT(DISTINCT bd.menu_name_base) FROM FS_BillDetail bd WHERE bd.void_flag != '1' AND bd.is_revenue = '1' AND bd.IngestDate >= @from AND bd.IngestDate <= @to AND bd.menu_name_base IS NOT NULL ${branchFilter}) AS uniqueProducts
      `),
    ]);

    // Build option groups
    const groupMap = new Map<string, Array<{ name: string; qty: number }>>();
    for (const r of groupResult.recordset) {
      const group = r.OptionGroup as string;
      if (!groupMap.has(group)) groupMap.set(group, []);
      groupMap.get(group)!.push({ name: r.OptionValue as string, qty: (r.qty as number) ?? 0 });
    }
    const optionGroups = Array.from(groupMap.entries())
      .map(([groupName, options]) => ({
        groupName,
        totalQty: options.reduce((s, o) => s + o.qty, 0),
        options,
      }))
      .sort((a, b) => b.totalQty - a.totalQty);

    // Top combos
    const topCombos = comboResult.recordset.map((r: Record<string, unknown>) => ({
      menuName: r.menuName as string,
      optionGroup: r.optionGroup as string,
      optionValue: r.optionValue as string,
      qty: (r.qty as number) ?? 0,
      revenue: (r.revenue as number) ?? 0,
    }));

    // KPIs
    const kRow = kpiResult.recordset[0] ?? {};
    const totalItems = (kRow.totalItems as number) ?? 0;
    const itemsWithOption = (kRow.itemsWithOption as number) ?? 0;

    return NextResponse.json({
      ok: true,
      data: {
        optionGroups,
        topCombos,
        kpi: {
          totalItems,
          totalRevenue: (kRow.totalRevenue as number) ?? 0,
          itemsWithOption,
          optionRate: totalItems > 0 ? Math.round((itemsWithOption / totalItems) * 100) : 0,
          uniqueGroups: (kRow.uniqueGroups as number) ?? 0,
          uniqueProducts: (kRow.uniqueProducts as number) ?? 0,
        },
      },
    });
  } catch (err) {
    console.error("[api/intelligence/dashboards/product-option] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
