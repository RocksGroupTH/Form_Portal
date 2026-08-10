import { NextRequest, NextResponse } from "next/server";
import { getFoodstoryPool, sql } from "@/lib/db/mssql";
import { requireAuth } from "@/lib/api-auth";

interface TenderRow {
  tenderGroup: string;
  revenue: number;
  bills: number;
}

const TENDER_CASE = `
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
  END`;

/* ── GET /api/intelligence/dashboards/payment-mix ── */

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;

    const brand = req.nextUrl.searchParams.get("brand") ?? "UNO";
    if (!["UNO", "KSI"].includes(brand)) {
      return NextResponse.json({ ok: false, error: "Invalid brand" }, { status: 400 });
    }

    const fromParam = req.nextUrl.searchParams.get("from");
    const toParam = req.nextUrl.searchParams.get("to");
    const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days")) || 30, 1), 365);
    const branch = req.nextUrl.searchParams.get("branch") ?? null;

    const pool = await getFoodstoryPool(brand);

    // ── Daily breakdown by tender group ──
    const dailyReq = pool.request();
    let dateFilter: string;
    if (fromParam && toParam) {
      dailyReq.input("from", sql.Date, fromParam);
      dailyReq.input("to", sql.Date, toParam);
      dateFilter = "b.IngestDate >= @from AND b.IngestDate <= @to";
    } else {
      dailyReq.input("days", sql.Int, days);
      dateFilter = "b.IngestDate >= DATEADD(DAY, -@days, GETDATE())";
    }

    let branchFilter = "";
    if (branch) {
      branchFilter = "AND CAST(b.branch_id AS NVARCHAR) = @branch";
      dailyReq.input("branch", sql.NVarChar, branch);
    }

    const dailyResult = await dailyReq.query(`
      SELECT
        CONVERT(VARCHAR(10), b.IngestDate, 120) AS date,
        ${TENDER_CASE} AS tenderGroup,
        SUM(b.discounted_price_num) AS revenue,
        COUNT(DISTINCT b.receipt_no) AS bills
      FROM FS_BillDetail b
      WHERE b.void_flag != '1' AND b.is_revenue = '1'
        AND ${dateFilter}
        ${branchFilter}
      GROUP BY b.IngestDate, ${TENDER_CASE}
      ORDER BY b.IngestDate
    `);

    // Pivot: group by date, split by tender group
    const dateMap = new Map<string, Record<string, number>>();
    const tenderSet = new Set<string>();
    for (const r of dailyResult.recordset) {
      const date = r.date as string;
      const tg = (r.tenderGroup as string) ?? "Other";
      tenderSet.add(tg);
      let entry = dateMap.get(date);
      if (!entry) { entry = { revenue: 0, bills: 0 }; dateMap.set(date, entry); }
      entry.revenue += (r.revenue as number) ?? 0;
      entry.bills += (r.bills as number) ?? 0;
      entry[`revenue_${tg}`] = ((entry[`revenue_${tg}`] ?? 0) as number) + ((r.revenue as number) ?? 0);
      entry[`bills_${tg}`] = ((entry[`bills_${tg}`] ?? 0) as number) + ((r.bills as number) ?? 0);
    }

    const tenderNames = Array.from(tenderSet);
    const daily = Array.from(dateMap.entries()).map(([date, e]) => ({
      date,
      revenue: e.revenue,
      bills: e.bills,
      ...Object.fromEntries(tenderNames.flatMap((tg) => [
        [`revenue_${tg}`, e[`revenue_${tg}`] ?? 0],
        [`bills_${tg}`, e[`bills_${tg}`] ?? 0],
      ])),
    }));

    // ── Aggregate by tender group ──
    const tenderReq = pool.request();
    if (fromParam && toParam) {
      tenderReq.input("from", sql.Date, fromParam);
      tenderReq.input("to", sql.Date, toParam);
    } else {
      tenderReq.input("days", sql.Int, days);
    }
    if (branch) tenderReq.input("branch", sql.NVarChar, branch);

    const tenderResult = await tenderReq.query(`
      SELECT
        ${TENDER_CASE} AS tenderGroup,
        SUM(b.discounted_price_num) AS revenue,
        COUNT(DISTINCT b.receipt_no) AS bills
      FROM FS_BillDetail b
      WHERE b.void_flag != '1' AND b.is_revenue = '1'
        AND ${dateFilter}
        ${branchFilter}
      GROUP BY ${TENDER_CASE}
      ORDER BY SUM(b.discounted_price_num) DESC
    `);

    const tenders: TenderRow[] = tenderResult.recordset.map((r: TenderRow) => ({
      tenderGroup: r.tenderGroup ?? "Other",
      revenue: r.revenue ?? 0,
      bills: r.bills ?? 0,
    }));

    // ── KPIs ──
    const totalRevenue = tenders.reduce((s, t) => s + t.revenue, 0);
    const totalBills = tenders.reduce((s, t) => s + t.bills, 0);
    const cashRow = tenders.find((t) => t.tenderGroup === "Cash");
    const cashRevenue = cashRow?.revenue ?? 0;
    const cashPct = totalRevenue > 0 ? (cashRevenue / totalRevenue) * 100 : 0;
    const digitalRevenue = totalRevenue - cashRevenue;
    const digitalPct = totalRevenue > 0 ? (digitalRevenue / totalRevenue) * 100 : 0;
    const topMethod = tenders[0]?.tenderGroup ?? "N/A";

    const kpi = { totalRevenue, totalBills, cashRevenue, cashPct, digitalRevenue, digitalPct, topMethod };
    const data = { daily, tenders, tenderNames, kpi };

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/intelligence/dashboards/payment-mix] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
