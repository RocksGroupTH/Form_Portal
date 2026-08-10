import type { NextRequest } from "next/server";
import {
  buildMasterContext,
  withCache,
  applyInputs,
  jsonResponse,
  errorResponse,
} from "@/lib/intelligence/master-route";
import { SQL_ADS_TREND } from "@/features/intelligence/queries";

export interface AdsTrendRow {
  branch_name: string;
  ym: string;
  ads: number;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await buildMasterContext(req, "master/ads-trend");
    if (ctx instanceof Response) return ctx;

    const data = await withCache<AdsTrendRow[]>(ctx, async ({ pool, whereSql, inputs }) => {
      const request = applyInputs(pool.request(), inputs);
      const result = await request.query(SQL_ADS_TREND(whereSql));
      return result.recordset.map((r: Record<string, unknown>) => {
        const netSales = Number(r.netSales ?? 0);
        const distinctDays = Number(r.distinctDays ?? 0);
        return {
          branch_name: String(r.branch_name ?? "(blank)"),
          ym: String(r.ym ?? ""),
          ads: distinctDays > 0 ? netSales / distinctDays : 0,
        };
      });
    });

    return jsonResponse({ ok: true, data });
  } catch (err) {
    console.error("[api/intelligence/dashboards/master/ads-trend] GET", err);
    return errorResponse("Internal server error", 500);
  }
}
