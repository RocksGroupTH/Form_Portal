"use client";
import React, { useState } from "react";
import { ReportLoading } from "./ReportLoading";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { CHART_COLORS, pctChange } from "@/features/intelligence/constants";
import { KpiCard } from "./KpiCard";

/* ── Helpers ── */

function formatBaht(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

const tooltipStyle: React.CSSProperties = {
  background: "var(--bg-card)", border: "1px solid var(--border-card)", borderRadius: 12,
  padding: "8px 12px", boxShadow: "var(--shadow-md)", fontSize: 11, color: "var(--text-primary)",
};

/* ── Types ── */

interface OptionGroup {
  groupName: string;
  totalQty: number;
  options: Array<{ name: string; qty: number }>;
}

interface TopCombo {
  menuName: string;
  optionGroup: string;
  optionValue: string;
  qty: number;
  revenue: number;
}

interface ProductOptionData {
  optionGroups: OptionGroup[];
  topCombos: TopCombo[];
  kpi: {
    totalItems: number;
    totalRevenue: number;
    itemsWithOption: number;
    optionRate: number;
    uniqueGroups: number;
    uniqueProducts: number;
  };
}

interface Props {
  data: ProductOptionData | null;
  isLoading: boolean;
  vsData?: ProductOptionData | null;
}

export function ProductOptionAnalysis({ data, isLoading, vsData }: Props) {
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  if (isLoading || !data) return <ReportLoading />;

  const activeGroup = selectedGroup
    ? data.optionGroups.find((g) => g.groupName === selectedGroup)
    : data.optionGroups[0] ?? null;

  return (
    <div className="flex flex-col gap-5">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <KpiCard label="Total Items" value={data.kpi.totalItems.toLocaleString()} trend={pctChange(data.kpi.totalItems, vsData?.kpi?.totalItems)} />
        <KpiCard label="Total Revenue" value={formatBaht(data.kpi.totalRevenue)} trend={pctChange(data.kpi.totalRevenue, vsData?.kpi?.totalRevenue)} />
        <KpiCard label="With Options" value={`${data.kpi.optionRate}%`} trend={pctChange(data.kpi.optionRate, vsData?.kpi?.optionRate)} />
        <KpiCard label="Option Groups" value={String(data.kpi.uniqueGroups)} />
        <KpiCard label="Products" value={String(data.kpi.uniqueProducts)} />
        <KpiCard label="Items w/ Option" value={data.kpi.itemsWithOption.toLocaleString()} trend={pctChange(data.kpi.itemsWithOption, vsData?.kpi?.itemsWithOption)} />
      </div>

      {/* Option Group tabs + detail */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Group selector */}
        <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-sm)" }}>
          <h3 className="text-[13px] font-bold mb-3" style={{ color: "var(--text-heading)" }}>Option Groups</h3>
          <div className="flex flex-col gap-1.5">
            {data.optionGroups.map((g, i) => {
              const isActive = (selectedGroup ?? data.optionGroups[0]?.groupName) === g.groupName;
              return (
                <button
                  key={g.groupName}
                  onClick={() => setSelectedGroup(g.groupName)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer border-none text-left transition-colors"
                  style={{
                    background: isActive ? "var(--nav-active-bg)" : "transparent",
                    color: isActive ? "var(--nav-active-text)" : "var(--text-primary)",
                  }}
                >
                  <div className="w-3 h-3 rounded-full shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                  <span className="text-[12px] font-medium flex-1">{g.groupName}</span>
                  <span className="text-[11px] font-bold">{g.totalQty.toLocaleString()}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Pie chart for selected group */}
        <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-sm)" }}>
          <h3 className="text-[13px] font-bold mb-3" style={{ color: "var(--text-heading)" }}>
            {activeGroup?.groupName ?? "Select a group"}
          </h3>
          {activeGroup && (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={activeGroup.options.slice(0, 8)}
                  dataKey="qty"
                  nameKey="name"
                  cx="50%" cy="50%"
                  outerRadius={100} innerRadius={45}
                  paddingAngle={2}
                  label={({ name, percent }: any) => percent > 0.04 ? `${(percent * 100).toFixed(0)}%` : ""}
                  style={{ fontSize: 10 }}
                >
                  {activeGroup.options.slice(0, 8).map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} formatter={(value) => [Number(value).toLocaleString(), "Qty"]} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Option values breakdown */}
        <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-sm)" }}>
          <h3 className="text-[13px] font-bold mb-3" style={{ color: "var(--text-heading)" }}>
            {activeGroup?.groupName ?? ""} Breakdown
          </h3>
          {activeGroup && (
            <div className="flex flex-col gap-2">
              {activeGroup.options.map((opt, i) => {
                const pct = activeGroup.totalQty > 0 ? (opt.qty / activeGroup.totalQty) * 100 : 0;
                return (
                  <div key={opt.name}>
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                        <span className="text-[11px] font-medium" style={{ color: "var(--text-primary)" }}>{opt.name}</span>
                      </div>
                      <span className="text-[11px] font-bold" style={{ color: "var(--text-heading)" }}>{opt.qty.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--bg-badge)" }}>
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
                      </div>
                      <span className="text-[9px] w-8 text-right" style={{ color: "var(--text-faint)" }}>{pct.toFixed(1)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Top Product + Option Combos Table */}
      <div className="rounded-xl overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-sm)" }}>
        <div className="px-4 pt-4 pb-2">
          <h3 className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>Top Product + Option Combos</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-light)", background: "var(--bg-card-alt)" }}>
                <th className="text-left px-4 py-2 font-semibold" style={{ color: "var(--text-muted)" }}>#</th>
                <th className="text-left px-4 py-2 font-semibold" style={{ color: "var(--text-muted)" }}>Product</th>
                <th className="text-left px-4 py-2 font-semibold" style={{ color: "var(--text-muted)" }}>Option Group</th>
                <th className="text-left px-4 py-2 font-semibold" style={{ color: "var(--text-muted)" }}>Option Value</th>
                <th className="text-right px-4 py-2 font-semibold" style={{ color: "var(--text-muted)" }}>Qty</th>
                <th className="text-right px-4 py-2 font-semibold" style={{ color: "var(--text-muted)" }}>Revenue</th>
              </tr>
            </thead>
            <tbody>
              {data.topCombos.map((combo, idx) => (
                <tr
                  key={`${combo.menuName}-${combo.optionGroup}-${combo.optionValue}`}
                  className="transition-colors hover:!bg-[var(--bg-row-hover)]"
                  style={{ borderBottom: "1px solid var(--border-light)", background: idx % 2 === 1 ? "var(--bg-row-stripe)" : undefined }}
                >
                  <td className="px-4 py-2" style={{ color: "var(--text-muted)" }}>{idx + 1}</td>
                  <td className="px-4 py-2 font-medium" style={{ color: "var(--text-primary)" }}>{combo.menuName}</td>
                  <td className="px-4 py-2">
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}>{combo.optionGroup}</span>
                  </td>
                  <td className="px-4 py-2" style={{ color: "var(--text-secondary)" }}>{combo.optionValue}</td>
                  <td className="px-4 py-2 text-right font-bold" style={{ color: "var(--text-heading)" }}>{combo.qty.toLocaleString()}</td>
                  <td className="px-4 py-2 text-right" style={{ color: "#2563eb" }}>{formatBaht(combo.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
