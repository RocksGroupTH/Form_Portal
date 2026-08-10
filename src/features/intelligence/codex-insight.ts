/**
 * Codex Insight — Offline rule-based business insights
 * No API call needed. Runs instantly on dashboard data.
 */

import type { DailySalesData } from "./types";
import { pctChange } from "./constants";

export type InsightType = "trend" | "opportunity" | "warning" | "action";

export interface InsightCard {
  type: InsightType;
  title: string;
  body: string;
}

/** Short insight text mapped to a KPI card */
export interface KpiInsight {
  text: string;
  type: InsightType;
}

function fmtBaht(n: number): string {
  if (n >= 1_000_000) return `฿${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `฿${(n / 1_000).toFixed(1)}K`;
  return `฿${n.toLocaleString()}`;
}

/** Wrapper that returns 0 instead of undefined for internal use */
function pct(current: number, previous: number): number {
  return pctChange(current, previous) ?? 0;
}

/* ── Daily Sales Pulse ── */

export interface DailySalesKpiInsights {
  revenue?: KpiInsight;
  bills?: KpiInsight;
  avgTicket?: KpiInsight;
  avgDaily?: KpiInsight;
  general: InsightCard[];
}

export function dailySalesInsights(
  data: DailySalesData,
  vsData?: DailySalesData | null,
  holidays?: { date: string; name: string }[],
): DailySalesKpiInsights {
  const kpi = data.kpi;
  const vsKpi = vsData?.kpi;
  const holidaySet = new Set((holidays ?? []).map((h) => h.date));
  const result: DailySalesKpiInsights = { general: [] };

  // Revenue insight
  if (vsKpi) {
    const p = pct(kpi.totalRevenue, vsKpi.totalRevenue);
    if (Math.abs(p) >= 0.5) {
      result.revenue = {
        text: `from ${fmtBaht(vsKpi.totalRevenue)}`,
        type: p > 0 ? "trend" : "warning",
      };
    }
  }

  // Bills insight
  if (vsKpi) {
    const p = pct(kpi.totalBills, vsKpi.totalBills);
    if (Math.abs(p) >= 0.5) {
      result.bills = {
        text: `from ${vsKpi.totalBills.toLocaleString()}`,
        type: p > 0 ? "trend" : "warning",
      };
    }
  }

  // Avg ticket insight
  if (vsKpi) {
    const p = pct(kpi.avgTicket, vsKpi.avgTicket);
    if (Math.abs(p) >= 0.5) {
      result.avgTicket = {
        text: p > 0 ? "upselling working" : "consider bundles",
        type: p > 0 ? "opportunity" : "warning",
      };
    }
  }

  // Avg daily revenue insight
  if (vsKpi) {
    const p = pct(kpi.avgDailyRevenue, vsKpi.avgDailyRevenue);
    if (Math.abs(p) >= 0.5) {
      result.avgDaily = {
        text: `from ${fmtBaht(vsKpi.avgDailyRevenue)}`,
        type: p > 0 ? "trend" : "warning",
      };
    }
  }

  // General insights (channel, peaks, etc.)

  // Channel dominance
  if (data.channels?.length > 1) {
    const sorted = Array.from(data.channels).sort((a, b) => b.revenue - a.revenue);
    const top = sorted[0];
    const share = ((top.revenue / kpi.totalRevenue) * 100).toFixed(1);
    result.general.push({
      type: "trend",
      title: `${top.channel} Leads at ${share}%`,
      body: `${top.channel} generates ${fmtBaht(top.revenue)} (${share}%), followed by ${sorted.slice(1).map((c) => `${c.channel} at ${fmtBaht(c.revenue)}`).join(", ")}.`,
    });
  }

  // Channel share shift
  if (vsData?.channels && data.channels && vsKpi) {
    for (const ch of data.channels) {
      const vsCh = vsData.channels.find((c) => c.channel === ch.channel);
      if (vsCh) {
        const curShare = (ch.revenue / kpi.totalRevenue) * 100;
        const vsShare = (vsCh.revenue / vsKpi.totalRevenue) * 100;
        const diff = curShare - vsShare;
        if (Math.abs(diff) >= 2) {
          result.general.push({
            type: diff > 0 ? "opportunity" : "warning",
            title: `${ch.channel} Share ${diff > 0 ? "+" : ""}${diff.toFixed(1)}pp`,
            body: `${ch.channel} moved from ${vsShare.toFixed(1)}% to ${curShare.toFixed(1)}% of revenue.`,
          });
        }
      }
    }
  }

  // Peak day
  if (data.daily.length > 3) {
    const avg = kpi.avgDailyRevenue;
    const peak = data.daily.reduce((best, d) => d.revenue > best.revenue ? d : best, data.daily[0]);
    const peakPct = ((peak.revenue - avg) / avg) * 100;
    if (peakPct >= 30) {
      const d = new Date(peak.date + "T00:00:00");
      const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
      result.general.push({
        type: "trend",
        title: `Peak: ${day} ${d.getDate()}/${d.getMonth() + 1}`,
        body: `${fmtBaht(peak.revenue)} — ${peakPct.toFixed(0)}% above avg ${fmtBaht(avg)}.`,
      });
    }
  }

  // Weakest day
  if (data.daily.length > 3) {
    const avg = kpi.avgDailyRevenue;
    const low = data.daily.reduce((worst, d) => d.revenue < worst.revenue ? d : worst, data.daily[0]);
    const lowPct = ((avg - low.revenue) / avg) * 100;
    if (lowPct >= 30) {
      const d = new Date(low.date + "T00:00:00");
      const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()];
      result.general.push({
        type: "warning",
        title: `Low: ${day} ${d.getDate()}/${d.getMonth() + 1}`,
        body: `${fmtBaht(low.revenue)} — ${lowPct.toFixed(0)}% below avg ${fmtBaht(avg)}.`,
      });
    }
  }

  // Items per bill
  if (vsKpi && kpi.totalItems && vsKpi.totalItems) {
    const curIPB = kpi.totalItems / kpi.totalBills;
    const vsIPB = vsKpi.totalItems / vsKpi.totalBills;
    const p = pct(curIPB, vsIPB);
    if (Math.abs(p) >= 3) {
      result.general.push({
        type: p > 0 ? "opportunity" : "action",
        title: `Items/Bill ${p > 0 ? "Up" : "Down"} ${Math.abs(p).toFixed(1)}%`,
        body: `${curIPB.toFixed(1)} items/bill vs ${vsIPB.toFixed(1)} — ${p < 0 ? "cross-sell more add-ons" : "cross-selling working"}.`,
      });
    }
  }

  // Weekday vs Weekend performance
  if (data.daily.length > 3) {
    let wdRev = 0, wdDays = 0, weRev = 0, weDays = 0;
    for (const row of data.daily) {
      const d = new Date(row.date + "T00:00:00").getDay();
      if (holidaySet.has(row.date)) continue;
      if (d === 0 || d === 6) { weRev += row.revenue; weDays++; }
      else { wdRev += row.revenue; wdDays++; }
    }
    if (wdDays && weDays) {
      const wdAvg = wdRev / wdDays;
      const weAvg = weRev / weDays;
      const diff = ((weAvg - wdAvg) / wdAvg) * 100;
      if (Math.abs(diff) >= 5) {
        result.general.push({
          type: diff > 0 ? "trend" : "warning",
          title: `Weekend ${diff > 0 ? "Outperforms" : "Underperforms"}`,
          body: `Weekend avg ${fmtBaht(weAvg)}/day vs weekday ${fmtBaht(wdAvg)}/day (${diff > 0 ? "+" : ""}${diff.toFixed(0)}%).`,
        });
      }
    }
  }

  // Holiday impact
  if (data.daily.length > 3 && holidaySet.size > 0) {
    let holRev = 0, holDays = 0, nonRev = 0, nonDays = 0;
    for (const row of data.daily) {
      if (holidaySet.has(row.date)) { holRev += row.revenue; holDays++; }
      else { nonRev += row.revenue; nonDays++; }
    }
    if (holDays && nonDays) {
      const holAvg = holRev / holDays;
      const nonAvg = nonRev / nonDays;
      const diff = ((holAvg - nonAvg) / nonAvg) * 100;
      const holNames = (holidays ?? []).filter((h) => data.daily.some((r) => r.date === h.date)).map((h) => h.name);
      result.general.push({
        type: diff > 0 ? "trend" : "warning",
        title: `Holiday ${diff > 0 ? "Boost" : "Dip"} ${Math.abs(diff).toFixed(0)}%`,
        body: `${holNames.join(", ")}: avg ${fmtBaht(holAvg)}/day vs normal ${fmtBaht(nonAvg)}/day.`,
      });
    }
  }

  result.general = result.general.slice(0, 5);
  return result;
}
