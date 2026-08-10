"use client";
import React, { useMemo } from "react";
import { ReportLoading } from "./ReportLoading";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";
import { format, parseISO } from "date-fns";
import type { DailySalesData } from "@/features/intelligence/types";
import { KpiCard } from "./KpiCard";
import { pctChange } from "@/features/intelligence/constants";
import type { DailySalesKpiInsights, InsightCard } from "@/features/intelligence/codex-insight";
import { TrendingUp as TrendIcon, Lightbulb, AlertTriangle, Zap } from "lucide-react";

/* ── Helpers ── */

function formatBaht(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}


function formatDateTick(dateStr: string): string {
  try {
    return format(parseISO(dateStr), "dd MMM");
  } catch {
    return dateStr;
  }
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

const CHANNEL_COLOR_MAP: Record<string, string> = {
  "Storefront": "#991b1b",
  "Delivery": "#16a34a",
};
const FALLBACK_COLORS = ["#f59e0b", "#dc2626", "#8b5cf6", "#ec4899", "#06b6d4"];

function getChannelColor(channel: string, index: number): string {
  return CHANNEL_COLOR_MAP[channel] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

/* ── Component ── */

interface Holiday {
  date: string;
  name: string;
}

interface Props {
  data: DailySalesData | null;
  isLoading: boolean;
  holidays?: Holiday[];
  vsData?: DailySalesData | null;
  codexInsights?: DailySalesKpiInsights | null;
}

const INSIGHT_CONFIG: Record<string, { icon: React.ReactNode; bg: string; border: string; accent: string }> = {
  trend: { icon: <TrendIcon size={15} />, bg: "rgba(37,99,235,0.07)", border: "rgba(37,99,235,0.15)", accent: "#2563eb" },
  opportunity: { icon: <Lightbulb size={15} />, bg: "rgba(245,158,11,0.07)", border: "rgba(245,158,11,0.15)", accent: "#f59e0b" },
  warning: { icon: <AlertTriangle size={15} />, bg: "rgba(220,38,38,0.07)", border: "rgba(220,38,38,0.15)", accent: "#dc2626" },
  action: { icon: <Zap size={15} />, bg: "rgba(22,163,74,0.07)", border: "rgba(22,163,74,0.15)", accent: "#16a34a" },
};

export function DailySalesDashboard({ data, isLoading, holidays = [], vsData, codexInsights }: Props) {
  // Build holiday + weekend markers for dates in chart range
  const chartMarkers = useMemo(() => {
    if (!data) return [];
    const holidayMap = new Map<string, string>();
    for (const h of holidays) holidayMap.set(h.date, h.name);

    const markers: Array<{ date: string; label: string; type: "holiday" | "weekend" }> = [];
    for (const row of data.daily) {
      const d = new Date(row.date + "T00:00:00");
      const day = d.getDay(); // 0=Sun, 6=Sat
      const hName = holidayMap.get(row.date);
      if (hName) {
        markers.push({ date: row.date, label: hName, type: "holiday" });
      } else if (day === 0 || day === 6) {
        markers.push({ date: row.date, label: day === 0 ? "Sun" : "Sat", type: "weekend" });
      }
    }
    return markers;
  }, [data, holidays]);

  if (isLoading || !data) return <ReportLoading />;

  return (
    <div className="flex flex-col gap-5">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard label="Total Revenue" value={formatBaht(data.kpi.totalRevenue)} trend={pctChange(data.kpi.totalRevenue, vsData?.kpi?.totalRevenue)} subtitle={codexInsights?.revenue?.text} />
        <KpiCard label="Bills" value={data.kpi.totalBills.toLocaleString()} trend={pctChange(data.kpi.totalBills, vsData?.kpi?.totalBills)} subtitle={codexInsights?.bills?.text} />
        <KpiCard label="Avg Ticket Size" value={formatBaht(data.kpi.avgTicket)} trend={pctChange(data.kpi.avgTicket, vsData?.kpi?.avgTicket)} subtitle={codexInsights?.avgTicket?.text} />
        <KpiCard label="Avg Daily Revenue" value={formatBaht(data.kpi.avgDailyRevenue)} trend={pctChange(data.kpi.avgDailyRevenue, vsData?.kpi?.avgDailyRevenue)} subtitle={codexInsights?.avgDaily?.text} />
        <KpiCard label="Days" value={String(data.kpi.daysCount)} />
      </div>

      {/* Codex Insights — general */}
      {codexInsights?.general && codexInsights.general.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "thin" }}>
          {codexInsights.general.map((item, i) => {
            const c = INSIGHT_CONFIG[item.type] ?? INSIGHT_CONFIG.trend;
            return (
              <div
                key={i}
                className="flex items-start gap-2 rounded-lg px-3 py-2 shrink-0"
                style={{ background: c.bg, border: `1px solid ${c.border}`, maxWidth: 300 }}
              >
                <div className="shrink-0 mt-0.5" style={{ color: c.accent }}>{c.icon}</div>
                <div className="min-w-0">
                  <span className="text-[11px] font-bold" style={{ color: "var(--text-heading)" }}>{item.title}</span>
                  <p className="text-[11px] leading-relaxed mt-0.5" style={{ color: "var(--text-muted)" }}>{item.body}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Revenue Area Chart — stacked by channel */}
      <div
        className="rounded-xl p-4"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-card)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <h3 className="text-[13px] font-bold mb-3" style={{ color: "var(--text-heading)" }}>
          Revenue Over Time
        </h3>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={data.daily}>
            <defs>
              {(data.channelNames ?? []).map((ch, i) => (
                <linearGradient key={ch} id={`revGrad_${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={getChannelColor(ch, i)} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={getChannelColor(ch, i)} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={formatDateTick} tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v: number) => formatBaht(v)} tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={60} />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) return null;
                return (
                  <div style={tooltipStyle}>
                    <p style={tooltipLabelStyle}>{formatDateTick(String(label))}</p>
                    {payload.map((p) => (
                      <p key={String(p.name)} style={{ color: String(p.color), margin: 0, fontSize: 11 }}>
                        {String(p.name).replace("revenue_", "")}: {formatBaht(Number(p.value))}
                      </p>
                    ))}
                  </div>
                );
              }}
            />
            <Legend formatter={(value) => value === "Total" ? "Total" : String(value).replace("revenue_", "")} wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="revenue" name="Total" stroke="var(--text-heading)" strokeWidth={2} fill="none" />
            {(data.channelNames ?? []).map((ch, i) => (
              <Area key={ch} type="monotone" dataKey={`revenue_${ch}`} stroke={getChannelColor(ch, i)} strokeWidth={2} fill={`url(#revGrad_${i})`} />
            ))}
            {chartMarkers.map((m) => (
              <ReferenceLine
                key={m.date}
                x={m.date}
                stroke={m.type === "holiday" ? "#f59e0b" : "#9ca3af"}
                strokeDasharray={m.type === "holiday" ? "4 3" : "2 2"}
                strokeWidth={m.type === "holiday" ? 1.5 : 1}
                label={m.type === "holiday" ? { value: m.label, position: "top", fontSize: 8, fill: "#f59e0b", fontWeight: 600 } : undefined}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Bill Count Bar Chart — stacked by channel */}
      <div
        className="rounded-xl p-4"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-card)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <h3 className="text-[13px] font-bold mb-3" style={{ color: "var(--text-heading)" }}>
          Bill Count Over Time
        </h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data.daily} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={formatDateTick} tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={40} />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) return null;
                const total = payload.reduce((s, p) => s + (Number(p.value) || 0), 0);
                return (
                  <div style={tooltipStyle}>
                    <p style={tooltipLabelStyle}>{formatDateTick(String(label))}</p>
                    {payload.map((p) => (
                      <p key={String(p.name)} style={{ color: String(p.color), margin: 0, fontSize: 11 }}>
                        {String(p.name).replace("bills_", "")}: {Number(p.value).toLocaleString()}
                      </p>
                    ))}
                    <p style={{ fontWeight: 700, margin: "4px 0 0", borderTop: "1px solid var(--border-light)", paddingTop: 4, fontSize: 11, color: "var(--text-heading)" }}>
                      Total: {total.toLocaleString()}
                    </p>
                  </div>
                );
              }}
            />
            <Legend formatter={(value) => String(value).replace("bills_", "")} wrapperStyle={{ fontSize: 11 }} />
            {(data.channelNames ?? []).map((ch, i) => (
              <Bar key={ch} dataKey={`bills_${ch}`} stackId="bills" fill={getChannelColor(ch, i)} opacity={0.85} maxBarSize={80} radius={i === (data.channelNames?.length ?? 1) - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} />
            ))}
            {chartMarkers.map((m) => (
              <ReferenceLine
                key={m.date}
                x={m.date}
                stroke={m.type === "holiday" ? "#f59e0b" : "#9ca3af"}
                strokeDasharray={m.type === "holiday" ? "4 3" : "2 2"}
                strokeWidth={m.type === "holiday" ? 1.5 : 1}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {/* Revenue by Channel */}
      {data.channels && data.channels.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Pie Chart */}
          <div
            className="rounded-xl p-4"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-card)",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <h3 className="text-[13px] font-bold mb-3" style={{ color: "var(--text-heading)" }}>
              Revenue by Channel
            </h3>
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={data.channels}
                  dataKey="revenue"
                  nameKey="channel"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  innerRadius={50}
                  paddingAngle={3}
                  label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
                  style={{ fontSize: 11 }}
                >
                  {data.channels.map((entry, i) => (
                    <Cell key={entry.channel} fill={getChannelColor(entry.channel, i)} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value) => [formatBaht(Number(value)), "Revenue"]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Channel Stats Table */}
          <div
            className="rounded-xl p-4"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-card)",
              boxShadow: "var(--shadow-sm)",
            }}
          >
            <h3 className="text-[13px] font-bold mb-3" style={{ color: "var(--text-heading)" }}>
              Channel Breakdown
            </h3>
            <div className="flex flex-col gap-3">
              {data.channels.map((ch, i) => {
                const totalBills = data.channels.reduce((s, c) => s + c.bills, 0);
                const pct = totalBills > 0 ? (ch.bills / totalBills) * 100 : 0;
                return (
                  <div key={ch.channel}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ background: getChannelColor(ch.channel, i) }} />
                        <span className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>{ch.channel}</span>
                      </div>
                      <span className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>{formatBaht(ch.revenue)}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "var(--bg-badge)" }}>
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: getChannelColor(ch.channel, i) }} />
                      </div>
                      <span className="text-[11px] font-medium shrink-0" style={{ color: "var(--text-muted)" }}>{pct.toFixed(1)}%</span>
                      <span className="text-[11px] shrink-0" style={{ color: "var(--text-faint)" }}>{ch.bills.toLocaleString()} bills</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
