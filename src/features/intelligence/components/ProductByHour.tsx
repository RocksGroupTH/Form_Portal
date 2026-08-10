"use client";
import React, { useState, useMemo } from "react";
import { ReportLoading } from "./ReportLoading";
import { KpiCard } from "./KpiCard";
import { pctChange } from "@/features/intelligence/constants";

/* ── Helpers ── */

function formatBaht(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function heatColor(value: number, max: number): string {
  if (value === 0 || max === 0) return "transparent";
  const intensity = Math.min(value / max, 1);
  // Light to dark red
  const r = 220;
  const g = Math.round(240 - intensity * 200);
  const b = Math.round(240 - intensity * 200);
  return `rgb(${r}, ${g}, ${b})`;
}

/* ── Types ── */

interface ProductRow {
  menuName: string;
  totalQty: number;
  totalRevenue: number;
  hours: Record<string, number>;
}

interface ProductByHourData {
  products: ProductRow[];
  hours: string[];
  hourTotals: Record<string, number>;
  totalProducts: number;
  totalQty: number;
  totalRevenue: number;
}

interface Props {
  data: ProductByHourData | null;
  isLoading: boolean;
  vsData?: ProductByHourData | null;
}

export function ProductByHour({ data, isLoading, vsData }: Props) {
  const [search, setSearch] = useState("");

  const maxQty = useMemo(() => {
    if (!data) return 1;
    let max = 0;
    for (const p of data.products) {
      for (const h of data.hours) {
        const v = p.hours[h] ?? 0;
        if (v > max) max = v;
      }
    }
    return max || 1;
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (!search) return data.products;
    const s = search.toLowerCase();
    return data.products.filter((p) => p.menuName.toLowerCase().includes(s));
  }, [data, search]);

  if (isLoading || !data) return <ReportLoading />;

  const peakHour = data.hours.length > 0 ? data.hours.reduce((a, b) => (data.hourTotals[a] ?? 0) > (data.hourTotals[b] ?? 0) ? a : b) : "";

  return (
    <div className="flex flex-col gap-5">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard label="Total Revenue" value={formatBaht(data.totalRevenue)} trend={pctChange(data.totalRevenue, vsData?.totalRevenue)} />
        <KpiCard label="Total Qty" value={data.totalQty.toLocaleString()} trend={pctChange(data.totalQty, vsData?.totalQty)} />
        <KpiCard label="Products" value={String(data.totalProducts)} />
        <KpiCard label="Peak Hour" value={peakHour ? `${peakHour}:00` : "N/A"} />
        <KpiCard label="Hours Active" value={String(data.hours.length)} />
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search product..."
          className="rounded-lg px-3 py-2 text-[12px] outline-none w-64"
          style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
        />
        <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>
          {filtered.length} products
        </span>
        {/* Legend */}
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>Low</span>
          <div className="flex gap-0.5">
            {[0.1, 0.3, 0.5, 0.7, 0.9].map((v) => (
              <div key={v} className="w-4 h-3 rounded-sm" style={{ background: heatColor(v * maxQty, maxQty) }} />
            ))}
          </div>
          <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>High</span>
        </div>
      </div>

      {/* Matrix Table */}
      <div className="rounded-xl overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-sm)" }}>
        <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 340px)" }}>
          <table className="w-full text-[11px]" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
            <thead className="sticky top-0 z-10" style={{ background: "var(--bg-card)" }}>
              <tr style={{ borderBottom: "2px solid var(--border-main)" }}>
                <th className="text-left px-3 py-2 font-bold sticky left-0 z-20" style={{ color: "var(--text-muted)", background: "var(--bg-card)", minWidth: 160 }}>
                  Product
                </th>
                <th className="text-right px-2 py-2 font-bold" style={{ color: "var(--text-muted)", minWidth: 60 }}>Total</th>
                {data.hours.map((h) => (
                  <th key={h} className="text-center px-1 py-2 font-bold" style={{ color: h === peakHour ? "#dc2626" : "var(--text-muted)", minWidth: 44 }}>
                    {h}:00
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((product, idx) => (
                <tr
                  key={product.menuName}
                  className="transition-colors hover:!bg-[var(--bg-row-hover)]"
                  style={{ borderBottom: "1px solid var(--border-light)" }}
                >
                  <td
                    className="px-3 py-1.5 font-medium sticky left-0 z-10"
                    style={{
                      color: "var(--text-primary)",
                      background: idx % 2 === 1 ? "var(--bg-row-stripe)" : "var(--bg-card)",
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] w-5 shrink-0" style={{ color: "var(--text-faint)" }}>{idx + 1}</span>
                      {product.menuName}
                    </div>
                  </td>
                  <td className="text-right px-2 py-1.5 font-bold" style={{ color: "var(--text-heading)" }}>
                    {product.totalQty.toLocaleString()}
                  </td>
                  {data.hours.map((h) => {
                    const qty = product.hours[h] ?? 0;
                    return (
                      <td
                        key={h}
                        className="text-center px-1 py-1.5"
                        style={{
                          background: heatColor(qty, maxQty),
                          color: qty > 0 ? (qty / maxQty > 0.5 ? "#fff" : "var(--text-primary)") : "var(--text-faint)",
                          fontWeight: qty > 0 ? 600 : 400,
                        }}
                        title={`${product.menuName} at ${h}:00 — ${qty} qty`}
                      >
                        {qty > 0 ? qty : "·"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            {/* Hour totals */}
            <tfoot className="sticky bottom-0 z-10" style={{ background: "var(--bg-card)" }}>
              <tr style={{ borderTop: "2px solid var(--border-main)" }}>
                <td className="px-3 py-2 font-bold sticky left-0 z-20" style={{ color: "var(--text-heading)", background: "var(--bg-card)" }}>
                  Hour Total
                </td>
                <td className="text-right px-2 py-2 font-bold" style={{ color: "var(--text-heading)" }}>
                  {data.totalQty.toLocaleString()}
                </td>
                {data.hours.map((h) => (
                  <td key={h} className="text-center px-1 py-2 font-bold" style={{ color: h === peakHour ? "#dc2626" : "var(--text-heading)" }}>
                    {(data.hourTotals[h] ?? 0).toLocaleString()}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
