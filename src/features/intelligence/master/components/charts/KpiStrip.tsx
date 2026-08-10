"use client";

import { useMasterFilters } from "@/features/intelligence/master/hooks/useMasterFilters";
import { useMasterData } from "@/features/intelligence/master/hooks/useMasterData";
import { KpiRow } from "@/features/intelligence/master/types";
import { formatMonthYear, formatTHB } from "@/features/intelligence/master/lib/format";
import { ChartEmpty, ChartError, StripSkeleton } from "./ChartState";

export function KpiStrip({ brand }: { brand: string }) {
  const { queryString } = useMasterFilters();
  const apiQs = queryString
    ? `${queryString}&brand=${brand}`
    : `?brand=${brand}`;
  const { data, isLoading, error } = useMasterData<KpiRow[]>(
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
          Net Sales Detail
        </div>
        <div className="text-[11px] leading-snug" style={{ color: "var(--text-muted)" }}>
          {data?.length ? `${data.length} months` : ""}
        </div>
      </div>
      {error ? (
        <ChartError message={error.message} />
      ) : isLoading || !data ? (
        <StripSkeleton cells={3} />
      ) : data.length === 0 ? (
        <div className="h-14 flex items-center justify-center">
          <ChartEmpty
            icon="🧾"
            title="No sales in this range"
            hint="ลองเปลี่ยนเดือนหรือล้างฟิลเตอร์"
          />
        </div>
      ) : (
        <div
          className="grid gap-2 chart-enter"
          style={{
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          }}
        >
          {data.map((r) => (
            <div
              key={r.ym}
              className="min-w-0 rounded-lg px-2 py-1.5 flex items-center justify-between gap-2"
              style={{
                border: "1px solid var(--border-card)",
                background: "var(--bg-base)",
              }}
            >
              <div
                className="text-[12px] font-semibold truncate"
                style={{ color: "var(--nav-active-text)" }}
              >
                {formatMonthYear(r.ym)}
              </div>
              <div className="text-right min-w-0">
                <div
                  className="text-[9px] uppercase tracking-wide"
                  style={{ color: "var(--text-muted)" }}
                >
                  NetSales
                </div>
                <div className="text-[14px] font-semibold tabular-nums tracking-tight text-positive">
                  {formatTHB(r.netSales)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
