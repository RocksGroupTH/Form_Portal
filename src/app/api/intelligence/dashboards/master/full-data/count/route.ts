import type { NextRequest } from "next/server";
import {
  buildMasterContext,
  withCache,
  applyInputs,
  jsonResponse,
  errorResponse,
} from "@/lib/intelligence/master-route";
import { SQL_FULL_DATA_COUNT } from "@/features/intelligence/queries";

export async function GET(req: NextRequest) {
  try {
    const ctx = await buildMasterContext(req, "master/full-data/count");
    if (ctx instanceof Response) return ctx;

    const data = await withCache<{ count: number }>(ctx, async ({ pool, whereSql, inputs }) => {
      const request = applyInputs(pool.request(), inputs);
      const result = await request.query(SQL_FULL_DATA_COUNT(whereSql));
      const cnt = result.recordset[0]?.cnt;
      return { count: Number(cnt ?? 0) };
    });

    return jsonResponse({ ok: true, data });
  } catch (err) {
    console.error("[api/intelligence/dashboards/master/full-data/count] GET", err);
    return errorResponse("Internal server error", 500);
  }
}
