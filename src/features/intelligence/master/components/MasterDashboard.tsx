"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { prefetchDistincts, useDistincts } from "@/features/intelligence/master/hooks/useDistincts";
import { useMasterFilters } from "@/features/intelligence/master/hooks/useMasterFilters";
import { DashboardGrid } from "@/features/intelligence/master/components/DashboardGrid";
import { LeftRail } from "@/features/intelligence/master/components/LeftRail";
import { RightRail } from "@/features/intelligence/master/components/RightRail";
import { KpiStrip } from "@/features/intelligence/master/components/charts/KpiStrip";
import { TicketCountStrip } from "@/features/intelligence/master/components/charts/TicketCountStrip";
import { TicketBySaleType } from "@/features/intelligence/master/components/charts/TicketBySaleType";
import { NetSalesBar } from "@/features/intelligence/master/components/charts/NetSalesBar";
import { MonthAdsChart } from "@/features/intelligence/master/components/charts/MonthAdsChart";
import { NetSalesByStore } from "@/features/intelligence/master/components/charts/NetSalesByStore";
import { ChartCard } from "@/features/intelligence/master/components/charts/ChartCard";
import { DashboardTour } from "@/features/intelligence/master/components/tour/DashboardTour";
import { BrandSwitchOverlay } from "@/features/intelligence/master/components/BrandSwitchOverlay";
import { MasterThemeProvider } from "@/features/intelligence/master/hooks/useMasterTheme";
import { ViewKey, VIEW_TO_COLORBY, VIEW_TO_METRIC } from "@/features/intelligence/master/types";
import { getDefaultYms, getDefaultYmsAsOf } from "@/features/intelligence/master/lib/format";
import { FullScreenModal } from "@/components/ui/FullScreenModal";
import { Maximize2, SlidersHorizontal, LayoutGrid } from "lucide-react";

const DEFAULT_MONTH_COUNT = 3;

// Filter columns to warm up on first paint — every dropdown the user can open.
const PREFETCH_COLS = [
  "ym",
  "branch_id",
  "branch_name",
  "category",
  "channel",
  "menu_code",
  "menu_name",
  "order_type",
  "payment_type",
  "void_flag",
  "is_revenue",
];

interface Props {
  brand: string;
}

