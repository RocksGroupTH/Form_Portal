"use client";
import React, { useMemo } from "react";
import { ReportLoading } from "./ReportLoading";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  PieChart,
  Pie,
} from "recharts";
import type { TopProductsData } from "@/features/intelligence/types";
import { CHART_COLORS, pctChange } from "@/features/intelligence/constants";
import { KpiCard } from "./KpiCard";

/* ── Helpers ── */

function formatBaht(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

const tooltipStyle: React.CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-card)",
  borderRadius: 12,
  padding: "8px 12px",
  boxShadow: "var(--shadow-md)",
  fontSize: 11,
  color: "var(--text-primary)",
};

const tooltipLabelStyle: React.CSSProperties = {
  color: "var(--text-muted)",
  fontWeight: 600,
  marginBottom: 2,
};

/* ── Pie label renderer ── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderPieLabel(props: any) {
  const { cx, cy, midAngle, innerRadius, outerRadius, percent, category } = props;
  if (percent < 0.04) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 1.3;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="var(--text-primary)" textAnchor={x > cx ? "start" : "end"} dominantBaseline="central" fontSize={10}>
      {category} ({(percent * 100).toFixed(0)}%)
    </text>
  );
}

/* ── Component ── */

interface Props {
  data: TopProductsData | null;
  isLoading: boolean;
  vsData?: TopProductsData | null;
}

