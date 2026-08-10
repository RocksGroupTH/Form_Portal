"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MultiSelect } from "./MultiSelect";
import { useMasterFilters } from "@/features/intelligence/master/hooks/useMasterFilters";
import { useBranchMap } from "@/features/intelligence/master/hooks/useBranchMap";
import { useDistincts } from "@/features/intelligence/master/hooks/useDistincts";
import { FilterKey } from "@/features/intelligence/master/types";

interface Props {
  brand: string;
}

const DEFAULT_MONTH_COUNT = 3;

// Order matters — these are rendered top-to-bottom in the panel.
// Grouped: branch pair, then category + the menu pair (which the
// user wants visually adjacent), then channel/order_type/payment_type,
// then the data-quality filters (void_flag / is_revenue).
//
// void_flag and is_revenue are visible BUT have sticky defaults
// (void_flag=['0'], is_revenue=['1']) that the page-level effect
// auto-restores whenever they're cleared. The user can ADD values
// (e.g. tick "1" in void_flag to also see voids) but cannot leave
// the filter empty.
const FIELDS: Array<{ key: FilterKey; label: string; col: string }> = [
  { key: "branch_id", label: "Branch ID", col: "branch_id" },
  { key: "branch_name", label: "Branch Name", col: "branch_name" },
  { key: "category", label: "Category", col: "category" },
  { key: "menu_code", label: "Menu Code", col: "menu_code" },
  { key: "menu_name", label: "Menu Name", col: "menu_name" },
  { key: "channel", label: "Channel", col: "channel" },
  { key: "order_type", label: "Order Type", col: "order_type" },
  { key: "payment_type", label: "Payment Type", col: "payment_type" },
  { key: "void_flag", label: "Void Flag", col: "void_flag" },
  { key: "is_revenue", label: "Is Revenue", col: "is_revenue" },
];

export function FilterPanel({ brand }: Props) {
  const { filters, setFilter, setFilters } = useMasterFilters();
  const { idToNames, nameToIds } = useBranchMap(brand);
  const ymDistincts = useDistincts(brand, "ym");
  // Count only the filter columns shown in this panel (not `ym`, which
  // is the Date filter and is always populated by the auto-default).
  const activeCount = FIELDS.reduce(
    (s, f) => s + (filters[f.key]?.length ?? 0),
    0
  );

  /** Linked-filter behaviour for branch_id / branch_name: picking
   *  values in one side mirrors the matching values into the other in
   *  a single URL update (uses setFilters so the two writes don't
   *  race against each other's stale searchParams). */
  function handleBranchIdChange(ids: string[]) {
    const names = unique(ids.flatMap((id) => idToNames.get(id) ?? []));
    setFilters({ branch_id: ids, branch_name: names });
  }
  function handleBranchNameChange(names: string[]) {
    const ids = unique(names.flatMap((name) => nameToIds.get(name) ?? []));
    setFilters({ branch_id: ids, branch_name: names });
  }

  /** "Reset to default" — clear every user-picked filter AND restore
   *  the data-quality defaults (void_flag=['0'], is_revenue=['1']) in
   *  one atomic URL write, while LEAVING the date filter (`ym`) alone
   *  so the user keeps the time period they're analysing.
   *
   *  Differs from the global "Clear all" (which calls `clearAll()` —
   *  wipes every URL param including `ym`, then the auto-restore
   *  effects in page.tsx repopulate the date + data-quality
   *  defaults on the next render). Use Reset when you want to
   *  return to a clean dashboard within the current month range,
   *  Clear when you want a fresh start. */
  function handleResetToDefault() {
    setFilters({
      branch_id: [],
      branch_name: [],
      category: [],
      menu_code: [],
      menu_name: [],
      channel: [],
      order_type: [],
      payment_type: [],
      void_flag: ["0"],
      is_revenue: ["1"],
    });
  }

  /** "Clear" — wipe every user-picked filter (including data-quality
   *  defaults) AND force the Date filter to the latest 3 months that
   *  have data. Written as a single atomic URL update so the Date is
   *  guaranteed to land on 3 months regardless of effect ordering.
   *  Falls back to ym=[] (and lets MasterDashboard's auto-restore
   *  effect repopulate) if distinct months haven't loaded yet. */
  function handleClearAll() {
    const available = ymDistincts.options;
    const latestN =
      available && available.length > 0
        ? available.slice(-DEFAULT_MONTH_COUNT)
        : [];
    setFilters({
      branch_id: [],
      branch_name: [],
      category: [],
      menu_code: [],
      menu_name: [],
      channel: [],
      order_type: [],
      payment_type: [],
      void_flag: [],
      is_revenue: [],
      ym: latestN,
    });
  }

  return (
    <div
      className="card p-2 flex flex-col flex-1 min-h-0 gap-1"
      data-tour="filter-panel"
    >
      <div className="flex items-center justify-between shrink-0 gap-2">
        <div
          className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.08em] font-semibold"
          style={{ color: "var(--text-muted)" }}
        >
          Filters
          {activeCount > 0 && (
            <span
              className="ml-0.5 inline-flex items-center justify-center rounded-full px-1.5 py-[1px] text-[9px] font-semibold"
              style={{
                background: "color-mix(in srgb, var(--color-accent, #b89a5a) 10%, transparent)",
                color: "var(--color-accent, #b89a5a)",
              }}
            >
              {activeCount}
            </span>
          )}
          <DefaultsInfo />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleResetToDefault}
            className="text-[11px]"
            style={{ color: "var(--text-muted)" }}
            title="Clear user-picked filters and restore data-quality defaults — keeps your selected date range"
          >
            Reset
          </button>
          <button
            onClick={handleClearAll}
            disabled={activeCount === 0}
            className="text-[11px] disabled:opacity-40"
            style={{ color: "var(--text-muted)" }}
            title="Wipe every filter (including void/revenue defaults) and set Date to the latest 3 months that have data"
          >
            Clear
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scroll-thin flex flex-col gap-1 pr-0.5">
        {FIELDS.map((f) => {
          const onChange =
            f.key === "branch_id"
              ? handleBranchIdChange
              : f.key === "branch_name"
              ? handleBranchNameChange
              : (v: string[]) => setFilter(f.key, v);
          // Auto-tick when empty draft for the locked data-quality
          // flags only. payment_type is a free-pick filter — empty
          // draft shows every option unticked (label "All") until
          // the user explicitly picks.
          const autoTick =
            f.key === "void_flag" || f.key === "is_revenue";
          return (
            <MultiSelect
              key={f.key}
              brand={brand}
              label={f.label}
              col={f.col}
              values={filters[f.key] ?? []}
              onChange={onChange}
              autoTickWhenEmpty={autoTick}
            />
          );
        })}
      </div>
    </div>
  );
}

