import type { NextRequest } from "next/server";
import {
  buildMasterContext,
  withCache,
  applyInputs,
  jsonResponse,
  errorResponse,
} from "@/lib/intelligence/master-route";
import {
  SQL_SALES_BY,
  type ColorByKey,
  type MetricKey,
} from "@/features/intelligence/queries";

export interface SalesByRow {
  day: string;
  dim: string;
  netSales: number;
}

const COLOR_BY_VALUES: ColorByKey[] = [
  "channel",
  "order_type",
  "payment_type",
  "hour",
  "category",
  "menu_name",
];
const METRIC_VALUES: MetricKey[] = ["netSales", "ticketCount", "ticketAvg"];

function isColorBy(v: string): v is ColorByKey {
  return (COLOR_BY_VALUES as string[]).includes(v);
}
function isMetric(v: string): v is MetricKey {
  return (METRIC_VALUES as string[]).includes(v);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ colorBy: string }> },
) {
  try {
    const { colorBy } = await params;
    if (!isColorBy(colorBy)) {
      return errorResponse(`Invalid colorBy: ${colorBy}`, 400);
    }

    const metricRaw = req.nextUrl.searchParams.get("metric") ?? "netSales";
    if (!isMetric(metricRaw)) {
      return errorResponse(`Invalid metric: ${metricRaw}`, 400);
    }
    const metric: MetricKey = metricRaw;

    const ctx = await buildMasterContext(req, `master/sales-by/${colorBy}:${metric}`);
    if (ctx instanceof Response) return ctx;

    const data = await withCache<SalesByRow[]>(ctx, async ({ pool, whereSql, inputs }) => {
      const request = applyInputs(pool.request(), inputs);
      const result = await request.query(SQL_SALES_BY(colorBy, whereSql, metric));
      return result.recordset.map((r: Record<string, unknown>) => ({
        day: String(r.day ?? ""),
        dim: String(r.dim ?? "(blank)"),
        netSales: Number(r.netSales ?? 0),
      }));
    });

    return jsonResponse({ ok: true, data });
  } catch (err) {
    console.error("[api/intelligence/dashboards/master/sales-by] GET", err);
    return errorResponse("Internal server error", 500);
  }
}
