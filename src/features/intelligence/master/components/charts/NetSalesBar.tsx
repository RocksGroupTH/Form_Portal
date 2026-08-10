"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ZIndexLayer,
  usePlotArea,
  useYAxisScale,
} from "recharts";
import { useMasterFilters } from "@/features/intelligence/master/hooks/useMasterFilters";
import { useMasterData } from "@/features/intelligence/master/hooks/useMasterData";
import { useChartTheme } from "@/features/intelligence/master/hooks/useChartTheme";
import { ColorByKey, MetricKey, SalesByRow } from "@/features/intelligence/master/types";
import { colorFor } from "@/features/intelligence/master/lib/palette";
import { formatTHB, MONTHS_SHORT } from "@/features/intelligence/master/lib/format";
import { ChartEmpty, ChartError, ChartSkeleton } from "./ChartState";
import { StackedTooltip } from "./StackedTooltip";

interface Props {
  brand: string;
  colorBy: ColorByKey;
  /** "netSales" (default) plots SUM(NetSalse) on Y. "ticketCount"
   *  plots COUNT(DISTINCT Id) — the number of unique receipts. */
  metric?: MetricKey;
}

/** Format a Y-axis value depending on what metric we're plotting. */
function formatMetric(v: number, metric: MetricKey): string {
  if (metric === "ticketCount") {
    // Plain integer with thousands separator — currency formatting
    // would be misleading.
    return Math.round(v).toLocaleString("en-US");
  }
  if (metric === "ticketAvg") {
    // "Average usage" reading — render as a plain decimal number, no
    // ฿ prefix. Keeps 1 decimal so small differences between channels
    // (e.g. 85.4 vs 85.9) stay readable.
    return v.toLocaleString("en-US", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  }
  return formatTHB(v);
}

interface RowShape {
  day: string;
  dayOfMonth: number;
  ym: string;
  year: number;
  month: number;
  total: number;
}

interface MonthSegment {
  ym: string;
  year: number;
  month: number;
  startIdx: number;
  endIdx: number;
  avg: number;
}

interface YearSegment {
  year: number;
  startIdx: number;
  endIdx: number;
}

export function NetSalesBar({ brand, colorBy, metric = "netSales" }: Props) {
  const { queryString } = useMasterFilters();
  // Append the metric to the cache/query key so net-sales and
  // ticket-count requests don't share a cached payload.
  // queryString already starts with "?" or is empty.
  const baseQs = queryString
    ? `${queryString}&brand=${brand}&metric=${metric}`
    : `?brand=${brand}&metric=${metric}`;
  const { data, isLoading, error } = useMasterData<SalesByRow[]>(
    `/api/intelligence/dashboards/master/sales-by/${colorBy}`,
    baseQs
  );

  const { rows, keys, monthSegs, yearSegs, yMax } = useMemo(() => {
    const byDay = new Map<string, RowShape & Record<string, number>>();
    const dimTotals = new Map<string, number>();

    for (const r of data ?? []) {
      const [ys, ms, ds] = r.day.split("-");
      const year = Number(ys);
      const month = Number(ms);
      const dayOfMonth = Number(ds);
      const ym = `${ys}-${ms}`;
      const existing = byDay.get(r.day);
      if (existing) {
        existing[r.dim] = (existing[r.dim] ?? 0) + r.netSales;
        existing.total = (existing.total ?? 0) + r.netSales;
      } else {
        byDay.set(r.day, {
          day: r.day,
          dayOfMonth,
          ym,
          year,
          month,
          total: r.netSales,
          [r.dim]: r.netSales,
        } as RowShape & Record<string, number>);
      }
      dimTotals.set(r.dim, (dimTotals.get(r.dim) ?? 0) + r.netSales);
    }

    const rows = Array.from(byDay.values()).sort((a, b) =>
      a.day.localeCompare(b.day)
    );

    // For the Hourly view stack hours chronologically (AM → PM, top → bottom).
    // Other views rank dim values by total NetSalse desc.
    const keys =
      colorBy === "hour"
        ? Array.from(dimTotals.keys()).sort((a, b) => Number(a) - Number(b))
        : Array.from(dimTotals.entries())
            .sort((a, b) => b[1] - a[1])
            .map((e) => e[0]);

    const monthSegs: MonthSegment[] = [];
    let cursor = 0;
    while (cursor < rows.length) {
      const ym = rows[cursor].ym;
      let end = cursor;
      let sum = 0;
      while (end < rows.length && rows[end].ym === ym) {
        sum += rows[end].total;
        end++;
      }
      const count = end - cursor;
      monthSegs.push({
        ym,
        year: rows[cursor].year,
        month: rows[cursor].month,
        startIdx: cursor,
        endIdx: end - 1,
        avg: count > 0 ? sum / count : 0,
      });
      cursor = end;
    }

    const yearSegs: YearSegment[] = [];
    let yc = 0;
    while (yc < rows.length) {
      const year = rows[yc].year;
      let end = yc;
      while (end < rows.length && rows[end].year === year) end++;
      yearSegs.push({ year, startIdx: yc, endIdx: end - 1 });
      yc = end;
    }

    // Pad y-axis upper bound by 15% so the AVG label has breathing room.
    const peak = Math.max(0, ...rows.map((r) => r.total));
    const yMax = peak > 0 ? peak * 1.18 : 1;

    return { rows, keys, monthSegs, yearSegs, yMax };
  }, [data, colorBy]);

  if (error) return <ChartError message={error.message} />;
  if (isLoading || !data) return <ChartSkeleton />;
  if (rows.length === 0)
    return (
      <ChartEmpty
        icon="📈"
        title="No sales data"
        hint="ลองเปลี่ยนช่วงเดือนหรือลบฟิลเตอร์บางตัว"
      />
    );

  return (
    <NetSalesBarChart
      rows={rows}
      keys={keys}
      monthSegs={monthSegs}
      yearSegs={yearSegs}
      yMax={yMax}
      colorBy={colorBy}
      metric={metric}
    />
  );
}

interface ChartProps {
  rows: Array<RowShape & Record<string, number>>;
  keys: string[];
  metric: MetricKey;
  monthSegs: MonthSegment[];
  yearSegs: YearSegment[];
  yMax: number;
  colorBy: ColorByKey;
}

function NetSalesBarChart({
  rows,
  keys,
  monthSegs,
  yearSegs,
  yMax,
  colorBy,
  metric,
}: ChartProps) {
  const t = useChartTheme();

  // Click-to-pin: clicking a bar (or anywhere along that day's column)
  // freezes the breakdown for that day in a panel that stays put while
  // the user reads / scrolls / searches. Click another bar → switch.
  // Click the X or press Escape → close.
  const [pinnedDay, setPinnedDay] = useState<string | null>(null);
  const pinnedRow = useMemo(
    () => rows.find((r) => r.day === pinnedDay) ?? null,
    [rows, pinnedDay]
  );

  // PERF: per-segment hover updates can't go through React state (any
  // setState rebuilds the chart subtree → 13.5k SVG paths reflow).
  //
  // Approach: the Tooltip COMPUTES the focused segment on each render
  // from a captured y-scale + the live cursor Y. The cursor Y is
  // pushed into an external store on every BarChart mousemove —
  // subscribers (only the tooltip) get a re-render via
  // useSyncExternalStore, the chart subtree never rebuilds.
  const yScaleRef = useRef<((v: number) => number) | null>(null);
  const chartYStore = useMemo(() => createChartYStore(), []);
  useEffect(() => () => chartYStore.cleanup(), [chartYStore]);

  // Outer wrapper of THIS chart — used to tell "clicked inside my own
  // chart" (let the bar onClick switch days) from "clicked elsewhere"
  // (dismiss the breakdown).
  const chartWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pinnedDay) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPinnedDay(null);
    }
    // Click-away to dismiss. A pointerdown that lands outside the
    // breakdown panel AND outside this chart closes the panel. Clicks on
    // the panel keep it open (its own buttons/drag handle it); clicks
    // inside the chart are owned by the BarChart onClick, which switches
    // the breakdown to the clicked day instead of closing.
    function onPointerDown(e: PointerEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-breakdown-panel]")) return;
      if (chartWrapRef.current?.contains(target)) return;
      setPinnedDay(null);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [pinnedDay]);

  return (
    <div
      ref={chartWrapRef}
      className="flex h-full min-h-0 flex-col chart-enter relative"
    >
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            margin={{ top: 40, right: 24, left: 0, bottom: 8 }}
            // Recharts 3 sets tabindex=0 on the chart SVG when its
            // accessibilityLayer is on (the default) — that makes the SVG
            // focusable and the browser paints a focus outline on click.
            // We don't use keyboard chart navigation, so turn it off.
            accessibilityLayer={false}
            onClick={(state) => {
              // Recharts 3 dropped activePayload; MouseHandlerDataParam now
              // exposes activeIndex which we look up in the local rows array.
              const idx = (state as { activeIndex?: number | string } | null)
                ?.activeIndex;
              const i = typeof idx === "number" ? idx : Number(idx);
              if (!Number.isFinite(i)) return;
              const day = rows[i]?.day;
              if (!day) return;
              // Always SET (never toggle off) — clicking another bar should
              // just swap the data inside the existing panel, not flicker
              // it closed-then-open. Use the X button (or Escape) to close.
              setPinnedDay(day);
            }}
            onMouseMove={(state) => {
              // Recharts 3 dropped chartY; activeCoordinate.y is the closest
              // substitute we have (column-anchored, but still useful for the
              // tooltip's segment-pick logic).
              const cy = (state as {
                activeCoordinate?: { y?: number };
              } | undefined)?.activeCoordinate?.y;
              chartYStore.set(typeof cy === "number" ? cy : null);
            }}
            onMouseLeave={() => chartYStore.set(null)}
            style={{ cursor: "pointer" }}
          >
            <XAxis
              dataKey="dayOfMonth"
              tick={{ fontSize: 9, fill: t.text }}
              axisLine={{ stroke: t.axisLine }}
              tickLine={false}
              // Dynamically thin out day ticks when many months are selected
              // so labels never overlap. Always show day 1 + month-end-ish.
              interval={
                rows.length > 120
                  ? 4
                  : rows.length > 90
                  ? 3
                  : rows.length > 60
                  ? 2
                  : rows.length > 31
                  ? 1
                  : 0
              }
              minTickGap={4}
            />
            <YAxis
              tickFormatter={(v) => formatMetric(Number(v), metric)}
              tick={{ fontSize: 10, fill: t.muted }}
              width={70}
              axisLine={false}
              tickLine={false}
              domain={[0, yMax]}
            />
            <Tooltip
              cursor={<ThinSlotCursor />}
              wrapperStyle={{ outline: "none", pointerEvents: "none" }}
              isAnimationActive={false}
              content={(tooltipProps) => (
                // Recharts 3 passes TooltipContentProps at runtime — spread
                // them in so StackedTooltip gets active/payload/coordinate.
                <StackedTooltip
                  {...tooltipProps}
                  labelFormatter={(_, p) => {
                    const row = p?.[0]?.payload as RowShape | undefined;
                    return row ? row.day : "";
                  }}
                  pickFromCoord
                  yScaleRef={yScaleRef}
                  yStore={chartYStore}
                  hint="click bar for full breakdown"
                  valueFormatter={(v) => formatMetric(v, metric)}
                />
              )}
            />
            {/* Recharts renders the first <Bar> at the BOTTOM of the stack.
                For Hourly view the user wants AM at the top (= rendered last),
                PM at the bottom (= rendered first), so we iterate in reverse
                without changing how colors are looked up. */}
            {(colorBy === "hour" ? Array.from(keys).reverse() : keys).map((k) => {
              const i = keys.indexOf(k);
              return (
                <Bar
                  key={k}
                  dataKey={k}
                  stackId="a"
                  fill={colorFor(k, i)}
                  name={k}
                  isAnimationActive={false}
                />
              );
            })}

            {/* Decoration: month dividers, AVG segments, AVG labels,
                Year+Month banners, pinned-bar cursor. Recharts 3 uses a
                portal-based z-index system (default 0, Bar=300, label=2000);
                wrap in ZIndexLayer above all of those so the overlay sits
                ON TOP of the bars, not behind them. PlotOverlay itself
                uses Recharts 3 hooks to read plotArea + y-scale. */}
            <ZIndexLayer zIndex={2100}>
              <PlotOverlay
                rows={rows}
                monthSegs={monthSegs}
                yearSegs={yearSegs}
                theme={t}
                yScaleRef={yScaleRef}
                metric={metric}
                pinnedDay={pinnedDay}
              />
            </ZIndexLayer>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {pinnedRow ? (
        <PinnedDayPanel
          row={pinnedRow}
          keys={keys}
          colorBy={colorBy}
          metric={metric}
          onClose={() => setPinnedDay(null)}
        />
      ) : null}
    </div>
  );
}

