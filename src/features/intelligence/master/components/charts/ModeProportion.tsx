"use client";

import { useMemo } from "react";
import { useMasterFilters } from "@/features/intelligence/master/hooks/useMasterFilters";
import { useMasterData } from "@/features/intelligence/master/hooks/useMasterData";
import { ModeProportionRow } from "@/features/intelligence/master/types";
import { formatMonthYearShort } from "@/features/intelligence/master/lib/format";
import { ChartEmpty, ChartError, ChartSkeleton } from "./ChartState";

/**
 * Channel Proportion table.
 *   Rows = order_type (Delivery / Dine-In / Take Away)
 *   Cols = months in scope (chronological)
 *   Each column sums to 100% (NetSalse share within that month).
 *
 * Backed by /api/intelligence/dashboards/master/mode-proportion
 * which returns { ym, order_type, share }.
 */
export function ModeProportion({ brand }: { brand: string }) {
  const { queryString } = useMasterFilters();
  const apiQs = queryString
    ? `${queryString}&brand=${brand}`
    : `?brand=${brand}`;
  const { data, isLoading, error } = useMasterData<ModeProportionRow[]>(
    "/api/intelligence/dashboards/master/mode-proportion",
    apiQs
  );

  const { months, types, byKey } = useMemo(() => {
    const monthsSet = new Set<string>();
    const typesSet = new Set<string>();
    const byKey = new Map<string, number>();
    for (const r of data ?? []) {
      monthsSet.add(r.ym);
      typesSet.add(r.order_type);
      byKey.set(`${r.ym}|${r.order_type}`, r.share);
    }
    const months = Array.from(monthsSet).sort((a, b) => a.localeCompare(b));
    const PRIORITY = ["Delivery", "Dine-In", "Take Away"];
    const types = Array.from(typesSet).sort((a, b) => {
      const ai = PRIORITY.indexOf(a);
      const bi = PRIORITY.indexOf(b);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      return a.localeCompare(b);
    });
    return { months, types, byKey };
  }, [data]);

  if (error) return <ChartError message={error.message} />;
  if (isLoading || !data) return <ChartSkeleton />;
  if (months.length === 0 || types.length === 0)
    return <ChartEmpty icon="🥯" title="No mode breakdown" />;

  // Always show 1 decimal place — independent of month count.
  const decimals = 1;
  // Bump column width slightly so "33.4%" never wraps even with many months.
  const monthColWidth = months.length > 6 ? 48 : 56;

  return (
    <div className="chart-enter overflow-x-auto scroll-thin">
      <table className="table-fixed text-[11px] tabular-nums border-collapse min-w-full">
        <colgroup>
          <col style={{ width: 60 }} />
          {months.map((m) => (
            <col key={m} style={{ width: monthColWidth }} />
          ))}
        </colgroup>
        <thead>
          <tr style={{ color: "var(--text-muted)" }}>
            <th className="text-left font-medium pr-1 py-0.5">Mode</th>
            {months.map((m) => (
              <th
                key={m}
                className="text-right font-medium px-1 py-0.5 whitespace-nowrap"
                title={formatMonthYearShort(m)}
              >
                {formatMonthYearShort(m)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {types.map((t) => (
            <tr key={t} style={{ borderTop: "1px solid var(--border-card)" }}>
              <td
                className="pr-1 py-1 truncate"
                style={{ color: "var(--text-primary)" }}
                title={t}
              >
                {t}
              </td>
              {months.map((m) => {
                const share = byKey.get(`${m}|${t}`) ?? 0;
                const pct = share * 100;
                return (
                  <td
                    key={m}
                    className="px-1 py-1 text-right relative whitespace-nowrap"
                    style={{
                      backgroundImage: `linear-gradient(to right, rgba(193,70,42,0.12) 0%, rgba(193,70,42,0.12) ${pct}%, transparent ${pct}%)`,
                    }}
                  >
                    <span
                      className="relative font-semibold"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {pct.toFixed(decimals)}%
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
          <tr style={{ borderTop: "1px solid var(--border-card)" }}>
            <td
              className="pr-1 py-0.5 text-[9px] uppercase tracking-wide"
              style={{ color: "var(--text-muted)" }}
            >
              Total
            </td>
            {months.map((m) => {
              const sum = types.reduce(
                (s, t) => s + (byKey.get(`${m}|${t}`) ?? 0),
                0
              );
              return (
                <td
                  key={m}
                  className="px-1 py-0.5 text-right text-[9px] whitespace-nowrap"
                  style={{ color: "var(--text-muted)" }}
                >
                  {(sum * 100).toFixed(0)}%
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
