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

/* ── GET /api/intelligence/reports/edc ── */

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
      branchFilter = "AND CAST(b.branch_id AS NVARCHAR) = @branch";
      request.input("branch", sql.NVarChar, branch);
    }

    const result = await request.query(`
      SELECT
        CONVERT(VARCHAR(10), b.IngestDate, 120) AS date,
        b.time,
        b.receipt_no AS receiptNo,
        m.branch_name AS branchName,
        b.payment_type AS cardType,
        b.edc_serial_no AS edcSerial,
        b.credit_card_id AS creditCardId,
        b.discounted_price_num AS amount
      FROM FS_BillDetail b
      LEFT JOIN (SELECT branch_id, branch_name, branch_code FROM FS_MasterBranch GROUP BY branch_id, branch_name, branch_code) m ON CAST(b.branch_id AS NVARCHAR) = m.branch_id
      WHERE b.void_flag != '1'
        AND b.edc_serial_no IS NOT NULL AND b.edc_serial_no != ''
        AND b.IngestDate >= @from AND b.IngestDate <= @to
        ${branchFilter}
      ORDER BY b.IngestDate DESC, b.time DESC
    `);

    return NextResponse.json({ ok: true, data: result.recordset });
  } catch (err) {
    console.error("[api/intelligence/reports/edc] GET", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
