import { NextRequest, NextResponse } from "next/server";
import { getFoodstoryPool } from "@/lib/db/mssql";
import { requireAuth } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;

    const brand = req.nextUrl.searchParams.get("brand") ?? "UNO";
    const validBrands = ["UNO", "KSI"];
    if (!validBrands.includes(brand)) {
      return NextResponse.json({ ok: false, error: "Invalid brand" }, { status: 400 });
    }

    const pool = await getFoodstoryPool(brand);
    const result = await pool.request().query(
      "SELECT CAST(branch_id AS NVARCHAR) AS branchId, MAX(branch_code) AS branchCode, MAX(branch_name) AS branchName, MIN(sort_order) AS sortOrder FROM FS_MasterBranch GROUP BY branch_id ORDER BY MIN(sort_order)"
    );

    return NextResponse.json({ ok: true, data: result.recordset });
  } catch (err) {
    console.error("[api/intelligence/branches] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
