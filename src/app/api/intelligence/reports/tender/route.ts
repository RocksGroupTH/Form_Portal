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

/* ── GET /api/intelligence/reports/tender ── */

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
      ;WITH TenderCTE AS (
        SELECT
          CONVERT(VARCHAR(10), b.IngestDate, 120) AS date,
          CASE
            WHEN b.payment_type LIKE 'QR%' OR b.payment_type = 'QRCode' THEN 'QR Code'
            WHEN b.payment_type IN ('grab pay', 'grabpay', 'Grab') THEN 'Grab Pay'
            WHEN b.payment_type IN ('VISA', 'Master Card', 'JCB', 'American Express', 'UnionPay', 'Credit card', 'POS Pay Credit Card') THEN 'Credit Card'
            WHEN b.payment_type IN ('PromptPay') THEN 'PromptPay'
            WHEN b.payment_type IN ('LINE Pay') THEN 'LINE Pay'
            WHEN b.payment_type IN ('Alipay+', 'Alipay', 'WeChat Pay') THEN 'International Pay'
            WHEN b.payment_type IN ('TrueMoney') THEN 'TrueMoney'
            WHEN b.payment_type IN ('Bank Transfer') THEN 'Bank Transfer'
            WHEN b.payment_type IN ('Cash') THEN 'Cash'
            WHEN b.payment_type IN ('Voucher', 'vouchers') THEN 'Voucher'
            WHEN b.payment_type IN ('Barista Quota', 'Baista Quota') THEN 'Barista Quota'
            WHEN b.payment_type LIKE '%Waste%' OR b.payment_type LIKE '%waste%' THEN 'Waste'
            ELSE 'Other'
          END AS tenderGroup,
          b.payment_type AS tenderDetail,
          b.receipt_no,
          b.discounted_price_num
        FROM FS_BillDetail b
        LEFT JOIN (SELECT branch_id, branch_name, branch_code FROM FS_MasterBranch GROUP BY branch_id, branch_name, branch_code) m ON CAST(b.branch_id AS NVARCHAR) = m.branch_id
        WHERE b.void_flag != '1'
          AND b.IngestDate >= @from AND b.IngestDate <= @to
          ${branchFilter}
      )
      SELECT
        date,
        tenderGroup,
        tenderDetail,
        COUNT(DISTINCT receipt_no) AS bills,
        SUM(discounted_price_num) AS revenue
      FROM TenderCTE
      GROUP BY date, tenderGroup, tenderDetail
      ORDER BY date DESC, SUM(discounted_price_num) DESC
    `);

    return NextResponse.json({ ok: true, data: result.recordset });
  } catch (err) {
    console.error("[api/intelligence/reports/tender] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
