"use client";

import { useMemo, useState } from "react";
import { useMasterFilters } from "@/features/intelligence/master/hooks/useMasterFilters";
import { useMasterData } from "@/features/intelligence/master/hooks/useMasterData";
import {
  AdsTrendRow,
  ColorByKey,
  KpiRow,
  SalesByRow,
  TicketBySaleTypeRow,
  ViewKey,
} from "@/features/intelligence/master/types";
import { downloadAs } from "@/features/intelligence/master/lib/exporters";
import { todayStamp } from "@/features/intelligence/master/lib/csv";
import { formatMonthYearShort } from "@/features/intelligence/master/lib/format";
import { TopProgressBar } from "@/features/intelligence/master/components/export/TopProgressBar";

type SummaryKey =
  | "kpi-monthly"
  | "main-chart-monthly"
  | "ads-trend"
  | "ticket-by-sale-type";

interface Option {
  key: SummaryKey;
  label: string;
  description: string;
}

const OPTIONS: Option[] = [
  {
    key: "main-chart-monthly",
    label: "Monthly Net Sales (Main chart)",
    description: "Sum of NetSales per month for the current view",
  },
  {
    key: "kpi-monthly",
    label: "KPI Summary per Month",
    description: "NetSales, Avg Ticket, ADS, Ticket count + MoM %",
  },
  {
    key: "ads-trend",
    label: "Branch ADS by Month",
    description: "Per-branch ADS trend (ADS = NetSales / distinct days)",
  },
  {
    key: "ticket-by-sale-type",
    label: "Average Ticket by Sale Type",
    description: "Per-month × order_type tickets and average value",
  },
];

interface Props {
  brand: string;
  view: ViewKey;
  colorBy: ColorByKey;
  onClose: () => void;
}

const PREVIEW_OPTIONS = [25, 50, 100, 1000, 10000] as const;

