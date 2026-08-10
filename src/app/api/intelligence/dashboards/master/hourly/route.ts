import type { NextRequest } from "next/server";
import {
  buildMasterContext,
  withCache,
  applyInputs,
  jsonResponse,
  errorResponse,
} from "@/lib/intelligence/master-route";
import { SQL_HOURLY } from "@/features/intelligence/queries";

export interface HourlyRow {
  hour: number;
  netSales: number;
  ads: number;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await buildMasterContext(req, "master/hourly");
    if (ctx instanceof Response) return ctx;

    const data = await withCache<HourlyRow[]>(ctx, async ({ pool, whereSql, inputs }) => {
      const request = applyInputs(pool.request(), inputs);
      const result = await request.query(SQL_HOURLY(whereSql));
      return result.recordset.map((r: Record<string, unknown>) => {
        const netSales = Number(r.netSales ?? 0);
        const distinctDays = Number(r.distinctDays ?? 0);
        return {
          hour: Number(r.hour ?? 0),
          netSales,
          ads: distinctDays > 0 ? netSales / distinctDays : 0,
        };
      });
    });

    return jsonResponse({ ok: true, data });
  } catch (err) {
    console.error("[api/intelligence/dashboards/master/hourly] GET", err);
    return errorResponse("Internal server error", 500);
  }
}
