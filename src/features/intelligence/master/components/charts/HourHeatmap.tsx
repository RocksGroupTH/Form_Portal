"use client";

import { useMasterFilters } from "@/features/intelligence/master/hooks/useMasterFilters";
import { useMasterData } from "@/features/intelligence/master/hooks/useMasterData";
import { HourlyRow } from "@/features/intelligence/master/types";
import { BarsSkeleton, ChartEmpty, ChartError } from "./ChartState";

/**
 * "Average Ticket by Hour"
 *
 *   ADS_h  = SUM(NetSales for hour=h) / COUNT(DISTINCT date)
 *   pct[h] = ADS_h / SUM(ADS_h for all hours) * 100      (table-down %)
 *
 * Rows where ADS_h = 0 are hidden. The remaining rows always sum to 100 %.
 *
 * (Filename kept as `HourHeatmap.tsx` to avoid import churn — the visual
 * went from heatmap → percent table per the latest spec.)
 *
 * NOTE: bg-orange-* classes in the gradient background are intentional —
 * they form an intensity scale, not a brand color. Do not replace with CSS vars.
 */
export function HourHeatmap({ brand }: { brand: string }) {
  const { queryString } = useMasterFilters();
  const apiQs = queryString
    ? `${queryString}&brand=${brand}`
    : `?brand=${brand}`;
  const { data, isLoading, error } = useMasterData<HourlyRow[]>(
    "/api/intelligence/dashboards/master/hourly",
    apiQs
  );

  if (error) return <ChartError message={error.message} />;
  if (isLoading || !data) return <BarsSkeleton rows={12} />;

  // Keep only hours with positive ADS, then convert to % of total ADS.
  const active = data.filter((r) => r.ads > 0);
  const totalAds = active.reduce((s, r) => s + r.ads, 0);

  if (active.length === 0 || totalAds <= 0) {
    return (
      <ChartEmpty
        icon="☕"
        title="No hourly sales yet"
        hint="ลองเปลี่ยนช่วงเดือนหรือลบฟิลเตอร์บางตัวเพื่อดูข้อมูลรายชั่วโมง"
      />
    );
  }

  const rows = active.map((r) => ({
    hour: r.hour,
    pct: (r.ads / totalAds) * 100,
  }));

  return (
    <table className="w-full text-[11px] tabular-nums border-collapse chart-enter">
      <thead>
        <tr style={{ color: "var(--text-muted)" }}>
          <th className="text-left font-medium pr-2 py-0.5 w-[42px]">Hour</th>
          <th className="text-right font-medium pr-1 py-0.5">% of Total ADS</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr
            key={r.hour}
            style={{ borderTop: "1px solid var(--border-card)", opacity: 0.7 }}
          >
            <td
              className="pr-2 py-[3px] font-medium"
              style={{ color: "var(--text-primary)" }}
            >
              {String(r.hour).padStart(2, "0")}:00
            </td>
            <td
              className="pr-1 py-[3px] text-right whitespace-nowrap relative"
              style={{
                backgroundImage: `linear-gradient(to right, rgba(193,70,42,0.12) 0%, rgba(193,70,42,0.12) ${r.pct.toFixed(
                  2
                )}%, transparent ${r.pct.toFixed(2)}%)`,
              }}
            >
              <span
                className="relative font-semibold"
                style={{ color: "var(--text-primary)" }}
              >
                {r.pct.toFixed(1)}%
              </span>
            </td>
          </tr>
        ))}
        <tr style={{ borderTop: "1px solid var(--border-card)" }}>
          <td
            className="pr-2 py-0.5 text-[9px] uppercase tracking-wide"
            style={{ color: "var(--text-muted)" }}
          >
            Total
          </td>
          <td
            className="pr-1 py-0.5 text-right text-[9px]"
            style={{ color: "var(--text-muted)" }}
          >
            100%
          </td>
        </tr>
      </tbody>
    </table>
  );
}
