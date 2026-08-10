"use client";

import { useMemo } from "react";
import { useMasterFilters } from "@/features/intelligence/master/hooks/useMasterFilters";
import { useMasterData } from "@/features/intelligence/master/hooks/useMasterData";
import { AdsTrendRow } from "@/features/intelligence/master/types";
import { formatMonthYearShort, formatTHB } from "@/features/intelligence/master/lib/format";
import { ChartEmpty, ChartError, ChartSkeleton } from "./ChartState";

/**
 * Branch ADS — Month-over-Month % Change.
 *
 * Cell formula:
 *   ADS[branch, m]   = SUM(NetSalse) / COUNT(DISTINCT CAST(order_datetime AS date))
 *   pctDiff[m]       = (ADS[m] - ADS[m-1]) / ADS[m-1]   ← Tableau "Percent
 *                       Difference From, Table Across (previous)" equivalent.
 *
 * Layout:
 *   Y axis  = branch_name (rows, sorted A → Z)
 *   X axis  = month-year (chronological, oldest → newest)
 *   first column has no comparison → render "—"
 */
export function MonthAdsChart({ brand }: { brand: string }) {
  const { queryString } = useMasterFilters();
  const apiQs = queryString
    ? `${queryString}&brand=${brand}`
    : `?brand=${brand}`;
  const { data, isLoading, error } = useMasterData<AdsTrendRow[]>(
    "/api/intelligence/dashboards/master/ads-trend",
    apiQs
  );

  const { months, branches, byKey } = useMemo(() => {
    const monthsSet = new Set<string>();
    const branchesSet = new Set<string>();
    const byKey = new Map<string, number>();
    for (const r of data ?? []) {
      monthsSet.add(r.ym);
      branchesSet.add(r.branch_name);
      byKey.set(`${r.branch_name}|${r.ym}`, r.ads);
    }
    const months = Array.from(monthsSet).sort();
    // Branch rows sorted A → Z (case-insensitive).
    const branches = Array.from(branchesSet).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
    return { months, branches, byKey };
  }, [data]);

  if (error) return <ChartError message={error.message} />;
  if (isLoading || !data) return <ChartSkeleton />;
  if (months.length === 0 || branches.length === 0)
    return <ChartEmpty icon="📈" title="No ADS data" />;

  return (
    <div className="chart-enter w-full">
      <table className="w-full text-[11px] tabular-nums border-collapse">
        <thead>
          <tr
            style={{
              color: "var(--text-muted)",
              background: "var(--bg-card)",
              position: "sticky",
              top: 0,
              zIndex: 10,
            }}
          >
            <th
              className="text-left font-medium pr-2 py-1"
              style={{
                position: "sticky",
                left: 0,
                background: "var(--bg-card)",
              }}
            >
              Branch
            </th>
            {months.map((m, i) => (
              <th
                key={m}
                className="text-right font-medium px-1.5 py-1 whitespace-nowrap"
                title={
                  i === 0
                    ? "First month — no prior month to compare"
                    : `vs ${formatMonthYearShort(months[i - 1])}`
                }
              >
                {formatMonthYearShort(m)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {branches.map((b) => (
            <tr key={b} style={{ borderTop: "1px solid var(--border-card)" }}>
              <td
                className="pr-2 py-[3px] truncate max-w-[160px]"
                style={{
                  position: "sticky",
                  left: 0,
                  background: "var(--bg-card)",
                  color: "var(--text-primary)",
                }}
              >
                {b}
              </td>
              {months.map((m, i) => {
                const curr = byKey.get(`${b}|${m}`);
                if (curr === undefined) {
                  return (
                    <td
                      key={m}
                      className="px-1.5 py-[3px] text-right"
                      style={{ color: "var(--text-muted)" }}
                    >
                      —
                    </td>
                  );
                }
                const prev = i > 0 ? byKey.get(`${b}|${months[i - 1]}`) : undefined;
                const hasComparison =
                  i > 0 && prev !== undefined && prev !== 0;
                const pct = hasComparison ? (curr - prev!) / prev! : 0;
                const positive = pct >= 0;
                const arrow = hasComparison ? (positive ? "▲" : "▼") : "";
                // Colors: positive = #15b357 (green financial), negative = accent/red
                const pctColor = !hasComparison
                  ? "var(--text-muted)"
                  : positive
                  ? "#15b357"
                  : "var(--color-accent, #c1472a)";
                // Background bar visualises % magnitude (capped at 100%).
                const mag = hasComparison ? Math.min(Math.abs(pct), 1) * 100 : 0;
                const bg = !hasComparison
                  ? "transparent"
                  : positive
                  ? `linear-gradient(to right, rgba(21,179,87,0.14) 0%, rgba(21,179,87,0.14) ${mag}%, transparent ${mag}%)`
                  : `linear-gradient(to right, rgba(193,71,40,0.14) 0%, rgba(193,71,40,0.14) ${mag}%, transparent ${mag}%)`;
                return (
                  <td
                    key={m}
                    className="px-1.5 py-[3px] text-right whitespace-nowrap relative"
                    style={{ backgroundImage: bg }}
                  >
                    <div className="relative leading-tight flex flex-col items-end">
                      <span
                        className="font-semibold"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {formatTHB(curr)}
                      </span>
                      <span
                        className="text-[9px] font-semibold"
                        style={{ color: pctColor }}
                      >
                        {hasComparison ? `${arrow} ${(pct * 100).toFixed(1)}%` : "—"}
                      </span>
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