export function TopProducts({ data, isLoading, vsData }: Props) {
  const products = data?.products ?? [];
  const top15 = useMemo(
    () => Array.from(products).sort((a, b) => b.revenue - a.revenue).slice(0, 15),
    [products],
  );
  // Use API totals (covers all products, not just TOP 50)
  const totalRevenue = data?.totalRevenue ?? products.reduce((s, p) => s + p.revenue, 0);
  const totalQty = data?.totalQuantity ?? products.reduce((s, p) => s + p.quantity, 0);

  if (isLoading || !data) return <ReportLoading />;

  const topProduct = top15[0]?.menuName ?? "N/A";
  const avgPrice = totalQty > 0 ? totalRevenue / totalQty : 0;

  return (
    <div className="flex flex-col gap-5">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard label="Total Revenue" value={formatBaht(totalRevenue)} trend={pctChange(totalRevenue, vsData?.totalRevenue)} />
        <KpiCard label="Total Qty" value={totalQty.toLocaleString()} trend={pctChange(totalQty, vsData?.totalQuantity)} />
        <KpiCard label="Avg Price" value={formatBaht(avgPrice)} trend={pctChange(avgPrice, vsData?.totalQuantity ? (vsData.totalRevenue ?? 0) / vsData.totalQuantity : undefined)} />
        <KpiCard label="Unique Products" value={String(products.length)} />
        <KpiCard label="Top Product" value={topProduct} />
      </div>

      {/* Top Products Horizontal Bar Chart */}
      <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-sm)" }}>
        <h3 className="text-[13px] font-bold mb-3" style={{ color: "var(--text-heading)" }}>
          Top 15 Products by Revenue
        </h3>
        <ResponsiveContainer width="100%" height={Math.max(300, top15.length * 36)}>
          <BarChart data={top15} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" horizontal={false} />
            <XAxis type="number" tickFormatter={(v: number) => formatBaht(v)} tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="menuName" width={140} tick={{ fontSize: 10, fill: "var(--text-primary)" }} axisLine={false} tickLine={false} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const d = payload[0].payload;
                const pct = totalRevenue > 0 ? ((d.revenue / totalRevenue) * 100).toFixed(1) : "0";
                return (
                  <div style={tooltipStyle}>
                    <p style={tooltipLabelStyle}>{d.menuName}</p>
                    <p style={{ margin: 0, fontSize: 11 }}>Revenue: <strong>{formatBaht(d.revenue)}</strong> ({pct}%)</p>
                    <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted)" }}>Qty: {d.quantity?.toLocaleString()} · Avg: {formatBaht(d.avgPrice)}</p>
                  </div>
                );
              }}
            />
            <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
              {top15.map((_, idx) => (
                <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Category Pie Chart + Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-sm)" }}>
          <h3 className="text-[13px] font-bold mb-3" style={{ color: "var(--text-heading)" }}>
            Category Revenue Share
          </h3>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={data.categories} dataKey="revenue" nameKey="category" cx="50%" cy="50%" outerRadius={100} innerRadius={50} label={renderPieLabel} labelLine={false}>
                {data.categories.map((_, idx) => (
                  <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} formatter={(value) => [formatBaht(Number(value)), "Revenue"]} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Category Breakdown */}
        <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-sm)" }}>
          <h3 className="text-[13px] font-bold mb-3" style={{ color: "var(--text-heading)" }}>
            Category Breakdown
          </h3>
          <div className="flex flex-col gap-3">
            {data.categories.map((cat, i) => {
              const pct = totalRevenue > 0 ? (cat.revenue / totalRevenue) * 100 : 0;
              return (
                <div key={cat.category}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                      <span className="text-[12px] font-bold" style={{ color: "var(--text-heading)" }}>{cat.category}</span>
                    </div>
                    <span className="text-[12px] font-bold" style={{ color: "var(--text-heading)" }}>{formatBaht(cat.revenue)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--bg-badge)" }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
                    </div>
                    <span className="text-[10px] font-medium w-10 text-right" style={{ color: "var(--text-muted)" }}>{pct.toFixed(1)}%</span>
                    <span className="text-[10px] shrink-0" style={{ color: "var(--text-faint)" }}>{cat.quantity.toLocaleString()} qty</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Products Table */}
      <div className="rounded-xl overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-sm)" }}>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-light)", background: "var(--bg-card-alt)" }}>
                <th className="text-left px-4 py-2.5 font-semibold" style={{ color: "var(--text-muted)" }}>#</th>
                <th className="text-left px-4 py-2.5 font-semibold" style={{ color: "var(--text-muted)" }}>Product</th>
                <th className="text-left px-4 py-2.5 font-semibold" style={{ color: "var(--text-muted)" }}>Category</th>
                <th className="text-right px-4 py-2.5 font-semibold" style={{ color: "var(--text-muted)" }}>Revenue</th>
                <th className="text-right px-4 py-2.5 font-semibold" style={{ color: "var(--text-muted)" }}>% Total</th>
                <th className="text-right px-4 py-2.5 font-semibold" style={{ color: "var(--text-muted)" }}>Qty</th>
                <th className="text-right px-4 py-2.5 font-semibold" style={{ color: "var(--text-muted)" }}>Avg Price</th>
              </tr>
            </thead>
            <tbody>
              {Array.from(products).sort((a, b) => b.revenue - a.revenue).map((product, idx) => {
                const pct = totalRevenue > 0 ? (product.revenue / totalRevenue) * 100 : 0;
                return (
                  <tr
                    key={`${product.menuName}-${idx}`}
                    className="transition-colors hover:!bg-[var(--bg-row-hover)]"
                    style={{ borderBottom: "1px solid var(--border-light)", background: idx % 2 === 1 ? "var(--bg-row-stripe)" : undefined }}
                  >
                    <td className="px-4 py-2" style={{ color: "var(--text-muted)" }}>{idx + 1}</td>
                    <td className="px-4 py-2 font-medium" style={{ color: "var(--text-primary)" }}>{product.menuName}</td>
                    <td className="px-4 py-2" style={{ color: "var(--text-secondary)" }}>{product.category}</td>
                    <td className="px-4 py-2 text-right font-semibold" style={{ color: "var(--text-heading)" }}>{formatBaht(product.revenue)}</td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center gap-1.5 justify-end">
                        <div className="w-12 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-badge)" }}>
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--nav-active-text)" }} />
                        </div>
                        <span className="text-[10px] font-medium w-10 text-right" style={{ color: "var(--text-muted)" }}>{pct.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right" style={{ color: "var(--text-secondary)" }}>{product.quantity.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right" style={{ color: "var(--text-secondary)" }}>{formatBaht(product.avgPrice)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--border-main)", background: "var(--bg-card-alt)" }}>
                <td className="px-4 py-2 font-bold" style={{ color: "var(--text-heading)" }} colSpan={3}>Total</td>
                <td className="px-4 py-2 text-right font-bold" style={{ color: "var(--text-heading)" }}>{formatBaht(totalRevenue)}</td>
                <td className="px-4 py-2 text-right font-bold" style={{ color: "var(--text-muted)" }}>100%</td>
                <td className="px-4 py-2 text-right font-bold" style={{ color: "var(--text-heading)" }}>{totalQty.toLocaleString()}</td>
                <td className="px-4 py-2 text-right font-bold" style={{ color: "var(--text-heading)" }}>{formatBaht(avgPrice)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