function unique<T>(arr: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const v of arr) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/**
 * Hover-tooltip that explains the dashboard's "sticky default"
 * filters (date / void_flag / is_revenue). Rendered via a portal so
 * the popup never gets clipped by the FilterPanel's `min-h-0` flex
 * column. Anchored to the right of the ⓘ trigger; falls back to the
 * left if it would overflow the viewport.
 */
function DefaultsInfo() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null
  );
  const btnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const W = 230;
      const GAP = 6;
      // Prefer placing the tooltip to the LEFT of the icon — the
      // FilterPanel lives in the right rail so there's barely any
      // viewport space to the right.
      let left = r.left - W - GAP;
      if (left < 8) left = r.right + GAP;
      setCoords({ top: r.top - 4, left });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const tooltip =
    open && coords ? (
      <div
        style={{
          position: "fixed",
          top: coords.top,
          left: coords.left,
          width: 230,
          zIndex: 9999,
          background: "var(--bg-card)",
          borderColor: "var(--border-subtle)",
          color: "var(--text-secondary)",
        }}
        className="rounded-md border shadow-lg px-2.5 py-2 text-[10.5px] leading-snug space-y-1 pointer-events-none"
        role="tooltip"
      >
        <div
          className="font-semibold text-[10px] uppercase tracking-[0.06em]"
          style={{ color: "var(--color-accent, #b89a5a)" }}
        >
          Default filters
        </div>
        <div className="whitespace-nowrap">
          <span className="font-semibold">Date</span> — 3 เดือนล่าสุดที่มีข้อมูล
        </div>
        <div className="whitespace-nowrap">
          <span className="font-semibold">Void Flag</span> —{" "}
          <code className="text-[10px]">0</code> เท่านั้น
        </div>
        <div className="whitespace-nowrap">
          <span className="font-semibold">Is Revenue</span> —{" "}
          <code className="text-[10px]">1</code> เท่านั้น
        </div>
      </div>
    ) : null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-label="About default filters"
        className="ml-0.5 inline-flex items-center justify-center h-4 w-4 rounded-full border text-[9px] font-bold transition-colors"
        style={
          open
            ? {
                background: "var(--color-accent, #b89a5a)",
                borderColor: "var(--color-accent, #b89a5a)",
                color: "white",
              }
            : {
                background: "transparent",
                borderColor: "var(--border-subtle)",
                color: "var(--text-muted)",
              }
        }
      >
        i
      </button>
      {mounted && tooltip ? createPortal(tooltip, document.body) : null}
    </>
  );
}
