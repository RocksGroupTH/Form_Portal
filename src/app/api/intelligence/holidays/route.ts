import { NextRequest, NextResponse } from "next/server";
import { getCorePool, sql } from "@/lib/db/mssql";
import { requireAuth } from "@/lib/api-auth";

/* GET /api/intelligence/holidays?year=2026 */

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;

    const year = parseInt(req.nextUrl.searchParams.get("year") ?? String(new Date().getFullYear()), 10);

    const pool = await getCorePool();
    const result = await pool
      .request()
      .input("year", sql.Int, year)
      .query(`
        SELECT [Date], NameEn
        FROM [Rocks_Codex].[dbo].[Holiday] WITH (NOLOCK)
        WHERE [Year] = @year AND IsActive = 1
        ORDER BY [Date]
      `);

    const holidays = result.recordset.map((r: { Date: Date; NameEn: string }) => {
      // Use CONVERT in SQL instead to avoid timezone issues
      // But since we have the Date object, format it directly
      // The driver returns UTC midnight — the date part is correct as-is
      const d = r.Date;
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      return { date: `${y}-${m}-${day}`, name: r.NameEn };
    });

    return NextResponse.json({ ok: true, data: holidays });
  } catch (err) {
    console.error("[api/intelligence/holidays] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
