import { NextRequest, NextResponse } from "next/server";
import { getFoodstoryPool, sql } from "@/lib/db/mssql";
import { requireAuth } from "@/lib/api-auth";

/* ── GET /api/intelligence/dashboards/branch-performance ── */

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

    const pool = await getFoodstoryPool(brand);
    const request = pool.request()
      .input("from", sql.Date, from)
      .input("to", sql.Date, to);

    const result = await request.query(`
      SELECT
        b.branch_id AS branchId,
        m.branch_name AS branchName,
        m.branch_code AS branchCode,
        SUM(b.discounted_price_num) AS revenue,
        COUNT(DISTINCT b.receipt_no) AS billCount,
        SUM(b.quantity_num) AS itemCount
      FROM FS_BillDetail b
      LEFT JOIN (
        SELECT branch_id, branch_name, branch_code
        FROM FS_MasterBranch
        GROUP BY branch_id, branch_name, branch_code
      ) m ON CAST(b.branch_id AS NVARCHAR) = m.branch_id
      WHERE b.void_flag != '1' AND b.is_revenue = '1'
        AND b.IngestDate >= @from AND b.IngestDate <= @to
      GROUP BY b.branch_id, m.branch_name, m.branch_code
      ORDER BY revenue DESC
    `);

    const branches = result.recordset.map((r: Record<string, unknown>) => ({
      branchId: r.branchId as string,
      branchName: (r.branchName as string) ?? "",
      branchCode: (r.branchCode as string) ?? "",
      revenue: (r.revenue as number) ?? 0,
      billCount: (r.billCount as number) ?? 0,
      itemCount: (r.itemCount as number) ?? 0,
      avgTicket: (r.billCount as number) ? (r.revenue as number) / (r.billCount as number) : 0,
    }));

    return NextResponse.json({ ok: true, data: { branches } });
  } catch (err) {
    console.error("[api/intelligence/dashboards/branch-performance] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