export function SummaryTab({ brand, view, colorBy, onClose }: Props) {
  const [selected, setSelected] = useState<SummaryKey>("main-chart-monthly");
  const [downloading, setDownloading] = useState(false);
  const [previewLimit, setPreviewLimit] = useState<number>(25);
  const { queryString } = useMasterFilters();

  // Build brand-aware query string for API calls.
  const brandQs = useMemo(() => {
    const base = queryString.length > 1 ? queryString : "";
    const sep = base.length > 1 ? "&" : "?";
    return `${base}${sep}brand=${encodeURIComponent(brand)}`;
  }, [queryString, brand]);

  const kpi = useMasterData<KpiRow[]>(
    "/api/intelligence/dashboards/master/kpi",
    brandQs
  );
  const sales = useMasterData<SalesByRow[]>(
    `/api/intelligence/dashboards/master/sales-by/${colorBy}`,
    brandQs
  );
  const ads = useMasterData<AdsTrendRow[]>(
    "/api/intelligence/dashboards/master/ads-trend",
    brandQs
  );
  const tbst = useMasterData<TicketBySaleTypeRow[]>(
    "/api/intelligence/dashboards/master/ticket-by-sale-type",
    brandQs
  );

  const { rows, headers, loading } = useMemo<{
    rows: Record<string, unknown>[];
    headers: string[];
    loading: boolean;
  }>(() => {
    if (selected === "kpi-monthly") {
      const r: Record<string, unknown>[] = (kpi.data ?? []).map((x) => {
        // Coerce + finiteness-check each KPI separately. SQL can return
        // NULL (→ NaN here) when a month has no tickets / no distinct
        // days; previously roundInt/round2 silently turned those into 0
        // and momPct=null was the only branch that rendered blank, so
        // "0" / "NaN%" cells leaked through. Render every undefined KPI
        // as "" so the preview + downloaded CSV/XLSX stay clean.
        const avg = Number(x.avgTicket);
        const ads = Number(x.ads);
        const mom = Number(x.momPct);
        return {
          Month: formatMonthYearShort(x.ym),
          NetSales: roundInt(x.netSales),
          AvgTicket: Number.isFinite(avg) ? round2(avg) : "",
          ADS: Number.isFinite(ads) ? roundInt(ads) : "",
          TicketCount: x.ticketCount,
          "MoM %":
            x.momPct === null || !Number.isFinite(mom)
              ? ""
              : (mom * 100).toFixed(2) + "%",
        };
      });
      return {
        rows: r,
        headers: ["Month", "NetSales", "AvgTicket", "ADS", "TicketCount", "MoM %"],
        loading: kpi.isLoading,
      };
    }
    if (selected === "main-chart-monthly") {
      const byKey = new Map<string, number>();
      const monthsSet = new Set<string>();
      const dimsSet = new Set<string>();
      const dimTotals = new Map<string, number>();
      for (const r of sales.data ?? []) {
        const ym = r.day.slice(0, 7); // YYYY-MM
        monthsSet.add(ym);
        dimsSet.add(r.dim);
        const k = `${ym}|${r.dim}`;
        byKey.set(k, (byKey.get(k) ?? 0) + r.netSales);
        dimTotals.set(r.dim, (dimTotals.get(r.dim) ?? 0) + r.netSales);
      }
      const months = Array.from(monthsSet).sort();

      const FLIP_THRESHOLD = 10;
      const dimCount = dimsSet.size;
      const flip = dimCount > FLIP_THRESHOLD;
      const monthHeaders = months.map((m) => formatMonthYearShort(m));

      if (flip) {
        const dimsRanked = Array.from(dimsSet).sort(
          (a, b) => (dimTotals.get(b) ?? 0) - (dimTotals.get(a) ?? 0)
        );
        const dimColumnLabel = view;
        const r = dimsRanked.map((d) => {
          const row: Record<string, unknown> = { [dimColumnLabel]: d };
          let total = 0;
          for (let i = 0; i < months.length; i++) {
            const m = months[i];
            const v = byKey.get(`${m}|${d}`) ?? 0;
            row[monthHeaders[i]] = roundInt(v);
            total += v;
          }
          row.Total = roundInt(total);
          return row;
        });
        return {
          rows: r,
          headers: [dimColumnLabel, ...monthHeaders, "Total"],
          loading: sales.isLoading,
        };
      }

      const dims = Array.from(dimsSet).sort();
      const r = months.map((m) => {
        const row: Record<string, unknown> = { Month: formatMonthYearShort(m) };
        let total = 0;
        for (const d of dims) {
          const v = byKey.get(`${m}|${d}`) ?? 0;
          row[d] = roundInt(v);
          total += v;
        }
        row.Total = roundInt(total);
        return row;
      });
      return {
        rows: r,
        headers: ["Month", ...dims, "Total"],
        loading: sales.isLoading,
      };
    }
    if (selected === "ads-trend") {
      const r: Record<string, unknown>[] = (ads.data ?? []).map((x) => ({
        Month: formatMonthYearShort(x.ym),
        Branch: x.branch_name,
        ADS: roundInt(x.ads),
      }));
      return {
        rows: r,
        headers: ["Month", "Branch", "ADS"],
        loading: ads.isLoading,
      };
    }
    if (selected === "ticket-by-sale-type") {
      const r: Record<string, unknown>[] = (tbst.data ?? []).map((x) => ({
        Month: formatMonthYearShort(x.ym),
        SaleType: x.order_type,
        TicketCount: x.ticketCount,
        AvgPerTicket: round2(x.avgPerTicket),
      }));
      return {
        rows: r,
        headers: ["Month", "SaleType", "TicketCount", "AvgPerTicket"],
        loading: tbst.isLoading,
      };
    }
    return { rows: [], headers: [], loading: false };
  }, [selected, view, kpi.data, kpi.isLoading, sales.data, sales.isLoading, ads.data, ads.isLoading, tbst.data, tbst.isLoading]);

  async function handleDownload(format: "csv" | "xlsx") {
    setDownloading(true);
    try {
      const stamp = todayStamp();
      const filename = `master-summary-${brand.toLowerCase()}-${selected}-${stamp}.${format}`;
      await new Promise((r) => setTimeout(r, 30));
      await downloadAs(format, filename, rows, headers);
    } finally {
      setDownloading(false);
    }
  }

  const previewRows = rows.slice(0, previewLimit);
  const visiblePreviewOptions = PREVIEW_OPTIONS.filter((v, i) => {
    if (i === 0) return true;
    return v <= rows.length;
  });

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Selector */}
      <div>
        <label
          className="block text-[11px] uppercase tracking-[0.08em] font-semibold mb-1.5"
          style={{ color: "var(--text-muted)" }}
        >
          Summary type
        </label>
        <div className="grid grid-cols-2 gap-2">
          {OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setSelected(o.key)}
              className="text-left rounded-lg px-3 py-2 transition-colors"
              style={{
                border: selected === o.key
                  ? "1px solid var(--accent)"
                  : "1px solid var(--border-card)",
                background: selected === o.key ? "var(--accent-subtle)" : undefined,
              }}
            >
              <div
                className="text-xs font-semibold"
                style={{ color: selected === o.key ? "var(--accent)" : "var(--text-primary)" }}
              >
                {o.label}
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                {o.description}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Preview */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-baseline justify-between mb-1.5 gap-2 flex-wrap shrink-0">
          <div
            className="text-[11px] uppercase tracking-[0.08em] font-semibold"
            style={{ color: "var(--text-muted)" }}
          >
            Preview ({Math.min(previewLimit, rows.length).toLocaleString()} of{" "}
            {rows.length.toLocaleString()} rows)
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>Show:</span>
            <div
              className="inline-flex rounded-md overflow-hidden"
              style={{ border: "1px solid var(--border-card)", background: "var(--bg-elevated)" }}
            >
              {visiblePreviewOptions.map((v, i) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setPreviewLimit(v)}
                  className="h-6 px-2 text-[11px] font-semibold transition-colors"
                  style={{
                    borderLeft: i > 0 ? "1px solid var(--border-card)" : undefined,
                    background: previewLimit === v ? "var(--accent-subtle)" : undefined,
                    color: previewLimit === v ? "var(--accent)" : "var(--text-primary)",
                  }}
                >
                  {v.toLocaleString()}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div
          className="rounded-lg overflow-auto scroll-thin flex-1 min-h-[200px]"
          style={{ border: "1px solid var(--border-card)" }}
        >
          <table className="w-full text-[12px] tabular-nums border-collapse">
            <thead
              className="sticky top-0 z-10"
              style={{ background: "var(--bg-elevated)", color: "var(--text-primary)" }}
            >
              <tr>
                {headers.map((h) => (
                  <th
                    key={h}
                    className="text-left font-semibold px-2 py-1.5 whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={`skel-${i}`} style={{ borderTop: "1px solid var(--border-card)" }}>
                    {headers.map((h) => (
                      <td key={h} className="px-2 py-1.5">
                        <div
                          className="skeleton h-3 rounded"
                          style={{
                            width: `${
                              50 +
                              Math.abs(
                                Math.sin((i + 1) * (h.length || 1) * 0.7)
                              ) *
                                40
                            }%`,
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))
              ) : previewRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={headers.length || 1}
                    className="px-2 py-6 text-center"
                    style={{ color: "var(--text-muted)" }}
                  >
                    No rows
                  </td>
                </tr>
              ) : (
                previewRows.map((row, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--border-card)" }}>
                    {headers.map((h) => (
                      <td
                        key={h}
                        className="px-2 py-1 whitespace-nowrap"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {formatPreview(row[h])}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer actions + download progress */}
      <div className="mt-auto">
        <TopProgressBar active={downloading} />
      </div>
      <div
        className="flex items-center justify-end gap-2 pt-2"
        style={{ borderTop: "1px solid var(--border-card)" }}
      >
        <button
          type="button"
          onClick={onClose}
          disabled={downloading}
          className="h-8 px-3 text-xs rounded-md transition-colors disabled:opacity-50"
          style={{
            border: "1px solid var(--border-card)",
            color: "var(--text-primary)",
            background: "var(--bg-elevated)",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={loading || rows.length === 0 || downloading}
          onClick={() => handleDownload("csv")}
          className="h-8 px-3 text-xs rounded-md transition-colors disabled:opacity-50"
          style={{
            border: "1px solid var(--border-card)",
            color: "var(--text-primary)",
            background: "var(--bg-elevated)",
          }}
        >
          {downloading ? "Preparing…" : "Download CSV"}
        </button>
        <button
          type="button"
          disabled={loading || rows.length === 0 || downloading}
          onClick={() => handleDownload("xlsx")}
          className="h-8 px-3 text-xs rounded-md font-semibold disabled:opacity-50"
          style={{
            background: "var(--accent)",
            color: "#fff",
          }}
        >
          {downloading ? "Preparing…" : "Download XLSX"}
        </button>
      </div>
    </div>
  );
}

function roundInt(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v) : 0;
}
function round2(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

function formatPreview(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number" && Number.isFinite(v)) {
    return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  return String(v);
}
