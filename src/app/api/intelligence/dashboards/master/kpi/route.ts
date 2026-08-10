import type { NextRequest } from "next/server";
import {
  buildMasterContext,
  withCache,
  applyInputs,
  jsonResponse,
  errorResponse,
} from "@/lib/intelligence/master-route";
import { SQL_KPI } from "@/features/intelligence/queries";

export interface KpiRow {
  ym: string;
  netSales: number;
  avgTicket: number;
  ads: number;
  ticketCount: number;
  momPct: number | null;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await buildMasterContext(req, "master/kpi");
    if (ctx instanceof Response) return ctx;

    const data = await withCache<KpiRow[]>(ctx, async ({ pool, whereSql, inputs }) => {
      const request = applyInputs(pool.request(), inputs);
      const result = await request.query(SQL_KPI(whereSql));
      // Derive avgTicket / ads / momPct server-side so every caller
      // (KpiStrip, SummaryTab export, codex insights) sees identical
      // numbers — and so the 90s cache stores the fully-resolved row.
      // Mirrors the Dashboard reference's per-row computation.
      // SQL_KPI orders rows ASC by year, month so `prev` tracks the
      // previous month for MoM.
      let prev: number | null = null;
      return result.recordset.map((r: Record<string, unknown>) => {
        const netSales = Number(r.netSales ?? 0);
        const ticketCount = Number(r.ticketCount ?? 0);
        const distinctDays = Number(r.distinctDays ?? 0);
        const avgTicket = ticketCount > 0 ? netSales / ticketCount : 0;
        const ads = distinctDays > 0 ? netSales / distinctDays : 0;
        const momPct =
          prev === null || prev === 0 ? null : (netSales - prev) / prev;
        prev = netSales;
        return {
          ym: String(r.ym ?? ""),
          netSales,
          avgTicket,
          ads,
          ticketCount,
          momPct,
        };
      });
    });

    return jsonResponse({ ok: true, data });
  } catch (err) {
    console.error("[api/intelligence/dashboards/master/kpi] GET", err);
    return errorResponse("Internal server error", 500);
  }
}
