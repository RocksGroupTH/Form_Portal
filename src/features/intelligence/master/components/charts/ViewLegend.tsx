"use client";

import { useMemo, useState } from "react";
import { useMasterFilters } from "@/features/intelligence/master/hooks/useMasterFilters";
import { useMasterData } from "@/features/intelligence/master/hooks/useMasterData";
import { ColorByKey, MetricKey, SalesByRow } from "@/features/intelligence/master/types";
import { colorFor } from "@/features/intelligence/master/lib/palette";
import { formatTHB } from "@/features/intelligence/master/lib/format";

function formatMetric(v: number, metric: MetricKey): string {
  if (metric === "ticketCount") return Math.round(v).toLocaleString("en-US");
  if (metric === "ticketAvg") {
    // Average usage — plain decimal, no ฿.
    return v.toLocaleString("en-US", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  }
  return formatTHB(v);
}

/**
 * Color legend for the main bar chart.
 *
 * Reads the same `/api/intelligence/dashboards/master/sales-by/<colorBy>` data the chart
 * uses — SWR dedupes, so this is "free". Re-sorts dimensions by total NetSales desc
 * so the legend order matches the bar stack order.
 *
 * For high-cardinality views (Item Name → 100+ menu items) we add a
 * search box and a scrollable list with sticky header, plus a per-row
 * total so the legend doubles as a quick "top items" reference. The
 * Hourly view stays as the simple chronological list with no search.
 */
export function ViewLegend({
  brand,
  colorBy,
  metric = "netSales",
}: {
  brand: string;
  colorBy: ColorByKey;
  metric?: MetricKey;
}) {
  const { queryString } = useMasterFilters();
  const apiQs = queryString
    ? `${queryString}&brand=${brand}&metric=${metric}`
    : `?brand=${brand}&metric=${metric}`;
  const { data } = useMasterData<SalesByRow[]>(
    `/api/intelligence/dashboards/master/sales-by/${colorBy}`,
    apiQs
  );
  const [query, setQuery] = useState("");

  // Aggregate totals per dim — drives both ordering and the per-row value.
  const entries = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of data ?? []) {
      totals.set(r.dim, (totals.get(r.dim) ?? 0) + r.netSales);
    }
    if (colorBy === "hour") {
      // Chronological order; no totals needed for hour rows.
      return Array.from(totals.keys())
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => ({ key: k, total: totals.get(k) ?? 0 }));
    }
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([key, total]) => ({ key, total }));
  }, [data, colorBy]);

  const filtered = useMemo(() => {
    if (!query.trim()) return entries;
    const q = query.toLowerCase();
    return entries.filter((e) => e.key.toLowerCase().includes(q));
  }, [entries, query]);

  if (!data || entries.length === 0) {
    return (
      <div
        className="text-[11px] py-1"
        style={{ color: "var(--text-muted)" }}
      >
        No legend yet
      </div>
    );
  }

  // Show the search box + scroll container + total only when there are
  // enough rows that the simple flat list would overflow the rail.
  const HEAVY_THRESHOLD = 12;
  const isHeavy = colorBy !== "hour" && entries.length > HEAVY_THRESHOLD;

  return (
    <div className="flex flex-col gap-1.5">
      {isHeavy ? (
        <>
          <div className="flex items-center justify-between gap-2 text-[9px]">
            <span
              className="tabular-nums"
              style={{ color: "var(--text-muted)" }}
            >
              {filtered.length}/{entries.length}
            </span>
            <span style={{ color: "var(--text-muted)" }}>sorted by NetSales</span>
          </div>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter…"
            className="w-full text-[11px] rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-inset"
            style={{
              border: "1px solid var(--border-card)",
              background: "var(--bg-card)",
              color: "var(--text-primary)",
            }}
          />
          <div className="max-h-[420px] overflow-y-auto scroll-thin pr-1 -mr-1">
            <ul className="flex flex-col gap-1">
              {filtered.map((e, i) => (
                <LegendRow
                  key={e.key}
                  index={entries.findIndex((x) => x.key === e.key)}
                  rank={i + 1}
                  label={e.key}
                  total={e.total}
                  metric={metric}
                  showRank
                />
              ))}
              {filtered.length === 0 && (
                <li
                  className="text-[11px] py-1"
                  style={{ color: "var(--text-muted)" }}
                >
                  No matches
                </li>
              )}
            </ul>
          </div>
        </>
      ) : (
        <ul className="flex flex-col gap-1">
          {entries.map((e, i) => (
            <LegendRow
              key={e.key}
              index={i}
              label={e.key}
              total={colorBy === "hour" ? null : e.total}
              metric={metric}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function LegendRow({
  index,
  label,
  total,
  metric,
  rank,
  showRank,
}: {
  /** Position in the original (unfiltered) sorted list — drives the
   *  palette colour so it stays consistent regardless of search filter. */
  index: number;
  label: string;
  /** null = don't render a value column (used for hour). */
  total: number | null;
  metric: MetricKey;
  rank?: number;
  showRank?: boolean;
}) {
  return (
    <li
      className="flex items-center gap-2 text-[11px]"
      style={{ color: "var(--text-primary)" }}
      title={total != null ? `${label} — ${formatMetric(total, metric)}` : label}
    >
      <span
        className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
        style={{ backgroundColor: colorFor(label, index) }}
      />
      {showRank && rank ? (
        <span
          className="text-[8px] tabular-nums w-4 shrink-0"
          style={{ color: "var(--text-muted)" }}
        >
          {rank}.
        </span>
      ) : null}
      <span className="truncate flex-1">{label}</span>
      {total != null && (
        <span
          className="text-[9px] tabular-nums shrink-0"
          style={{ color: "var(--text-muted)" }}
        >
          {formatMetric(total, metric)}
        </span>
      )}
    </li>
  );
}
