"use client";
import React, { useState, useMemo } from "react";
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
} from "recharts";
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

/* ── Types ── */

interface HourlyRow {
  hour: string;
  label: string;
  revenue: number;
  bills: number;
  qty: number;
}

interface TopProduct {
  menuName: string;
  revenue: number;
  qty: number;
}

interface HourlyProductsData {
  hourly: HourlyRow[];
  topByHour: Record<string, TopProduct[]>;
  kpi: {
    totalRevenue: number;
    totalBills: number;
    peakHour: string;
    peakRevenue: number;
    avgHourlyRevenue: number;
  };
}

interface Props {
  data: HourlyProductsData | null;
  isLoading: boolean;
  vsData?: HourlyProductsData | null;
}

export function HourlyProducts({ data, isLoading, vsData }: Props) {
  const [selectedHour, setSelectedHour] = useState<string | null>(null);

  const peakHourCode = useMemo(() => {
    if (!data || data.hourly.length === 0) return null;
    return data.hourly.reduce((a, b) => a.revenue > b.revenue ? a : b).hour;
  }, [data]);

  if (isLoading || !data) return <ReportLoading />;

  const topProducts = selectedHour ? (data.topByHour[selectedHour] ?? []) : [];

  return (
    <div className="flex flex-col gap-5">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard label="Total Revenue" value={formatBaht(data.kpi.totalRevenue)} trend={pctChange(data.kpi.totalRevenue, vsData?.kpi?.totalRevenue)} />
        <KpiCard label="Total Bills" value={data.kpi.totalBills.toLocaleString()} trend={pctChange(data.kpi.totalBills, vsData?.kpi?.totalBills)} />
        <KpiCard label="Peak Hour" value={data.kpi.peakHour} />
        <KpiCard label="Peak Revenue" value={formatBaht(data.kpi.peakRevenue)} trend={pctChange(data.kpi.peakRevenue, vsData?.kpi?.peakRevenue)} />
        <KpiCard label="Avg per Hour" value={formatBaht(data.kpi.avgHourlyRevenue)} trend={pctChange(data.kpi.avgHourlyRevenue, vsData?.kpi?.avgHourlyRevenue)} />
      </div>

      {/* Revenue by Hour Bar Chart */}
      <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-sm)" }}>
        <h3 className="text-[13px] font-bold mb-1" style={{ color: "var(--text-heading)" }}>
          Revenue by Hour
        </h3>
        <p className="text-[11px] mb-3" style={{ color: "var(--text-muted)" }}>
          Click a bar to see top products for that hour
        </p>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data.hourly}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v: number) => formatBaht(v)} tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={50} />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const d = payload[0].payload as HourlyRow;
                return (
                  <div style={tooltipStyle}>
                    <p style={tooltipLabelStyle}>{d.label}</p>
                    <p style={{ margin: 0, fontSize: 11 }}>Revenue: <strong>{formatBaht(d.revenue)}</strong></p>
                    <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted)" }}>Bills: {d.bills.toLocaleString()} · Qty: {d.qty.toLocaleString()}</p>
                  </div>
                );
              }}
            />
            <Bar dataKey="revenue" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(d: any) => setSelectedHour(d.hour)}>
              {data.hourly.map((entry) => (
                <Cell
                  key={entry.hour}
                  fill={entry.hour === selectedHour ? "var(--nav-active-text)" : entry.hour === peakHourCode ? "#dc2626" : "var(--btn-primary-bg)"}
                  opacity={selectedHour && entry.hour !== selectedHour ? 0.4 : 0.85}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Bills by Hour + Top Products side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Bills by Hour */}
        <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-sm)" }}>
          <h3 className="text-[13px] font-bold mb-3" style={{ color: "var(--text-heading)" }}>
            Bills by Hour
          </h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.hourly}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={40} />
              <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} formatter={(value) => [Number(value).toLocaleString(), "Bills"]} />
              <Bar dataKey="bills" fill="#16a34a" opacity={0.8} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Top Products for Selected Hour */}
        <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-sm)" }}>
          <h3 className="text-[13px] font-bold mb-3" style={{ color: "var(--text-heading)" }}>
            {selectedHour ? `Top Products at ${selectedHour}:00` : "Top Products (click an hour)"}
          </h3>
          {selectedHour && topProducts.length > 0 ? (
            <div className="flex flex-col gap-2.5">
              {topProducts.map((p, i) => {
                const maxRev = topProducts[0]?.revenue ?? 1;
                const pct = maxRev > 0 ? (p.revenue / maxRev) * 100 : 0;
                return (
                  <div key={p.menuName}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold w-5" style={{ color: "var(--text-muted)" }}>{i + 1}</span>
                        <span className="text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>{p.menuName}</span>
                      </div>
                      <span className="text-[12px] font-bold" style={{ color: "var(--text-heading)" }}>{formatBaht(p.revenue)}</span>
                    </div>
                    <div className="flex items-center gap-2 ml-7">
                      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--bg-badge)" }}>
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
                      </div>
                      <span className="text-[10px] shrink-0" style={{ color: "var(--text-faint)" }}>{p.qty.toLocaleString()} qty</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center justify-center h-40" style={{ color: "var(--text-faint)" }}>
              <p className="text-[12px]">Click a bar in the Revenue chart to see top products</p>
            </div>
          )}
        </div>
      </div>

      {/* Hourly Table */}
      <div className="rounded-xl overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-sm)" }}>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-light)", background: "var(--bg-card-alt)" }}>
                <th className="text-left px-4 py-2.5 font-semibold" style={{ color: "var(--text-muted)" }}>Hour</th>
                <th className="text-right px-4 py-2.5 font-semibold" style={{ color: "var(--text-muted)" }}>Revenue</th>
                <th className="text-right px-4 py-2.5 font-semibold" style={{ color: "var(--text-muted)" }}>% Total</th>
                <th className="text-right px-4 py-2.5 font-semibold" style={{ color: "var(--text-muted)" }}>Bills</th>
                <th className="text-right px-4 py-2.5 font-semibold" style={{ color: "var(--text-muted)" }}>Qty</th>
                <th className="text-right px-4 py-2.5 font-semibold" style={{ color: "var(--text-muted)" }}>Avg Ticket Size</th>
                <th className="text-left px-4 py-2.5 font-semibold" style={{ color: "var(--text-muted)" }}>Top Product</th>
              </tr>
            </thead>
            <tbody>
              {data.hourly.map((h, idx) => {
                const pct = data.kpi.totalRevenue > 0 ? (h.revenue / data.kpi.totalRevenue) * 100 : 0;
                const topProd = data.topByHour[h.hour]?.[0]?.menuName ?? "—";
                return (
                  <tr
                    key={h.hour}
                    className="transition-colors hover:!bg-[var(--bg-row-hover)] cursor-pointer"
                    style={{
                      borderBottom: "1px solid var(--border-light)",
                      background: h.hour === selectedHour ? "var(--nav-active-bg)" : idx % 2 === 1 ? "var(--bg-row-stripe)" : undefined,
                    }}
                    onClick={() => setSelectedHour(h.hour)}
                  >
                    <td className="px-4 py-2 font-bold" style={{ color: h.hour === peakHourCode ? "#dc2626" : "var(--text-primary)" }}>
                      {h.label} {h.hour === peakHourCode ? "🔥" : ""}
                    </td>
                    <td className="px-4 py-2 text-right font-semibold" style={{ color: "var(--text-heading)" }}>{formatBaht(h.revenue)}</td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center gap-1.5 justify-end">
                        <div className="w-12 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-badge)" }}>
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--nav-active-text)" }} />
                        </div>
                        <span className="text-[10px] font-medium w-10 text-right" style={{ color: "var(--text-muted)" }}>{pct.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right" style={{ color: "var(--text-secondary)" }}>{h.bills.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right" style={{ color: "var(--text-secondary)" }}>{h.qty.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right" style={{ color: "var(--text-secondary)" }}>{h.bills > 0 ? formatBaht(h.revenue / h.bills) : "—"}</td>
                    <td className="px-4 py-2" style={{ color: "var(--text-muted)" }}>{topProd}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--border-main)", background: "var(--bg-card-alt)" }}>
                <td className="px-4 py-2 font-bold" style={{ color: "var(--text-heading)" }}>Total</td>
                <td className="px-4 py-2 text-right font-bold" style={{ color: "var(--text-heading)" }}>{formatBaht(data.kpi.totalRevenue)}</td>
                <td className="px-4 py-2 text-right font-bold" style={{ color: "var(--text-muted)" }}>100%</td>
                <td className="px-4 py-2 text-right font-bold" style={{ color: "var(--text-heading)" }}>{data.kpi.totalBills.toLocaleString()}</td>
                <td className="px-4 py-2 text-right font-bold" style={{ color: "var(--text-heading)" }}>{data.hourly.reduce((s, h) => s + h.qty, 0).toLocaleString()}</td>
                <td className="px-4 py-2 text-right font-bold" style={{ color: "var(--text-heading)" }}>{data.kpi.totalBills > 0 ? formatBaht(data.kpi.totalRevenue / data.kpi.totalBills) : "—"}</td>
                <td className="px-4 py-2" />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
