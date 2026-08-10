"use client";

import React, { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { useMasterFilters } from "@/features/intelligence/master/hooks/useMasterFilters";
import { useMasterData } from "@/features/intelligence/master/hooks/useMasterData";
import { useChartTheme } from "@/features/intelligence/master/hooks/useChartTheme";
import { ByStoreRow } from "@/features/intelligence/master/types";
import { formatTHB } from "@/features/intelligence/master/lib/format";
import { colorFor } from "@/features/intelligence/master/lib/palette";
import { ChartEmpty, ChartError, ChartSkeleton } from "./ChartState";
import { StackedTooltip } from "./StackedTooltip";

const Y_AXIS_WIDTH = 200;
const Y_TICK_MAX_CHARS = 28;

/** Single-line Y-axis label that truncates with ellipsis when too long.
 *  Hovering the label shows the full branch name via SVG <title>. */
function SingleLineTick(props: {
  x?: number;
  y?: number;
  payload?: { value: string };
  fill?: string;
}) {
  const x = props.x ?? 0;
  const y = props.y ?? 0;
  const name = String(props.payload?.value ?? "");
  const display =
    name.length > Y_TICK_MAX_CHARS
      ? `${name.slice(0, Y_TICK_MAX_CHARS - 1)}…`
      : name;
  return (
    <text
      x={x - 4}
      y={y}
      dy={3}
      textAnchor="end"
      fontSize={9}
      fill={props.fill ?? "#334155"}
    >
      <title>{name}</title>
      {display}
    </text>
  );
}

/** X-axis value tick. Edge-aware text-anchor keeps the first/last numbers
 *  inside the plot (the rightmost label used to overflow the card edge).
 *  Size + tabular-nums match the main chart's money axis so the numbers
 *  read as the same family across the dashboard. */
function ValueTick(props: {
  x?: number;
  y?: number;
  payload?: { value: number };
  index?: number;
  visibleTicksCount?: number;
  fill?: string;
}) {
  const x = props.x ?? 0;
  const y = props.y ?? 0;
  const idx = props.index ?? 0;
  const last = (props.visibleTicksCount ?? 1) - 1;
  const anchor = idx === 0 ? "start" : idx >= last ? "end" : "middle";
  return (
    <text
      x={x}
      y={y}
      dy={10}
      textAnchor={anchor}
      fontSize={10}
      fill={props.fill ?? "#64748b"}
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {formatTHB(Number(props.payload?.value))}
    </text>
  );
}

/**
 * Net Sales by Store — horizontal stacked bar chart.
 *   Y axis  = branch_name (sorted by total netSales desc)
 *   X axis  = NetSalse (THB)
 *   stacks  = order_type (Delivery / Dine-In / Take Away)
 *
 * Data: /api/intelligence/dashboards/master/by-store
 * returns one row per (branch × order_type).
 */
export function NetSalesByStore({ brand }: { brand: string }) {
  const { queryString } = useMasterFilters();
  const apiQs = queryString
    ? `${queryString}&brand=${brand}`
    : `?brand=${brand}`;
  const { data, isLoading, error } = useMasterData<ByStoreRow[]>(
    "/api/intelligence/dashboards/master/by-store",
    apiQs
  );

  const { rows, keys } = useMemo(() => {
    // Pivot rows: one record per branch with each order_type as a numeric key.
    const byBranch = new Map<
      string,
      Record<string, number | string> & { branch_name: string; total: number }
    >();
    const typesSet = new Set<string>();
    for (const r of data ?? []) {
      typesSet.add(r.order_type);
      const existing = byBranch.get(r.branch_name);
      if (existing) {
        existing[r.order_type] =
          (Number(existing[r.order_type] ?? 0) || 0) + r.netSales;
        existing.total += r.netSales;
      } else {
        byBranch.set(r.branch_name, {
          branch_name: r.branch_name,
          total: r.netSales,
          [r.order_type]: r.netSales,
        });
      }
    }
    const rows = Array.from(byBranch.values()).sort((a, b) => b.total - a.total);

    // Stable order for canonical sale modes; push others (e.g. "(blank)") last.
    const PRIORITY = ["Delivery", "Dine-In", "Take Away"];
    const keys = Array.from(typesSet).sort((a, b) => {
      const ai = PRIORITY.indexOf(a);
      const bi = PRIORITY.indexOf(b);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      return a.localeCompare(b);
    });
    return { rows, keys };
  }, [data]);

  if (error) return <ChartError message={error.message} />;
  if (isLoading || !data) return <ChartSkeleton />;
  if (rows.length === 0)
    return <ChartEmpty icon="🏪" title="No stores match the filters" />;

  // Entire view — fills the card box top-to-bottom; bars compress as needed.
  return <NetSalesByStoreChart rows={rows} keys={keys} />;
}

function NetSalesByStoreChart({
  rows,
  keys,
}: {
  rows: Array<Record<string, number | string> & { branch_name: string; total: number }>;
  keys: string[];
}) {
  const t = useChartTheme();
  return (
    <div className="chart-enter w-full h-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
          barCategoryGap={4}
          // See NetSalesBar — disables the focusable SVG that paints a
          // browser focus outline on click.
          accessibilityLayer={false}
        >
          <CartesianGrid
            horizontal={false}
            strokeDasharray="2 2"
            stroke={t.grid}
          />
          <XAxis
            type="number"
            tick={(props) => <ValueTick {...(props as Parameters<typeof ValueTick>[0])} fill={t.muted} />}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            dataKey="branch_name"
            type="category"
            width={Y_AXIS_WIDTH}
            axisLine={false}
            tickLine={false}
            tick={(props) => <SingleLineTick {...(props as Parameters<typeof SingleLineTick>[0])} fill={t.text} />}
            interval={0}
          />
          <Tooltip
            cursor={{ fill: t.cursorFill }}
            wrapperStyle={{ outline: "none" }}
            content={(tooltipProps) => (
              // Recharts 3 passes TooltipContentProps at runtime — spread
              // them in so StackedTooltip gets active/payload/coordinate.
              <StackedTooltip
                {...tooltipProps}
                labelFormatter={(label) => String(label ?? "")}
              />
            )}
          />
          <Legend
            wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
            iconType="square"
            iconSize={8}
          />
          {keys.map((k, i) => (
            <Bar
              key={k}
              dataKey={k}
              stackId="a"
              fill={colorFor(k, i)}
              name={k}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
