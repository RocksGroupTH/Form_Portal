import type { DailySalesData } from "./types";
import type { InsightPayload } from "./components/DashboardLayout";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function buildDailySalesInsightPayload(
  data: DailySalesData,
  vsData: DailySalesData | null,
  holidays: { date: string; name: string }[],
  from: string,
  to: string,
): InsightPayload {
  const holidaySet = new Set(holidays.map((h) => h.date));
  let wdRev = 0, wdDays = 0, weRev = 0, weDays = 0, holRev = 0, holDays = 0;
  const byDow: Record<string, { rev: number; count: number }> = {};

  for (const row of data.daily) {
    const d = new Date(row.date + "T00:00:00");
    const dayIdx = d.getDay();
    const dow = DAY_NAMES[dayIdx];

    // Weekday / weekend / holiday classification
    if (holidaySet.has(row.date)) { holRev += row.revenue; holDays++; }
    else if (dayIdx === 0 || dayIdx === 6) { weRev += row.revenue; weDays++; }
    else { wdRev += row.revenue; wdDays++; }

    // Day-of-week aggregation
    if (!byDow[dow]) byDow[dow] = { rev: 0, count: 0 };
    byDow[dow].rev += row.revenue;
    byDow[dow].count++;
  }

  // Summary
  const parts: string[] = [];
  if (data.channels) parts.push(`Channels: ${data.channels.map((c) => `${c.channel}: ${c.revenue}`).join(", ")}`);
  if (wdDays) parts.push(`Weekday: ${wdDays} days, avg ฿${Math.round(wdRev / wdDays).toLocaleString()}/day`);
  if (weDays) parts.push(`Weekend: ${weDays} days, avg ฿${Math.round(weRev / weDays).toLocaleString()}/day`);
  if (holDays) {
    const holNames = holidays.filter((h) => data.daily.some((r) => r.date === h.date)).map((h) => h.name);
    parts.push(`Holidays: ${holDays} days (${holNames.join(", ")}), avg ฿${Math.round(holRev / holDays).toLocaleString()}/day`);
  }

  // Daily trend
  const trendParts: string[] = [];
  const dowSummary = Object.entries(byDow).map(([d, v]) => `${d}: avg ฿${Math.round(v.rev / v.count).toLocaleString()}`).join(", ");
  trendParts.push(`Day-of-week avg revenue: ${dowSummary}`);

  const sorted = Array.from(data.daily).sort((a, b) => b.revenue - a.revenue);
  trendParts.push(`Top 3 days: ${sorted.slice(0, 3).map((r) => `${r.date}: ฿${Math.round(r.revenue).toLocaleString()}`).join(", ")}`);
  trendParts.push(`Bottom 3 days: ${sorted.slice(-3).reverse().map((r) => `${r.date}: ฿${Math.round(r.revenue).toLocaleString()}`).join(", ")}`);

  const half = Math.floor(data.daily.length / 2);
  if (half > 0) {
    let firstHalf = 0, secondHalf = 0;
    data.daily.forEach((r, i) => { if (i < half) firstHalf += r.revenue; else secondHalf += r.revenue; });
    trendParts.push(`Momentum: First half avg ฿${Math.round(firstHalf / half).toLocaleString()}/day, second half avg ฿${Math.round(secondHalf / (data.daily.length - half)).toLocaleString()}/day`);
  }

  return {
    kpis: { "Total Revenue": data.kpi.totalRevenue, "Total Bills": data.kpi.totalBills, "Avg Ticket": data.kpi.avgTicket, "Avg Daily Revenue": data.kpi.avgDailyRevenue, "Days": data.kpi.daysCount },
    vsKpis: vsData ? { "Total Revenue": vsData.kpi.totalRevenue, "Total Bills": vsData.kpi.totalBills, "Avg Ticket": vsData.kpi.avgTicket, "Avg Daily Revenue": vsData.kpi.avgDailyRevenue, "Days": vsData.kpi.daysCount } : null,
    summary: parts.join(". "),
    dailyTrend: trendParts.join("\n"),
    dateRange: `${from} to ${to}`,
  };
}
