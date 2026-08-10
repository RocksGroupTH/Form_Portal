"use client";
import { useMasterTheme } from "@/features/intelligence/master/hooks/useMasterTheme";

/**
 * Returns concrete hex values for Recharts props based on the current
 * Master Dashboard light/dark mode. Recharts can't read CSS variables
 * for SVG attributes, so we derive hex colours from the context instead.
 */
export function useChartTheme() {
  const { mode } = useMasterTheme();
  const isDark = mode === "dark";

  return {
    isDark,
    text: isDark ? "#c5cdd9" : "#475569",
    muted: isDark ? "#8b95b0" : "#64748b",
    grid: isDark ? "#252a3a" : "#eef2f7",
    axisLine: isDark ? "#3a4060" : "#cbd5e1",
    divider: isDark ? "#252a3a" : "#E2E8F0",
    cursorFill: isDark ? "rgba(80,90,120,0.18)" : "rgba(148,163,184,0.12)",
    tooltipBg: isDark ? "#14171f" : "#ffffff",
    tooltipBorder: isDark ? "#252a3a" : "#e5e7eb",
    // Dashed AVG reference line — a quiet guide, softened off near-black
    // (slate-500/400) so it sits behind the data bars without competing.
    avgLine: isDark ? "#94a3b8" : "#64748b",
    // The AVG number stays crisp (slate-700/200): softer than before but
    // still high-contrast for the small bold label.
    avgLabel: isDark ? "#e2e8f0" : "#334155",
    avgLabelHalo: isDark ? "rgba(20,23,31,0.9)" : "rgba(255,255,255,0.9)",
  };
}
