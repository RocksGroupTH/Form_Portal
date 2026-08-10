import type { NextRequest } from "next/server";
import {
  buildMasterContext,
  withCache,
  applyInputs,
  jsonResponse,
  errorResponse,
} from "@/lib/intelligence/master-route";
import { SQL_MODE_PROPORTION } from "@/features/intelligence/queries";

export interface ModeProportionRow {
  ym: string;
  order_type: string;
  share: number;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await buildMasterContext(req, "master/mode-proportion");
    if (ctx instanceof Response) return ctx;

    const data = await withCache<ModeProportionRow[]>(ctx, async ({ pool, whereSql, inputs }) => {
      const request = applyInputs(pool.request(), inputs);
      const result = await request.query(SQL_MODE_PROPORTION(whereSql));
      return result.recordset.map((r: Record<string, unknown>) => ({
        ym: String(r.ym ?? ""),
        order_type: String(r.order_type ?? "(blank)"),
        share: Number(r.share ?? 0),
      }));
    });

    return jsonResponse({ ok: true, data });
  } catch (err) {
    console.error("[api/intelligence/dashboards/master/mode-proportion] GET", err);
    return errorResponse("Internal server error", 500);
  }
}
