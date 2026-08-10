import type { NextRequest } from "next/server";
import {
  buildMasterContext,
  withCache,
  applyInputs,
  jsonResponse,
  errorResponse,
} from "@/lib/intelligence/master-route";
import { SQL_TICKET_BY_SALE_TYPE } from "@/features/intelligence/queries";

export interface TicketBySaleTypeRow {
  ym: string;
  order_type: string;
  ticketCount: number;
  avgPerTicket: number;
}

export async function GET(req: NextRequest) {
  try {
    const ctx = await buildMasterContext(req, "master/ticket-by-sale-type");
    if (ctx instanceof Response) return ctx;

    const data = await withCache<TicketBySaleTypeRow[]>(ctx, async ({ pool, whereSql, inputs }) => {
      const request = applyInputs(pool.request(), inputs);
      const result = await request.query(SQL_TICKET_BY_SALE_TYPE(whereSql));
      return result.recordset.map((r: Record<string, unknown>) => {
        const ticketCount = Number(r.ticketCount ?? 0);
        const netSales = Number(r.netSales ?? 0);
        return {
          ym: String(r.ym ?? ""),
          order_type: String(r.order_type ?? "(blank)"),
          ticketCount,
          avgPerTicket: ticketCount > 0 ? netSales / ticketCount : 0,
        };
      });
    });

    return jsonResponse({ ok: true, data });
  } catch (err) {
    console.error("[api/intelligence/dashboards/master/ticket-by-sale-type] GET", err);
    return errorResponse("Internal server error", 500);
  }
}
