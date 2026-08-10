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

/* ── GET /api/intelligence/reports/promotion ── */

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;

    const { brand, from, to, branch } = parseDateParams(req);
    const validBrands = ["UNO", "KSI"];
    if (!validBrands.includes(brand)) {
      return NextResponse.json({ ok: false, error: "Invalid brand" }, { status: 400 });
    }

    const pool = await getFoodstoryPool(brand);
    const request = pool
      .request()
      .input("from", sql.Date, from)
      .input("to", sql.Date, to);

    let branchFilter = "";
    if (branch) {
      request.input("branch", sql.NVarChar, branch);
      branchFilter = "AND v.branch_name = (SELECT TOP 1 branch_name FROM FS_MasterBranch WHERE CAST(branch_id AS NVARCHAR) = @branch)";
    }

    const result = await request.query(`
      SELECT
        CONVERT(VARCHAR(10), v.IngestDate, 120) AS date,
        v.date AS dateTime,
        v.receipt_no AS receiptNo,
        v.branch_name AS branchName,
        v.voucher_code AS voucherCode,
        v.voucher_type AS voucherType,
        TRY_CAST(v.voucher_value AS FLOAT) AS voucherValue,
        TRY_CAST(v.voucher_discount AS FLOAT) AS discountAmount,
        TRY_CAST(v.total_amount AS FLOAT) AS totalAmount,
        TRY_CAST(v.total_remaining AS FLOAT) AS totalRemaining,
        v.employee_name AS employeeName
      FROM FS_VoucherUsage v
      WHERE v.IngestDate >= @from AND v.IngestDate <= @to
        ${branchFilter}
      ORDER BY v.IngestDate DESC, v.date DESC
    `);

    return NextResponse.json({ ok: true, data: result.recordset });
  } catch (err) {
    console.error("[api/intelligence/reports/promotion] GET", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