/* ---------------- Pinned day breakdown panel ---------------- */

function PinnedDayPanel({
  row,
  keys,
  colorBy,
  metric,
  onClose,
}: {
  row: RowShape & Record<string, number>;
  keys: string[];
  colorBy: ColorByKey;
  metric: MetricKey;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [mounted, setMounted] = useState(false);
  // null while we're computing the initial position. Once set, the panel
  // floats freely — user can drag it anywhere in the viewport.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    pointerStartX: number;
    pointerStartY: number;
    panelStartX: number;
    panelStartY: number;
  } | null>(null);

  const PANEL_WIDTH = 300;
  const PANEL_MIN_HEIGHT = 80;

  // First mount: place the panel at the top-right of the chart card if
  // we can find one, otherwise fall back to the top-right of the viewport.
  useEffect(() => {
    if (pos) return;
    const card = document.querySelector<HTMLElement>(
      '[data-export-id="main-bar"]'
    );
    if (card) {
      const r = card.getBoundingClientRect();
      setPos({
        x: Math.max(8, r.right - PANEL_WIDTH - 12),
        y: Math.max(8, r.top + 12),
      });
    } else {
      setPos({ x: window.innerWidth - PANEL_WIDTH - 16, y: 80 });
    }
    setMounted(true);
  }, [pos]);

  // Drag handlers — track at the document level so the user can drag fast
  // and the cursor can leave the panel without losing the gesture.
  function onHeaderPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!pos) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-no-drag]")) return;

    e.preventDefault();
    dragRef.current = {
      pointerStartX: e.clientX,
      pointerStartY: e.clientY,
      panelStartX: pos.x,
      panelStartY: pos.y,
    };
    setDragging(true);
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerUp);
  }
  function onPointerMove(e: PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.pointerStartX;
    const dy = e.clientY - d.pointerStartY;
    const next = {
      x: Math.max(
        -PANEL_WIDTH + 64,
        Math.min(window.innerWidth - 64, d.panelStartX + dx)
      ),
      y: Math.max(
        0,
        Math.min(window.innerHeight - 24, d.panelStartY + dy)
      ),
    };
    setPos(next);
  }
  function onPointerUp() {
    dragRef.current = null;
    setDragging(false);
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("pointercancel", onPointerUp);
  }
  // Cleanup on unmount in case we're mid-drag.
  useEffect(() => {
    return () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build sorted item list once per row.
  const items = useMemo(() => {
    const list = keys
      .map((k, idx) => ({
        key: k,
        rank: idx,
        value: Number(row[k] ?? 0) || 0,
      }))
      .filter((x) => x.value > 0);
    if (colorBy === "hour") {
      return list.sort((a, b) => Number(a.key) - Number(b.key));
    }
    return list.sort((a, b) => b.value - a.value);
  }, [row, keys, colorBy]);

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter((x) => x.key.toLowerCase().includes(q));
  }, [items, query]);

  const total = items.reduce((s, x) => s + x.value, 0);
  const filteredTotal = filtered.reduce((s, x) => s + x.value, 0);

  if (!mounted || !pos) return null;

  const panel = (
    <div
      data-breakdown-panel
      className="flex flex-col rounded-lg overflow-hidden"
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        width: PANEL_WIDTH,
        maxHeight: "70vh",
        minHeight: PANEL_MIN_HEIGHT,
        zIndex: 1000,
        background: "var(--bg-card)",
        border: "1px solid var(--border-card)",
        boxShadow: dragging
          ? "0 18px 36px rgba(15,23,42,0.32)"
          : "0 8px 22px rgba(15,23,42,0.18)",
        userSelect: dragging ? "none" : undefined,
        transition: "none",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        onPointerDown={onHeaderPointerDown}
        className="flex items-center justify-between gap-2 px-3 py-2 shrink-0 select-none"
        style={{
          cursor: dragging ? "grabbing" : "grab",
          touchAction: "none",
          borderBottom: "1px solid var(--border-card)",
        }}
        title="Drag to reposition"
      >
        <div className="flex items-center gap-2 min-w-0">
          <DragHandleIcon />
          <div className="min-w-0">
            <div
              className="text-[9px] uppercase tracking-[0.08em] font-semibold"
              style={{ color: "var(--text-muted)" }}
            >
              Breakdown
            </div>
            <div
              className="text-xs font-semibold tabular-nums truncate"
              style={{ color: "var(--text-primary)" }}
            >
              {row.day}
            </div>
          </div>
        </div>
        <button
          type="button"
          data-no-drag
          onClick={onClose}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Close breakdown"
          className="h-6 w-6 inline-flex items-center justify-center rounded hover:bg-[var(--bg-row-hover)]"
          style={{ color: "var(--text-muted)" }}
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </button>
      </div>
      {items.length > 8 ? (
        <div
          className="px-3 py-2 shrink-0"
          style={{ borderBottom: "1px solid var(--border-card)" }}
        >
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${items.length} items…`}
            className="w-full text-[12px] rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-inset"
            style={{
              border: "1px solid var(--border-card)",
              background: "var(--bg-card)",
              color: "var(--text-primary)",
            }}
          />
        </div>
      ) : null}
      <ul className="flex-1 min-h-0 overflow-y-auto scroll-thin px-2 py-1">
        {filtered.length === 0 ? (
          <li
            className="px-2 py-2 text-[12px]"
            style={{ color: "var(--text-muted)" }}
          >
            No matches
          </li>
        ) : (
          filtered.map((x, i) => (
            <li
              key={x.key}
              className="flex items-center gap-2 px-1 py-1 text-[12px] tabular-nums rounded hover:bg-[var(--bg-row-hover)]"
            >
              <span
                className="text-[9px] w-5 shrink-0 text-right"
                style={{ color: "var(--text-muted)" }}
              >
                {i + 1}.
              </span>
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: colorFor(x.key, x.rank) }}
              />
              <span
                className="flex-1 truncate"
                style={{ color: "var(--text-primary)" }}
                title={x.key}
              >
                {x.key}
              </span>
              <span
                className="font-semibold"
                style={{ color: "var(--text-primary)" }}
              >
                {formatMetric(x.value, metric)}
              </span>
            </li>
          ))
        )}
      </ul>
      <div
        className="flex items-center justify-between px-3 py-2 text-[11px] shrink-0 gap-2"
        style={{ borderTop: "1px solid var(--border-card)" }}
      >
        <span style={{ color: "var(--text-muted)" }}>
          {query.trim()
            ? `${filtered.length} of ${items.length}`
            : `${items.length} items`}
        </span>
        <span
          className="font-bold tabular-nums"
          style={{ color: "var(--text-primary)" }}
        >
          {formatMetric(query.trim() ? filteredTotal : total, metric)}
        </span>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}

/* ---------------- Thin vertical-line cursor ---------------- */

/**
 * Custom Recharts tooltip cursor — a single 1px vertical line at the
 * active column's centre instead of the default wide rectangle.
 */
type CursorPoints = Array<{ x: number; y: number }>;
function ThinSlotCursor(props: Record<string, unknown>) {
  const points = props.points as CursorPoints | undefined;
  if (!points || points.length < 2) return null;
  const x = points[0].x;
  const y1 = Math.min(points[0].y, points[1].y);
  const y2 = Math.max(points[0].y, points[1].y);
  return (
    <line
      x1={x}
      x2={x}
      y1={y1}
      y2={y2}
      stroke="rgba(193,71,40,0.55)"
      strokeWidth={1}
      strokeDasharray="3 3"
      pointerEvents="none"
    />
  );
}

/* ---------------- External store for cursor Y ---------------- */

export interface ChartYStore {
  set(y: number | null): void;
  subscribe(l: () => void): () => void;
  getVersion(): number;
  getY(): number | null;
  cleanup(): void;
}

/**
 * Tiny external store that the BarChart writes to on every mouseMove
 * (rAF-throttled) and the Tooltip subscribes to via
 * useSyncExternalStore. Decouples cursor-Y updates from React state so
 * the chart subtree never re-renders during hover.
 */
function createChartYStore(): ChartYStore {
  let value: number | null = null;
  let version = 0;
  let pending: number | null = null;
  let pendingDirty = false;
  let rafQueued = false;
  const listeners = new Set<() => void>();

  function flush() {
    rafQueued = false;
    if (!pendingDirty) return;
    pendingDirty = false;
    const next = pending;
    if (next === null) {
      if (value !== null) {
        value = null;
        version++;
        listeners.forEach((l) => l());
      }
      return;
    }
    if (value !== null && Math.abs(value - next) < 1) return;
    value = next;
    version++;
    listeners.forEach((l) => l());
  }

  return {
    set(y) {
      pending = y;
      pendingDirty = true;
      if (rafQueued) return;
      rafQueued = true;
      requestAnimationFrame(flush);
    },
    subscribe(l) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    getVersion() {
      return version;
    },
    getY() {
      return value;
    },
    cleanup() {
      listeners.clear();
      value = null;
      version = 0;
    },
  };
}

function DragHandleIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 shrink-0"
      style={{ color: "var(--text-muted)" }}
      aria-hidden
    >
      <circle cx="5" cy="4" r="1" fill="currentColor" />
      <circle cx="5" cy="8" r="1" fill="currentColor" />
      <circle cx="5" cy="12" r="1" fill="currentColor" />
      <circle cx="11" cy="4" r="1" fill="currentColor" />
      <circle cx="11" cy="8" r="1" fill="currentColor" />
      <circle cx="11" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

/* ---------------- Plot-area overlay ---------------- */

function PlotOverlay({
  rows,
  monthSegs,
  yearSegs,
  theme,
  yScaleRef,
  metric,
  pinnedDay,
}: {
  rows: RowShape[];
  monthSegs: MonthSegment[];
  yearSegs: YearSegment[];
  theme: ReturnType<typeof useChartTheme>;
  yScaleRef?: React.MutableRefObject<((v: number) => number) | null>;
  metric: MetricKey;
  pinnedDay: string | null;
}) {
  // Recharts 3 stopped passing chart state through <Customized> props;
  // hooks are the supported way to read the plot area + scales.
  const plotArea = usePlotArea();
  const yScale = useYAxisScale();
  if (!plotArea || !yScale) return null;
  // Expose the y-scale to the Tooltip so it can map cursor.y back to a
  // stack value and pick the focused segment on each render. Wrap so
  // callers can still treat it as (v: number) => number.
  if (yScaleRef) {
    yScaleRef.current = (v: number) => yScale(v) ?? 0;
  }

  const plotLeft = plotArea.x;
  const plotTop = plotArea.y;
  const plotWidth = plotArea.width;
  const plotBottom = plotArea.y + plotArea.height;
  const slot = plotWidth / Math.max(rows.length, 1);

  function bandRange(startIdx: number, endIdx: number) {
    const left = plotLeft + startIdx * slot;
    const right = plotLeft + (endIdx + 1) * slot;
    return { left, right, center: (left + right) / 2 };
  }

  // Headers live in the margin ABOVE the plot area.
  const yearY = plotTop - 22;
  const monthY = plotTop - 6;

  return (
    <g pointerEvents="none">
      {/* Vertical dividers at month boundaries */}
      {monthSegs.slice(1).map((seg) => {
        const x = plotLeft + seg.startIdx * slot;
        return (
          <line
            key={`div-${seg.ym}`}
            x1={x}
            x2={x}
            y1={plotTop}
            y2={plotBottom}
            stroke={theme.divider}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        );
      })}

      {/* Per-month AVG line + label. Skipped for the Ticket Average
          view — `seg.avg` there would be "average of summed ticket-
          averages across channels", which has no meaningful business
          interpretation. */}
      {metric !== "ticketAvg" &&
        monthSegs.map((seg) => {
          const { left, right, center } = bandRange(seg.startIdx, seg.endIdx);
          const yRaw = yScale(seg.avg);
          if (yRaw == null || !Number.isFinite(yRaw)) return null;
          const y = yRaw;
          const labelAbove = y > plotTop + 14;
          const labelY = labelAbove ? y - 4 : y + 11;
          return (
            <g key={`avg-${seg.ym}`}>
              <line
                x1={left + 2}
                x2={right - 2}
                y1={y}
                y2={y}
                stroke={theme.avgLine}
                strokeWidth={1.25}
                strokeDasharray="6 4"
              />
              <text
                x={center}
                y={labelY}
                textAnchor="middle"
                fontSize={9}
                fontWeight={700}
                fill={theme.avgLabel}
                style={{
                  paintOrder: "stroke",
                  stroke: theme.avgLabelHalo,
                  strokeWidth: 3,
                }}
              >
                AVG = {formatMetric(seg.avg, metric)}
              </text>
            </g>
          );
        })}

      {/* Year banner */}
      {yearSegs.map((seg) => {
        const { left, right, center } = bandRange(seg.startIdx, seg.endIdx);
        return (
          <g key={`y-${seg.year}`}>
            <line
              x1={left + 4}
              x2={right - 4}
              y1={yearY + 4}
              y2={yearY + 4}
              stroke={theme.axisLine}
              strokeWidth={1}
            />
            <text
              x={center}
              y={yearY}
              textAnchor="middle"
              fontSize={11}
              fontWeight={700}
              fill={theme.text}
            >
              {seg.year}
            </text>
          </g>
        );
      })}

      {/* Month banner */}
      {monthSegs.map((seg) => {
        const { left, right, center } = bandRange(seg.startIdx, seg.endIdx);
        return (
          <g key={`m-${seg.ym}`}>
            <line
              x1={left + 4}
              x2={right - 4}
              y1={monthY + 4}
              y2={monthY + 4}
              stroke={theme.divider}
              strokeWidth={1}
            />
            <text
              x={center}
              y={monthY}
              textAnchor="middle"
              fontSize={10}
              fontWeight={600}
              fill={theme.text}
            >
              {MONTHS_SHORT[seg.month - 1]}
            </text>
          </g>
        );
      })}

      {/* Pinned-day cursor — persistent vertical line that marks the bar
          whose breakdown panel is currently open. Mirrors the hover
          ThinSlotCursor (1px dashed) but in the AVG-line accent colour so
          it reads as "selected" rather than "hovering". */}
      {(() => {
        if (!pinnedDay) return null;
        const idx = rows.findIndex((r) => r.day === pinnedDay);
        if (idx < 0) return null;
        const x = plotLeft + (idx + 0.5) * slot;
        return (
          <line
            x1={x}
            x2={x}
            y1={plotTop}
            y2={plotBottom}
            stroke="rgba(193,71,40,0.9)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            pointerEvents="none"
          />
        );
      })()}
    </g>
  );
}
