export const BRAND_COLORS: Record<string, string> = {
  UNO: "#dc2626",
  KSI: "#5A4118",
  // PCTH: "#16a34a",   // Coming soon
  // PCMY: "#FFEA00",   // Coming soon
  // Rocks: "#A3121B",  // Coming soon
};

export const CHART_COLORS = [
  "#A3121B", "#2563eb", "#16a34a", "#f59e0b", "#7c3aed",
  "#ec4899", "#06b6d4", "#ea580c", "#84cc16", "#6366f1",
  "#14b8a6", "#d97706", "#8b5cf6", "#f43f5e", "#0ea5e9",
];

export const REPORT_CATEGORIES = [
  "Executive",
  "Operations",
  "Finance",
  "Marketing",
  "Business Development",
] as const;

export const PERIOD_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "l7d", label: "Last 7 Days" },
  { value: "wtd", label: "This Week" },
  { value: "lwk", label: "Last Week" },
  { value: "mtd", label: "MTD" },
  { value: "lmth", label: "Last Month" },
  { value: "qtd", label: "This Quarter" },
  { value: "lqtr", label: "Last Quarter" },
  { value: "ytd", label: "YTD" },
] as const;

/* ---------- Date helpers ---------- */

/** Format Date to YYYY-MM-DD using local getters */
export const fmtDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const _parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** Resolve a period code to a [from, to] date range. fallback: "30d" or "yesterday" */
export function getDateRange(period: string, fallback: "30d" | "yesterday" = "30d"): [string, string] {
  const now = new Date();
  const today = fmtDate(now);
  const dayOfWeek = now.getDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

  if (period === "today") return [today, today];
  if (period === "yesterday") { const y = new Date(now); y.setDate(y.getDate() - 1); return [fmtDate(y), fmtDate(y)]; }
  if (period === "l7d") { const d = new Date(now); d.setDate(d.getDate() - 6); return [fmtDate(d), today]; }
  if (period === "wtd") { const mon = new Date(now); mon.setDate(mon.getDate() - daysSinceMonday); return [fmtDate(mon), today]; }
  if (period === "lwk") {
    const thisMon = new Date(now); thisMon.setDate(thisMon.getDate() - daysSinceMonday);
    const lastMon = new Date(thisMon); lastMon.setDate(lastMon.getDate() - 7);
    const lastSun = new Date(thisMon); lastSun.setDate(lastSun.getDate() - 1);
    return [fmtDate(lastMon), fmtDate(lastSun)];
  }
  if (period === "mtd") { return [`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`, today]; }
  if (period === "lmth") {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    return [fmtDate(first), fmtDate(last)];
  }
  if (period === "qtd") {
    const qm = Math.floor(now.getMonth() / 3) * 3;
    const qStart = fmtDate(new Date(now.getFullYear(), qm, 1));
    if (qStart === today) return [fmtDate(new Date(now.getFullYear(), qm - 3, 1)), fmtDate(new Date(now.getFullYear(), qm, 0))];
    return [qStart, today];
  }
  if (period === "lqtr") {
    const qm = Math.floor(now.getMonth() / 3) * 3;
    return [fmtDate(new Date(now.getFullYear(), qm - 3, 1)), fmtDate(new Date(now.getFullYear(), qm, 0))];
  }
  if (period === "ytd") { return [`${now.getFullYear()}-01-01`, today]; }
  // Fallback
  if (fallback === "yesterday") { const y = new Date(now); y.setDate(y.getDate() - 1); return [fmtDate(y), fmtDate(y)]; }
  return [fmtDate(new Date(now.getTime() - 30 * 86400000)), today];
}

/* ---------- VS comparison helpers ---------- */

