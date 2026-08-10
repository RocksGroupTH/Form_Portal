"use client";
import React, { useMemo } from "react";
import { ReportLoading } from "./ReportLoading";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  PieChart,
  Pie,
  Legend,
} from "recharts";
import type { PaymentMixData } from "@/features/intelligence/types";
import { CHART_COLORS, pctChange } from "@/features/intelligence/constants";
import { KpiCard } from "./KpiCard";
import { Banknote, Smartphone } from "lucide-react";

/* ── Helpers ── */

function formatBaht(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function formatPct(n: number): string {
  return `${n.toFixed(1)}%`;
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

/* ── Stable color map for tender groups ── */

const TENDER_COLOR_MAP: Record<string, string> = {
  Cash: "#16a34a",
  "QR Code": "#2563eb",
  "Credit Card": "#7c3aed",
  "Grab Pay": "#00b14f",
  PromptPay: "#1e40af",
  "LINE Pay": "#06c755",
  TrueMoney: "#f97316",
  "International Pay": "#ec4899",
  "Bank Transfer": "#06b6d4",
  Voucher: "#f59e0b",
  "Barista Quota": "#8b5cf6",
  Waste: "#6b7280",
  Other: "#9ca3af",
};

function getTenderColor(name: string, idx: number): string {
  return TENDER_COLOR_MAP[name] ?? CHART_COLORS[idx % CHART_COLORS.length];
}

/* ── Pie label ── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderPieLabel(props: any) {
  const { cx, cy, midAngle, innerRadius, outerRadius, percent, tenderGroup } = props;
  if (percent < 0.04) return null;
  const RADIAN = Math.PI / 180;
  const radius = innerRadius + (outerRadius - innerRadius) * 1.3;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="var(--text-heading)" textAnchor={x > cx ? "start" : "end"} dominantBaseline="central" fontSize={10}>
      {tenderGroup} ({(percent * 100).toFixed(0)}%)
    </text>
  );
}

/* ── Component ── */

interface Props {
  data: PaymentMixData | null;
  isLoading: boolean;
  vsData?: PaymentMixData | null;
}

export function PaymentMix({ data, isLoading, vsData }: Props) {
  const tenders = data?.tenders ?? [];
  const daily = data?.daily ?? [];
  const tenderNames = data?.tenderNames ?? [];
  const kpi = data?.kpi;

  // Sort tenders by revenue for display
  const sortedTenders = useMemo(
    () => Array.from(tenders).sort((a, b) => b.revenue - a.revenue),
    [tenders],
  );

  // Top tender groups for stacked area (max 8, rest merged into "Other")
  const topTenderNames = useMemo(() => {
    const sorted = Array.from(tenders).sort((a, b) => b.revenue - a.revenue);
    return sorted.slice(0, 8).map((t) => t.tenderGroup);
  }, [tenders]);

  if (isLoading || !data) return <ReportLoading />;

  const totalRevenue = kpi?.totalRevenue ?? 0;
  const totalBills = kpi?.totalBills ?? 0;

  return (
    <div className="flex flex-col gap-5">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard label="Total Revenue" value={formatBaht(totalRevenue)} trend={pctChange(totalRevenue, vsData?.kpi?.totalRevenue)} />
        <KpiCard label="Total Bills" value={totalBills.toLocaleString()} trend={pctChange(totalBills, vsData?.kpi?.totalBills)} />
        <KpiCard
          label="Cash"
          value={formatPct(kpi?.cashPct ?? 0)}
          subtitle={formatBaht(kpi?.cashRevenue ?? 0)}
          icon={<Banknote size={14} />}
          trend={pctChange(kpi?.cashRevenue ?? 0, vsData?.kpi?.cashRevenue)}
        />
        <KpiCard
          label="Digital"
          value={formatPct(kpi?.digitalPct ?? 0)}
          subtitle={formatBaht(kpi?.digitalRevenue ?? 0)}
          icon={<Smartphone size={14} />}
          trend={pctChange(kpi?.digitalRevenue ?? 0, vsData?.kpi?.digitalRevenue)}
        />
        <KpiCard label="Top Method" value={kpi?.topMethod ?? "N/A"} />
      </div>

      {/* Stacked Area Chart — Daily revenue by payment method */}
      <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-sm)" }}>
        <h3 className="text-[13px] font-bold mb-3" style={{ color: "var(--text-heading)" }}>
          Daily Revenue by Payment Method
        </h3>
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={daily} margin={{ left: 8, right: 16, top: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
            <XAxis
              dataKey="date"
              tickFormatter={(v: string) => v.slice(5)}
              tick={{ fontSize: 10, fill: "var(--text-muted)" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(v: number) => formatBaht(v)}
              tick={{ fontSize: 10, fill: "var(--text-muted)" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelStyle={tooltipLabelStyle}
              labelFormatter={(v) => v}
              formatter={(value, name) => [formatBaht(Number(value)), String(name).replace("revenue_", "")]}
            />
            <Legend
              wrapperStyle={{ fontSize: 10 }}
              formatter={(value: string) => <span style={{ color: "var(--text-heading)" }}>{value.replace("revenue_", "")}</span>}
            />
            {topTenderNames.map((tg, idx) => (
              <Area
                key={tg}
                type="monotone"
                dataKey={`revenue_${tg}`}
                stackId="1"
                stroke={getTenderColor(tg, idx)}
                fill={getTenderColor(tg, idx)}
                fillOpacity={0.6}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Pie Chart + Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Donut Chart */}
        <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-sm)" }}>
          <h3 className="text-[13px] font-bold mb-3" style={{ color: "var(--text-heading)" }}>
            Revenue Share by Payment Method
          </h3>
          <ResponsiveContainer width="100%" height={400}>
            <PieChart>
              <Pie
                data={sortedTenders}
                dataKey="revenue"
                nameKey="tenderGroup"
                cx="50%"
                cy="50%"
                outerRadius={150}
                innerRadius={70}
                label={renderPieLabel}
                labelLine={false}
              >
                {sortedTenders.map((t, idx) => (
                  <Cell key={t.tenderGroup} fill={getTenderColor(t.tenderGroup, idx)} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value) => [formatBaht(Number(value)), "Revenue"]}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Method Breakdown with progress bars */}
        <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-sm)" }}>
          <h3 className="text-[13px] font-bold mb-3" style={{ color: "var(--text-heading)" }}>
            Payment Method Breakdown
          </h3>
          <div className="flex flex-col gap-3">
            {sortedTenders.map((t, i) => {
              const pct = totalRevenue > 0 ? (t.revenue / totalRevenue) * 100 : 0;
              return (
                <div key={t.tenderGroup}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ background: getTenderColor(t.tenderGroup, i) }} />
                      <span className="text-[12px] font-bold" style={{ color: "var(--text-heading)" }}>{t.tenderGroup}</span>
                    </div>
                    <span className="text-[12px] font-bold" style={{ color: "var(--text-heading)" }}>{formatBaht(t.revenue)}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--bg-badge)" }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: getTenderColor(t.tenderGroup, i) }} />
                    </div>
                    <span className="text-[10px] font-medium w-10 text-right" style={{ color: "var(--text-muted)" }}>{pct.toFixed(1)}%</span>
                    <span className="text-[10px] shrink-0" style={{ color: "var(--text-faint)" }}>{t.bills.toLocaleString()} bills</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bills by Payment Method — Horizontal Bar Chart */}
      <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-sm)" }}>
        <h3 className="text-[13px] font-bold mb-3" style={{ color: "var(--text-heading)" }}>
          Bill Count by Payment Method
        </h3>
        <ResponsiveContainer width="100%" height={Math.max(200, sortedTenders.length * 36)}>
          <BarChart data={sortedTenders} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={(v: number) => v.toLocaleString()}
              tick={{ fontSize: 10, fill: "var(--text-muted)" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="tenderGroup"
              width={120}
              tick={{ fontSize: 10, fill: "var(--text-primary)" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const d = payload[0].payload;
                const pct = totalBills > 0 ? ((d.bills / totalBills) * 100).toFixed(1) : "0";
                return (
                  <div style={tooltipStyle}>
                    <p style={tooltipLabelStyle}>{d.tenderGroup}</p>
                    <p style={{ margin: 0, fontSize: 11 }}>Bills: <strong>{d.bills.toLocaleString()}</strong> ({pct}%)</p>
                    <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted)" }}>Revenue: {formatBaht(d.revenue)}</p>
                  </div>
                );
              }}
            />
            <Bar dataKey="bills" radius={[0, 4, 4, 0]}>
              {sortedTenders.map((t, idx) => (
                <Cell key={t.tenderGroup} fill={getTenderColor(t.tenderGroup, idx)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Detailed Table */}
      <div className="rounded-xl overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-sm)" }}>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-light)", background: "var(--bg-card-alt)" }}>
                <th className="text-left px-4 py-2.5 font-semibold" style={{ color: "var(--text-muted)" }}>#</th>
                <th className="text-left px-4 py-2.5 font-semibold" style={{ color: "var(--text-muted)" }}>Payment Method</th>
                <th className="text-right px-4 py-2.5 font-semibold" style={{ color: "var(--text-muted)" }}>Revenue</th>
                <th className="text-right px-4 py-2.5 font-semibold" style={{ color: "var(--text-muted)" }}>% Revenue</th>
                <th className="text-right px-4 py-2.5 font-semibold" style={{ color: "var(--text-muted)" }}>Bills</th>
                <th className="text-right px-4 py-2.5 font-semibold" style={{ color: "var(--text-muted)" }}>% Bills</th>
                <th className="text-right px-4 py-2.5 font-semibold" style={{ color: "var(--text-muted)" }}>Avg / Bill</th>
              </tr>
            </thead>
            <tbody>
              {sortedTenders.map((t, idx) => {
                const revPct = totalRevenue > 0 ? (t.revenue / totalRevenue) * 100 : 0;
                const billPct = totalBills > 0 ? (t.bills / totalBills) * 100 : 0;
                const avgBill = t.bills > 0 ? t.revenue / t.bills : 0;
                return (
                  <tr
                    key={t.tenderGroup}
                    className="transition-colors hover:!bg-[var(--bg-row-hover)]"
                    style={{ borderBottom: "1px solid var(--border-light)", background: idx % 2 === 1 ? "var(--bg-row-stripe)" : undefined }}
                  >
                    <td className="px-4 py-2" style={{ color: "var(--text-muted)" }}>{idx + 1}</td>
                    <td className="px-4 py-2 font-medium" style={{ color: "var(--text-primary)" }}>
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: getTenderColor(t.tenderGroup, idx) }} />
                        {t.tenderGroup}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right font-semibold" style={{ color: "var(--text-heading)" }}>{formatBaht(t.revenue)}</td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center gap-1.5 justify-end">
                        <div className="w-12 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-badge)" }}>
                          <div className="h-full rounded-full" style={{ width: `${revPct}%`, background: "var(--nav-active-text)" }} />
                        </div>
                        <span className="text-[10px] font-medium w-10 text-right" style={{ color: "var(--text-muted)" }}>{revPct.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right" style={{ color: "var(--text-secondary)" }}>{t.bills.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right" style={{ color: "var(--text-muted)" }}>{billPct.toFixed(1)}%</td>
                    <td className="px-4 py-2 text-right" style={{ color: "var(--text-secondary)" }}>{formatBaht(avgBill)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--border-main)", background: "var(--bg-card-alt)" }}>
                <td className="px-4 py-2 font-bold" style={{ color: "var(--text-heading)" }} colSpan={2}>Total</td>
                <td className="px-4 py-2 text-right font-bold" style={{ color: "var(--text-heading)" }}>{formatBaht(totalRevenue)}</td>
                <td className="px-4 py-2 text-right font-bold" style={{ color: "var(--text-muted)" }}>100%</td>
                <td className="px-4 py-2 text-right font-bold" style={{ color: "var(--text-heading)" }}>{totalBills.toLocaleString()}</td>
                <td className="px-4 py-2 text-right font-bold" style={{ color: "var(--text-muted)" }}>100%</td>
                <td className="px-4 py-2 text-right font-bold" style={{ color: "var(--text-heading)" }}>{totalBills > 0 ? formatBaht(totalRevenue / totalBills) : "0"}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
