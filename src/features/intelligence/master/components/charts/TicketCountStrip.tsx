"use client";

import { useMasterFilters } from "@/features/intelligence/master/hooks/useMasterFilters";
import { useMasterData } from "@/features/intelligence/master/hooks/useMasterData";
import { KpiRow } from "@/features/intelligence/master/types";
import { formatMonthYear, formatTHB } from "@/features/intelligence/master/lib/format";
import { ChartEmpty, ChartError, StripSkeleton } from "./ChartState";

/**
 * "Average Ticket Usage" strip — one cell per month showing
 *   AVG_TICKET = SUM(NetSales) / COUNT(unique_order_code)
 * Component name kept (`TicketCountStrip`) to avoid import churn in page.tsx.
 */
export function TicketCountStrip({ brand }: { brand: string }) {
  const { queryString } = useMasterFilters();
  const apiQs = queryString
    ? `${queryString}&brand=${brand}`
    : `?brand=${brand}`;
  const { data, error, isLoading } = useMasterData<KpiRow[]>(
    "/api/intelligence/dashboards/master/kpi",
    apiQs
  );

  return (
    <div className="card p-2">
      <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 mb-1.5">
        <div
          className="text-[11px] uppercase tracking-[0.08em] font-semibold font-display"
          style={{ color: "var(--text-muted)" }}
        >
          Average Ticket Usage
        </div>
        <div className="text-[11px] leading-snug" style={{ color: "var(--text-muted)" }}>
          SUM(NetSales) / COUNT(DISTINCT unique_order_code)
        </div>
      </div>
      {error ? (
        <ChartError message={error.message} />
      ) : isLoading || !data ? (
        <StripSkeleton cells={3} />
      ) : data.length === 0 ? (
        <div className="h-12 flex items-center justify-center">
          <ChartEmpty icon="🎫" title="No tickets in this range" />
        </div>
      ) : (
        <div
          className="grid gap-2 chart-enter"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          }}
        >
          {data.map((r) => {
            const avg = r.ticketCount > 0 ? r.netSales / r.ticketCount : 0;
            return (
              <div
                key={r.ym}
                className="min-w-0 rounded-lg px-2 py-1.5 flex items-center justify-between gap-2"
                style={{
                  border: "1px solid var(--border-card)",
                  background: "var(--bg-card)",
                }}
              >
                <div
                  className="text-[12px] font-semibold truncate"
                  style={{ color: "var(--text-primary)" }}
                >
                  {formatMonthYear(r.ym)}
                </div>
                <div className="text-right">
                  <div
                    className="text-[9px] uppercase tracking-wide"
                    style={{ color: "var(--text-muted)" }}
                  >
                    Avg / Ticket
                  </div>
                  <div
                    className="text-[14px] font-semibold tabular-nums tracking-tight"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {formatTHB(avg, 2)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
