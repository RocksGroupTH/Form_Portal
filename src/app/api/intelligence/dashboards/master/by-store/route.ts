import type { NextRequest } from "next/server";
import {
  buildMasterContext,
  withCache,
  applyInputs,
  jsonResponse,
  errorResponse,
} from "@/lib/intelligence/master-route";
import { SQL_BY_STORE } from "@/features/intelligence/queries";

export interface ByStoreRow {
  branch_name: string;
  order_type: string;
  netSales: number;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await buildMasterContext(req, "master/by-store");
    if (ctx instanceof Response) return ctx;

    const data = await withCache<ByStoreRow[]>(ctx, async ({ pool, whereSql, inputs }) => {
      const request = applyInputs(pool.request(), inputs);
      const result = await request.query(SQL_BY_STORE(whereSql));
      return result.recordset.map((r: Record<string, unknown>) => ({
        branch_name: String(r.branch_name ?? "(blank)"),
        order_type: String(r.order_type ?? "(blank)"),
        netSales: Number(r.netSales ?? 0),
      }));
    });

    return jsonResponse({ ok: true, data });
  } catch (err) {
    console.error("[api/intelligence/dashboards/master/by-store] GET", err);
    return errorResponse("Internal server error", 500);
  }
}