export function MasterDashboard({ brand }: Props) {
  const [view, setView] = useState<ViewKey>("Sale Channel");
  const [pairFullOpen, setPairFullOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const colorBy = VIEW_TO_COLORBY[view];
  const metric = VIEW_TO_METRIC[view];
  const { filters, setFilter, setFilters } = useMasterFilters();
  const router = useRouter();

  // Refs that gate the first-mount-only init effects. Declared up-front
  // so the reload-reset effect below can flip `dataQualityInit` before
  // the cold-load effect ever runs.
  const reloadResetRef = useRef(false);
  const dataQualityInit = useRef(false);
  const initialized = useRef(false);

  // Kick off all distinct-value fetches in parallel as soon as the dashboard
  // mounts. By the time the user clicks a filter, options are already cached.
  useEffect(() => {
    prefetchDistincts(brand, PREFETCH_COLS);
  }, [brand]);

  // ─── Refresh = reset ─────────────────────────────────────────────
  // A browser reload (F5 / Cmd+R) should drop every user-applied
  // filter and start from the dashboard's cold-load defaults. We
  // detect "reload" via the PerformanceNavigationTiming entry — any
  // other navigation type (link, typed URL, browser back/forward,
  // share-URL paste) is left untouched so URLs remain shareable.
  //
  // We write `void_flag=0` + `is_revenue=1` here directly and mark
  // `dataQualityInit` as already-done so the cold-load effect below
  // doesn't redundantly re-apply them on the next render. The `ym`
  // default is left to the ym-init effect because it depends on
  // distinct months loaded from the API.
  useEffect(() => {
    if (reloadResetRef.current) return;
    reloadResetRef.current = true;
    if (typeof window === "undefined") return;
    const entry = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    if (entry?.type !== "reload") return;
    const sp = new URLSearchParams();
    sp.append("void_flag", "0");
    sp.append("is_revenue", "1");
    // Preserve the brand param on reload so the user stays on their chosen brand.
    if (brand) sp.set("brand", brand);
    router.replace(`${window.location.pathname}?${sp.toString()}`, {
      scroll: false,
    });
    dataQualityInit.current = true;
    // Note: we deliberately leave `initialized.current = false` so the
    // ym-init effect below sees the now-empty `filters.ym` and writes
    // the 3-latest-months default.
  }, [router, brand]);

  // ─── First-mount data-quality defaults ──────────────────────────
  // On cold load (no `void_flag` / `is_revenue` in the URL) we
  // pre-populate the URL with the dashboard defaults — `void_flag=0`
  // (non-voided rows only) and `is_revenue=1` (revenue rows only).
  //
  // This is FIRST-MOUNT-ONLY (guarded by `dataQualityInit`). Once
  // applied, subsequent clears via the global "Clear" button or per-
  // filter "Clear all" buttons are honoured — the URL truly empties
  // and the filters return to their visually-all-ticked state. To
  // reapply the defaults afterwards, the user clicks the dedicated
  // "Reset" button in the FilterPanel header.
  useEffect(() => {
    if (dataQualityInit.current) return;
    dataQualityInit.current = true;
    const updates: Record<string, string[]> = {};
    if (!filters.void_flag || filters.void_flag.length === 0) {
      updates.void_flag = ["0"];
    }
    if (!filters.is_revenue || filters.is_revenue.length === 0) {
      updates.is_revenue = ["1"];
    }
    if (Object.keys(updates).length > 0) {
      setFilters(updates);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Available months from the database — fetched via the same hook
  // the Date filter dropdown uses, so this is essentially "free"
  // (deduped + cached). We use it to pick a default that's the latest
  // months that actually HAVE DATA (vs. the previous behaviour which
  // used calendar months and could include an empty current/past
  // month — the bug the user hit where filter said "3 selected" but
  // chart only showed 2).
  const ymDistincts = useDistincts(brand, "ym");

  // First-mount-only: keep the Date filter aligned with the latest
  // months that have data. We auto-populate / auto-roll the URL `ym`
  // params:
  //   1. URL empty + months loaded → write the latest N months that
  //      actually exist in the data.
  //   2. URL holds an old auto-default (calendar-based or older
  //      data-based) → roll forward to today's data-based default.
  //   3. URL holds anything else → respect it (user-chosen months).
  //
  // We wait until `ymDistincts.options` is populated before writing —
  // otherwise we'd fall back to the calendar default and potentially
  // include a month that has no data.
  useEffect(() => {
    if (!ymDistincts.options) return; // still loading distinct ym values

    const available = ymDistincts.options.map((o) => o);
    const current = filters.ym ?? [];

    // Latest N months that exist in the data (descending). The
    // distinct API already returns them ASC, so slice from the tail.
    const dataDefault =
      available.length >= DEFAULT_MONTH_COUNT
        ? available.slice(-DEFAULT_MONTH_COUNT)
        : Array.from(available);

    // Empty URL — either first load or after Clear All. Always
    // re-apply the latest-N-months data default so the dashboard
    // never sits on an empty date filter.
    if (current.length === 0) {
      setFilter("ym", dataDefault);
      return;
    }

    if (initialized.current) return;
    initialized.current = true;

    // Already on today's data-based default — nothing to do.
    const sameAsData =
      current.length === dataDefault.length &&
      Array.from(current).sort().join() === Array.from(dataDefault).sort().join();
    if (sameAsData) return;

    // Look back up to 12 months for a previously-applied auto-default
    // (calendar-based fallback the page used before this fix, or an
    // older data window). If the URL matches one of those, roll
    // forward to today's data window.
    const LOOKBACK = 12;
    for (let monthsAgo = 1; monthsAgo <= LOOKBACK; monthsAgo++) {
      const past = getDefaultYmsAsOf(DEFAULT_MONTH_COUNT, monthsAgo);
      const same =
        current.length === past.length &&
        Array.from(current).sort().join() === Array.from(past).sort().join();
      if (same) {
        setFilter("ym", dataDefault);
        return;
      }
    }
    const calendarDefault = getDefaultYms(DEFAULT_MONTH_COUNT);
    if (
      current.length === calendarDefault.length &&
      Array.from(current).sort().join() === Array.from(calendarDefault).sort().join()
    ) {
      setFilter("ym", dataDefault);
      return;
    }
    // Otherwise: user-chosen — leave it alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ymDistincts.options, filters.ym]);

  // Per-view title overrides — the metric-flavoured views need a
  // sentence that reads naturally instead of "Net Sales by …".
  const mainChartTitle =
    view === "Ticket Count"
      ? "Ticket Count by Channel"
      : view === "Ticket Average"
      ? "Ticket Average by Channel"
      : `Net Sales by ${view}`;

  return (
    <MasterThemeProvider>
      <DashboardGrid
        left={<LeftRail brand={brand} view={view} colorBy={colorBy} />}
        right={
          <RightRail
            brand={brand}
            view={view}
            colorBy={colorBy}
            metric={metric}
            onViewChange={setView}
          />
        }
        center={
          <>
            {/* Compact-width actions: open the rails in full-screen sheets.
                Shown below lg, where the side rails are collapsed. */}
            <div className="flex lg:hidden items-center justify-between gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setToolsOpen(true)}
                className="flex-1 text-[12px] font-bold px-3 py-2.5 min-h-[44px] rounded-lg cursor-pointer transition-colors"
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-card)",
                  color: "var(--text-secondary)",
                }}
              >
                <span className="inline-flex items-center justify-center gap-2">
                  <LayoutGrid size={16} />
                  Tools
                </span>
              </button>
              <button
                type="button"
                onClick={() => setFiltersOpen(true)}
                className="flex-1 text-[12px] font-bold px-3 py-2.5 min-h-[44px] rounded-lg cursor-pointer transition-colors"
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-card)",
                  color: "var(--text-secondary)",
                }}
              >
                <span className="inline-flex items-center justify-center gap-2">
                  <SlidersHorizontal size={16} />
                  Filters
                </span>
              </button>
            </div>

            <div className="shrink-0" data-export-id="kpi-strip">
              <KpiStrip brand={brand} />
            </div>
            <div className="shrink-0" data-export-id="ticket-strip">
              <TicketCountStrip brand={brand} />
            </div>
            <div className="shrink-0" data-export-id="ticket-by-sale-type">
              <TicketBySaleType brand={brand} />
            </div>
            <div className="h-[440px] md:h-[600px] shrink-0" data-export-id="main-bar">
              <ChartCard title={mainChartTitle} className="h-full">
                <NetSalesBar brand={brand} colorBy={colorBy} metric={metric} />
              </ChartCard>
            </div>
            <div className="flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setPairFullOpen(true)}
                className="text-[11px] font-bold px-2.5 py-1 rounded-lg cursor-pointer transition-colors"
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-card)",
                  color: "var(--text-secondary)",
                }}
                title="Full screen"
              >
                <span className="inline-flex items-center gap-1.5">
                  <Maximize2 size={14} />
                  Full screen
                </span>
              </button>
            </div>
            <div
              className="grid gap-2 min-w-0 shrink-0 md:h-[460px] grid-cols-1 md:grid-cols-2"
            >
              <div data-export-id="branch-ads" className="min-w-0 h-[380px] md:h-full">
                <ChartCard title="Branch ADS — MoM Growth %" className="h-full">
                  <div className="h-full overflow-auto scroll-thin">
                    <MonthAdsChart brand={brand} />
                  </div>
                </ChartCard>
              </div>
              <div data-export-id="by-store" className="min-w-0 h-[380px] md:h-full">
                <ChartCard title="Net Sales by Store" className="h-full">
                  <NetSalesByStore brand={brand} />
                </ChartCard>
              </div>
            </div>
          </>
        }
      />
      <DashboardTour brand={brand} />
      <BrandSwitchOverlay brand={brand} />

      {/* Mobile rails as full-screen modals */}
      <FullScreenModal
        open={toolsOpen}
        onClose={() => setToolsOpen(false)}
        title="Tools"
        zIndex={210}
      >
        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin p-2 sm:p-3">
          <div className="flex flex-col gap-2 min-w-0 max-w-[560px] mx-auto w-full">
            <LeftRail brand={brand} view={view} colorBy={colorBy} />
          </div>
        </div>
      </FullScreenModal>

      <FullScreenModal
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        zIndex={210}
      >
        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin p-2 sm:p-3">
          <div className="flex flex-col gap-2 min-w-0 max-w-[560px] mx-auto w-full">
            <RightRail
              brand={brand}
              view={view}
              colorBy={colorBy}
              metric={metric}
              onViewChange={setView}
            />
          </div>
        </div>
      </FullScreenModal>

      <FullScreenModal
        open={pairFullOpen}
        onClose={() => setPairFullOpen(false)}
        title="Branch ADS — MoM Growth %  •  Net Sales by Store"
        zIndex={200}
      >
        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin p-3">
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
            <div className="min-w-0">
              <div className="h-[calc(100vh-88px)] min-h-[420px]">
                <ChartCard title="Branch ADS — MoM Growth %" className="h-full">
                  <div className="h-full overflow-auto scroll-thin">
                    <MonthAdsChart brand={brand} />
                  </div>
                </ChartCard>
              </div>
            </div>
            <div className="min-w-0">
              <div className="h-[calc(100vh-88px)] min-h-[420px]">
                <ChartCard title="Net Sales by Store" className="h-full">
                  <NetSalesByStore brand={brand} />
                </ChartCard>
              </div>
            </div>
          </div>
        </div>
      </FullScreenModal>
    </MasterThemeProvider>
  );
}