/** Given a period code and its resolved from/to, return the comparison range. */
export function getComparisonRange(period: string, from: string, to: string): [string, string] {
  const f = _parse(from), t = _parse(to);
  const shift = (months: number, days: number, years: number): [string, string] => {
    const a = new Date(f), b = new Date(t);
    a.setFullYear(a.getFullYear() - years); b.setFullYear(b.getFullYear() - years);
    a.setMonth(a.getMonth() - months); b.setMonth(b.getMonth() - months);
    a.setDate(a.getDate() - days); b.setDate(b.getDate() - days);
    return [fmtDate(a), fmtDate(b)];
  };
  switch (period) {
    case "today":
    case "yesterday": return shift(0, 1, 0);
    case "l7d":
    case "wtd":
    case "lwk": return shift(0, 7, 0);
    case "mtd":
    case "lmth": return shift(1, 0, 0);
    case "qtd":
    case "lqtr": return shift(3, 0, 0);
    case "ytd": return shift(0, 0, 1);
    default: {
      const diff = Math.round((t.getTime() - f.getTime()) / 86400000) + 1;
      return shift(0, diff, 0);
    }
  }
}

const _MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** Human-readable VS label (e.g. "Mar vs Feb") */
export function getVsLabel(period: string): string {
  const now = new Date();
  const m = now.getMonth(); // 0-indexed
  switch (period) {
    case "today": return "vs Yesterday";
    case "yesterday": return "vs Day Before";
    case "l7d": return "vs Prior 7 Days";
    case "wtd": return "vs Last Week";
    case "lwk": return "vs Week Before";
    case "mtd": return `${_MONTHS[m]} vs ${_MONTHS[(m - 1 + 12) % 12]}`;
    case "lmth": return `${_MONTHS[(m - 1 + 12) % 12]} vs ${_MONTHS[(m - 2 + 12) % 12]}`;
    case "qtd": { const q = Math.floor(m / 3) + 1; return `Q${q} vs Q${q === 1 ? 4 : q - 1}`; }
    case "lqtr": { const q = Math.floor(m / 3) + 1; const lq = q === 1 ? 4 : q - 1; return `Q${lq} vs Q${lq === 1 ? 4 : lq - 1}`; }
    case "ytd": return `${now.getFullYear()} vs ${now.getFullYear() - 1}`;
    default: return "vs Previous";
  }
}

/** Percentage change: ((current - previous) / previous) * 100, rounded to 1 decimal. */
export function pctChange(current: number, previous: number | undefined | null): number | undefined {
  if (!previous) return undefined;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export const CUSTOM_DASHBOARDS = [
  {
    id: "master",
    name: "Master Dashboard",
    description: "Executive overview — revenue, branches, and daily trends at a glance",
    icon: "BarChart3",
    href: "/intelligence/dashboards/master",
  },
  {
    id: "daily-sales",
    name: "Daily Sales Pulse",
    description: "Revenue trends, bill count, and average ticket size",
    icon: "TrendingUp",
    href: "/intelligence/dashboards/daily-sales",
  },
  {
    id: "branch-performance",
    name: "Branch Performance",
    description: "Revenue ranking and comparison across all branches",
    icon: "Building2",
    href: "/intelligence/dashboards/branch-performance",
  },
  {
    id: "top-products",
    name: "Top Products",
    description: "Best sellers, category mix, and product analytics",
    icon: "Coffee",
    href: "/intelligence/dashboards/top-products",
  },
  {
    id: "hourly-products",
    name: "Hourly Products",
    description: "Revenue and top products by hour of day",
    icon: "Clock",
    href: "/intelligence/dashboards/hourly-products",
  },
  {
    id: "product-by-hour",
    name: "Product by Hour",
    description: "All product sales by hour — heatmap matrix",
    icon: "LayoutGrid",
    href: "/intelligence/dashboards/product-by-hour",
  },
  {
    id: "product-option",
    name: "Product & Option",
    description: "Blend, sweetness, milk preferences by product",
    icon: "Settings2",
    href: "/intelligence/dashboards/product-option",
  },
  {
    id: "payment-mix",
    name: "Payment Mix",
    description: "Cash vs digital payments, method breakdown, and adoption trends",
    icon: "Wallet",
    href: "/intelligence/dashboards/payment-mix",
  },
] as const;
