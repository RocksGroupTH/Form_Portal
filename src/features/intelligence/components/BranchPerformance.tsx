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
} from "recharts";
import type { BranchData } from "@/features/intelligence/types";
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

/* ── Component ── */

interface Props {
  data: BranchData | null;
  isLoading: boolean;
  vsData?: BranchData | null;
}

export function BranchPerformance({ data, isLoading, vsData }: Props) {
  const branches = data?.branches ?? [];
  const sorted = useMemo(
    () => Array.from(branches).sort((a, b) => b.revenue - a.revenue),
    [branches],
  );
  const totalRevenue = useMemo(() => branches.reduce((sum, b) => sum + b.revenue, 0), [branches]);
  const totalBills = useMemo(() => branches.reduce((sum, b) => sum + b.billCount, 0), [branches]);

  if (isLoading || !data) return <ReportLoading />;

  const topBranch = sorted[0]?.branchName ?? "N/A";
  const avgPerBranch = branches.length > 0 ? totalRevenue / branches.length : 0;
  const avgTicket = totalBills > 0 ? totalRevenue / totalBills : 0;

  return (
    <div className="flex flex-col gap-5">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiCard label="Total Revenue" value={formatBaht(totalRevenue)} trend={pctChange(totalRevenue, vsData?.branches?.reduce((s, b) => s + b.revenue, 0))} />
        <KpiCard label="Total Bills" value={totalBills.toLocaleString()} trend={pctChange(totalBills, vsData?.branches?.reduce((s, b) => s + b.billCount, 0))} />
        <KpiCard label="Avg Ticket Size" value={formatBaht(avgTicket)} trend={(() => { const vr = vsData?.branches?.reduce((s, b) => s + b.revenue, 0) ?? 0; const vb = vsData?.branches?.reduce((s, b) => s + b.billCount, 0) ?? 0; return pctChange(avgTicket, vb > 0 ? vr / vb : undefined); })()} />
        <KpiCard label="Avg per Branch" value={formatBaht(avgPerBranch)} trend={pctChange(avgPerBranch, vsData?.branches?.length ? vsData.branches.reduce((s, b) => s + b.revenue, 0) / vsData.branches.length : undefined)} />
        <KpiCard label="Top Branch" value={topBranch} />
      </div>

      {/* Horizontal Bar Chart: branch ranking */}
      <div
        className="rounded-xl p-4"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-card)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <h3 className="text-[13px] font-bold mb-3" style={{ color: "var(--text-heading)" }}>
          Branch Revenue Ranking
        </h3>
        <ResponsiveContainer width="100%" height={Math.max(300, sorted.length * 36)}>
          <BarChart data={sorted} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" horizontal={false} />
            <XAxis
              type="number"
              tickFormatter={(v: number) => formatBaht(v)}
              tick={{ fontSize: 10, fill: "var(--text-muted)" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="branchName"
              width={140}
              tick={{ fontSize: 10, fill: "var(--text-primary)" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const d = payload[0].payload;
                const pct = totalRevenue > 0 ? ((d.revenue / totalRevenue) * 100).toFixed(1) : "0";
                return (
                  <div style={tooltipStyle}>
                    <p style={tooltipLabelStyle}>{d.branchName}</p>
                    <p style={{ margin: 0, fontSize: 11 }}>Revenue: <strong>{formatBaht(d.revenue)}</strong> ({pct}%)</p>
                    <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted)" }}>Bills: {d.billCount?.toLocaleString()} · Avg Ticket Size: {formatBaht(d.avgTicket)}</p>
                  </div>
                );
              }}
            />
            <Bar dataKey="revenue" radius={[0, 4, 4, 0]}>
              {sorted.map((_, idx) => (
                <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Branch Table */}
      <div
        className="rounded-xl overflow-hidden"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-card)",
          boxShadow: "var(--shadow-sm)",
        }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-light)", background: "var(--bg-card-alt)" }}>
                <th className="text-left px-4 py-2.5 font-semibold" style={{ color: "var(--text-muted)" }}>#</th>
                <th className="text-left px-4 py-2.5 font-semibold" style={{ color: "var(--text-muted)" }}>Branch</th>
                <th className="text-right px-4 py-2.5 font-semibold" style={{ color: "var(--text-muted)" }}>Revenue</th>
                <th className="text-right px-4 py-2.5 font-semibold" style={{ color: "var(--text-muted)" }}>% Total</th>
                <th className="text-right px-4 py-2.5 font-semibold" style={{ color: "var(--text-muted)" }}>Bills</th>
                <th className="text-right px-4 py-2.5 font-semibold" style={{ color: "var(--text-muted)" }}>Items</th>
                <th className="text-right px-4 py-2.5 font-semibold" style={{ color: "var(--text-muted)" }}>Avg Ticket Size</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((branch, idx) => {
                const pct = totalRevenue > 0 ? (branch.revenue / totalRevenue) * 100 : 0;
                return (
                  <tr
                    key={branch.branchId}
                    className="transition-colors hover:!bg-[var(--bg-row-hover)]"
                    style={{
                      borderBottom: "1px solid var(--border-light)",
                      background: idx % 2 === 1 ? "var(--bg-row-stripe)" : undefined,
                    }}
                  >
                    <td className="px-4 py-2" style={{ color: "var(--text-muted)" }}>{idx + 1}</td>
                    <td className="px-4 py-2 font-medium" style={{ color: "var(--text-primary)" }}>
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CHART_COLORS[idx % CHART_COLORS.length] }} />
                        {branch.branchName}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right font-semibold" style={{ color: "var(--text-heading)" }}>
                      {formatBaht(branch.revenue)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center gap-1.5 justify-end">
                        <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-badge)" }}>
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: CHART_COLORS[idx % CHART_COLORS.length] }} />
                        </div>
                        <span className="text-[10px] font-medium w-10 text-right" style={{ color: "var(--text-muted)" }}>{pct.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right" style={{ color: "var(--text-secondary)" }}>
                      {branch.billCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right" style={{ color: "var(--text-secondary)" }}>
                      {branch.itemCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right" style={{ color: "var(--text-secondary)" }}>
                      {formatBaht(branch.avgTicket)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {/* Total row */}
            <tfoot>
              <tr style={{ borderTop: "2px solid var(--border-main)", background: "var(--bg-card-alt)" }}>
                <td className="px-4 py-2 font-bold" style={{ color: "var(--text-heading)" }} colSpan={2}>Total</td>
                <td className="px-4 py-2 text-right font-bold" style={{ color: "var(--text-heading)" }}>{formatBaht(totalRevenue)}</td>
                <td className="px-4 py-2 text-right font-bold" style={{ color: "var(--text-muted)" }}>100%</td>
                <td className="px-4 py-2 text-right font-bold" style={{ color: "var(--text-heading)" }}>{totalBills.toLocaleString()}</td>
                <td className="px-4 py-2 text-right font-bold" style={{ color: "var(--text-heading)" }}>{branches.reduce((s, b) => s + b.itemCount, 0).toLocaleString()}</td>
                <td className="px-4 py-2 text-right font-bold" style={{ color: "var(--text-heading)" }}>{formatBaht(avgTicket)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
