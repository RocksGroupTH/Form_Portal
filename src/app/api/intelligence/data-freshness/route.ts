import { NextResponse } from "next/server";
import { getFoodstoryPool, getCorePool } from "@/lib/db/mssql";
import { requireAuth } from "@/lib/api-auth";
import { env } from "@/env";

/**
 * GET /api/intelligence/data-freshness
 *
 * Returns last data timestamp for each enabled data source.
 * Queries all configured Foodstory brands and returns the most recent sync.
 */
export async function GET() {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;

    const results: Record<string, { lastDate: string | null; rowCount: number | null }> = {};
    const brands = env.FOODSTORY_BRANDS ?? {};
    const brandKeys = Object.keys(brands);

    // Foodstory POS — separate entry per brand (each has its own ETL_JobLog)
    for (const brand of brandKeys) {
      try {
        const fsPool = await getFoodstoryPool(brand);
        const fsSync = await fsPool.request().query(`
          SELECT TOP 1
            CONVERT(VARCHAR(19), CompletedAt, 120) as lastDate,
            [RowCount] as totalRows
          FROM ETL_JobLog
          WHERE Status = 'success'
          ORDER BY CompletedAt DESC
        `);
        const fsRow = fsSync.recordset[0];
        results[`Foodstory ${brand}`] = {
          lastDate: fsRow?.lastDate ?? null,
          rowCount: fsRow?.totalRows ?? null,
        };
      } catch {
        results[`Foodstory ${brand}`] = { lastDate: null, rowCount: null };
      }
    }

    // Location Master — from centralized ETL_JobLog (Rocks_PCTH_Data), shared across all brands
    try {
      const corePool = await getCorePool();
      const locSync = await corePool.request().query(`
        SELECT TOP 1
          CONVERT(VARCHAR(19), FinishedAt, 120) as lastDate
        FROM [Rocks_PCTH_Data].[dbo].[ETL_JobLog]
        WHERE JobName = 'LocationSync' AND Status = 'OK'
        ORDER BY FinishedAt DESC
      `);
      const locRow = locSync.recordset[0];
      // Sum branch count across all configured brands
      let branchCount: number | null = null;
      for (const brand of brandKeys) {
        try {
          const fsPool = await getFoodstoryPool(brand);
          const bcRes = await fsPool.request().query("SELECT COUNT(DISTINCT branch_id) as cnt FROM FS_MasterBranch");
          const cnt = bcRes.recordset[0]?.cnt ?? 0;
          branchCount = (branchCount ?? 0) + cnt;
        } catch { /* ignore */ }
      }
      results["Location Master"] = {
        lastDate: locRow?.lastDate ?? null,
        rowCount: branchCount,
      };
    } catch {
      results["Location Master"] = { lastDate: null, rowCount: null };
    }

    return NextResponse.json({ ok: true, data: results });
  } catch (err) {
    console.error("[api/intelligence/data-freshness]", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
