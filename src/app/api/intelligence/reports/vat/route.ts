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

/* ── GET /api/intelligence/reports/vat ── */

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
        CONVERT(VARCHAR(10), b.IngestDate, 120) AS date,
        m.branch_name AS branchName,
        SUM(b.discounted_price_num) AS grossSales,
        SUM(b.discounted_price_num / 1.07) AS netSales,
        SUM(b.discounted_price_num - b.discounted_price_num / 1.07) AS vatAmount,
        COUNT(DISTINCT b.receipt_no) AS bills
      FROM FS_BillDetail b
      LEFT JOIN (SELECT branch_id, branch_name, branch_code FROM FS_MasterBranch GROUP BY branch_id, branch_name, branch_code) m ON CAST(b.branch_id AS NVARCHAR) = m.branch_id
      WHERE b.void_flag != '1' AND b.is_revenue = '1'
        AND b.IngestDate >= @from AND b.IngestDate <= @to
        ${branchFilter}
      GROUP BY b.IngestDate, m.branch_name
      ORDER BY b.IngestDate DESC, SUM(b.discounted_price_num) DESC
    `);

    return NextResponse.json({ ok: true, data: result.recordset });
  } catch (err) {
    console.error("[api/intelligence/reports/vat] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
