import { NextRequest, NextResponse } from "next/server";
import { getFoodstoryPool, sql } from "@/lib/db/mssql";
import { requireAuth } from "@/lib/api-auth";

function parseDateParams(req: NextRequest) {
  const brand = req.nextUrl.searchParams.get("brand") ?? "UNO";
  const from = req.nextUrl.searchParams.get("from") ?? "";
  const to = req.nextUrl.searchParams.get("to") ?? "";
  const branch = req.nextUrl.searchParams.get("branch") ?? null;
  return { brand, from, to, branch };
}

/* ── GET /api/intelligence/reports/sales-item ── */

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;

    const { brand, from, to, branch } = parseDateParams(req);
    if (!["UNO", "KSI"].includes(brand)) {
      return NextResponse.json({ ok: false, error: "Invalid brand" }, { status: 400 });
    }

    const pool = await getFoodstoryPool(brand);
    const request = pool
      .request()
      .input("from", sql.Date, from)
      .input("to", sql.Date, to);

    let branchFilter = "";
    if (branch) {
      branchFilter = "AND CAST(b.branch_id AS NVARCHAR) = @branch";
      request.input("branch", sql.NVarChar, branch);
    }

    const result = await request.query(`
      SELECT
        b.menu_name_base AS menuName,
        b.category,
        m.branch_name AS branchName,
        SUM(b.quantity_num) AS quantity,
        SUM(b.discounted_price_num) AS revenue,
        AVG(b.price_num) AS avgPrice,
        COUNT(DISTINCT b.receipt_no) AS bills,
        COUNT(DISTINCT b.IngestDate) AS days
      FROM FS_BillDetail b
      LEFT JOIN (SELECT branch_id, branch_name, branch_code FROM FS_MasterBranch GROUP BY branch_id, branch_name, branch_code) m ON CAST(b.branch_id AS NVARCHAR) = m.branch_id
      WHERE b.void_flag != '1' AND b.is_revenue = '1'
        AND b.IngestDate >= @from AND b.IngestDate <= @to
        AND b.menu_name_base IS NOT NULL AND b.menu_name_base != ''
        ${branchFilter}
      GROUP BY b.menu_name_base, b.category, m.branch_name
      ORDER BY revenue DESC
    `);

    return NextResponse.json({ ok: true, data: result.recordset });
  } catch (err) {
    console.error("[api/intelligence/reports/sales-item] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
