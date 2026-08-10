"use client";

import { memo, useSyncExternalStore } from "react";
import type { TooltipContentProps } from "recharts";
import type {
  NameType,
  ValueType,
} from "recharts/types/component/DefaultTooltipContent";
import { useChartTheme } from "@/features/intelligence/master/hooks/useChartTheme";
import { formatTHB } from "@/features/intelligence/master/lib/format";

// Noop store handles for useSyncExternalStore when the caller didn't
// provide an external store — keeps the hook order stable between
// callers that DO pass a store and callers that don't.
const noopSubscribe = () => () => {};
const noopGetVersion = () => 0;

/**
 * Tooltip content with a colored legend swatch per item, sorted largest first.
 * Matches the bar/legend color so the user can read which segment is which.
 */
function StackedTooltipImpl({
  active,
  payload,
  label,
  coordinate,
  labelFormatter,
  keyOrder,
  showShareOfTotal,
  focusKey,
  hint,
  summaryOnly,
  pickFromCoord,
  yScaleRef,
  yStore,
  valueFormatter,
}: TooltipContentProps<ValueType, NameType> & {
  labelFormatter?: (
    label: unknown,
    payload: TooltipContentProps<ValueType, NameType>["payload"]
  ) => string;
  /** Optional explicit ordering of dataKeys (top → bottom). If provided,
   *  items are sorted to follow this order; missing keys are dropped from
   *  the tooltip. Useful for the Hourly view where AM should appear above PM. */
  keyOrder?: string[];
  /** Render a single item with `value` + share-of-day context. Used by
   *  views that prefer to show only the segment under the cursor. */
  showShareOfTotal?: boolean;
  /** When set, the tooltip narrows the multi-item payload down to JUST
   *  this dataKey/name and renders the single-item view. Lets us keep
   *  Recharts' axis-anchored shared tooltip (no flicker between days)
   *  while still focusing on a specific stack segment. */
  focusKey?: string | null;
  /** Optional small italic line shown at the bottom of the tooltip —
   *  e.g. "click bar for full breakdown". */
  hint?: string;
  /** Render only the column total + dim count (no per-item rows). Used
   *  by high-cardinality charts where listing every segment is both
   *  visually overwhelming and a perf killer during fast hover. */
  summaryOnly?: boolean;
  /** Pick the segment under the cursor by mapping the cursor Y →
   *  stack value via the Recharts y-scale captured in `yScaleRef`. No
   *  React state required — works for high-cardinality stacks without
   *  triggering chart re-renders. */
  pickFromCoord?: boolean;
  yScaleRef?: React.MutableRefObject<((v: number) => number) | null>;
  /** External store fed by the chart's onMouseMove. Subscribing via
   *  useSyncExternalStore makes the tooltip refresh on every cursor
   *  move (including up/down within the same column) without putting
   *  cursor state into React. */
  yStore?: {
    set(y: number | null): void;
    subscribe(l: () => void): () => void;
    getVersion(): number;
    getY(): number | null;
  };
  /** Override how each value is rendered. Defaults to formatTHB so
   *  net-sales charts keep working unchanged; ticket-count views pass
   *  in a plain integer formatter instead. */
  valueFormatter?: (v: number) => string;
}) {
  const t = useChartTheme();
  // Subscribe to the chart's cursor-Y store so the tooltip re-renders
  // when the user moves the mouse up/down within the same column.
  // useSyncExternalStore is a no-op when the chart didn't pass a store.
  useSyncExternalStore(
    yStore ? yStore.subscribe : noopSubscribe,
    yStore ? yStore.getVersion : noopGetVersion,
    noopGetVersion
  );
  if (!active || !payload || payload.length === 0) return null;
  const fmt = valueFormatter ?? formatTHB;

  const headerLabel = labelFormatter
    ? labelFormatter(label, payload)
    : String(label ?? "");

  // ── pickFromCoord: per-segment without React state ──────────────
  // Walk the payload bottom-up, accumulating values. The y-scale maps
  // values to chart pixels; the segment whose pixel band contains the
  // cursor Y is the one under the cursor.
  //
  // We prefer `yStore.getY()` (live cursor, updated on every chart
  // mousemove) over Recharts' `coordinate.y` because the latter is
  // anchored to the column and DOESN'T refresh as the user moves up
  // or down within the same column — the symptom user reported.
  if (pickFromCoord) {
    const liveY = yStore ? yStore.getY() : null;
    const my = liveY ?? (typeof coordinate?.y === "number" ? coordinate.y : null);
    const yScale = yScaleRef?.current;
    if (yScale && my != null) {
      let cumulative = 0;
      let totalAll = 0;
      let focused: (typeof payload)[number] | null = null;
      for (const p of payload) {
        const v = Number(p.value) || 0;
        if (v <= 0) continue;
        const yTop = yScale(cumulative + v);
        const yBottom = yScale(cumulative);
        if (!focused && my >= yTop && my <= yBottom) {
          focused = p;
        }
        cumulative += v;
        totalAll += v;
      }
      if (focused) {
        const value = Number(focused.value) || 0;
        const pct = totalAll > 0 ? (value / totalAll) * 100 : 0;
        return (
          <div
            style={{
              background: t.tooltipBg,
              border: `1px solid ${t.tooltipBorder}`,
              borderRadius: 6,
              padding: "6px 8px",
              fontSize: 11,
              color: t.text,
              boxShadow: "0 4px 12px rgba(0,0,0,0.10)",
              minWidth: 200,
              maxWidth: 320,
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                color: t.muted,
                fontSize: 10,
                marginBottom: 4,
                fontWeight: 600,
              }}
            >
              {headerLabel}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                lineHeight: 1.3,
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: String(focused.color ?? "#94a3b8"),
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  color: t.text,
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontWeight: 600,
                }}
                title={String(focused.name ?? focused.dataKey)}
              >
                {String(focused.name ?? focused.dataKey)}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 8,
                marginTop: 3,
              }}
            >
              <span
                style={{
                  color: t.text,
                  fontSize: 13,
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {fmt(value)}
              </span>
              <span
                style={{
                  color: t.muted,
                  fontSize: 10,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {pct.toFixed(1)}% of day
              </span>
            </div>
            {hint ? (
              <div
                style={{
                  marginTop: 4,
                  paddingTop: 4,
                  borderTop: `1px solid ${t.tooltipBorder}`,
                  color: t.muted,
                  fontSize: 9,
                  textAlign: "center",
                  fontStyle: "italic",
                }}
              >
                {hint}
              </div>
            ) : null}
          </div>
        );
      }
      // No segment under the cursor (e.g. above the bar's top) — fall
      // through to summary so the user still sees something.
    }
  }

  // ── Summary-only fast path ──────────────────────────────────────
  // Single reduce() over payload, no per-item DOM, no allocations.
  // Used as a fallback when pickFromCoord can't resolve a segment
  // (cursor outside the bar's painted region).
  if (summaryOnly || pickFromCoord) {
    let total = 0;
    let count = 0;
    for (const p of payload) {
      const v = Number(p.value);
      if (v > 0) {
        total += v;
        count++;
      }
    }
    if (count === 0) return null;
    return (
      <div
        style={{
          background: t.tooltipBg,
          border: `1px solid ${t.tooltipBorder}`,
          borderRadius: 6,
          padding: "6px 8px",
          fontSize: 11,
          color: t.text,
          boxShadow: "0 4px 12px rgba(0,0,0,0.10)",
          minWidth: 180,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            color: t.muted,
            fontSize: 10,
            marginBottom: 4,
            fontWeight: 600,
          }}
        >
          {headerLabel}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 8,
          }}
        >
          <span style={{ color: t.muted, fontSize: 10 }}>
            {count} {count === 1 ? "item" : "items"}
          </span>
          <span
            style={{
              color: t.text,
              fontSize: 14,
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {fmt(total)}
          </span>
        </div>
        {hint ? (
          <div
            style={{
              marginTop: 4,
              paddingTop: 4,
              borderTop: `1px solid ${t.tooltipBorder}`,
              color: t.muted,
              fontSize: 9,
              textAlign: "center",
              fontStyle: "italic",
            }}
          >
            {hint}
          </div>
        ) : null}
      </div>
    );
  }

  // ── Single-item fast path ───────────────────────────────────────
  // For high-cardinality stacks (Item Name with 100+ menus) we ONLY
  // ever render the segment under the cursor. We must not iterate /
  // sort the full payload on every frame because Recharts re-renders
  // the tooltip on every mouse move — sorting 200+ items per frame
  // is what was making hover lag.
  //
  // We do at most TWO linear scans:
  //   1) find the focused item by dataKey
  //   2) if it's missing or zero in this column, fall back to the
  //      first non-zero entry (typically the largest segment).
  if (showShareOfTotal) {
    let single: (typeof payload)[number] | undefined;
    if (focusKey) {
      const k = String(focusKey);
      single = payload.find(
        (p) => String(p.dataKey ?? p.name ?? "") === k
      );
    }
    if (!single || !(Number(single.value) > 0)) {
      single = payload.find((p) => Number(p.value) > 0);
    }
    if (!single) return null;
    const value = Number(single.value) || 0;
    const rowPayload = (single.payload ?? {}) as { total?: number };
    const rowTotal = Number(rowPayload.total) || value;
    const pct = rowTotal > 0 ? (value / rowTotal) * 100 : 0;
    return (
      <div
        style={{
          background: t.tooltipBg,
          border: `1px solid ${t.tooltipBorder}`,
          borderRadius: 6,
          padding: "6px 8px",
          fontSize: 11,
          color: t.text,
          boxShadow: "0 4px 12px rgba(0,0,0,0.10)",
          minWidth: 180,
          maxWidth: 320,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            color: t.muted,
            fontSize: 10,
            marginBottom: 4,
            fontWeight: 600,
          }}
        >
          {headerLabel}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            lineHeight: 1.3,
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              borderRadius: 2,
              background: String(single.color ?? "#94a3b8"),
              flexShrink: 0,
            }}
          />
          <span
            style={{
              color: t.text,
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontWeight: 600,
            }}
            title={String(single.name ?? single.dataKey)}
          >
            {String(single.name ?? single.dataKey)}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 8,
            marginTop: 3,
          }}
        >
          <span
            style={{
              color: t.text,
              fontSize: 13,
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {fmt(value)}
          </span>
          <span
            style={{
              color: t.muted,
              fontSize: 10,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {pct.toFixed(1)}% of day
          </span>
        </div>
        {hint ? (
          <div
            style={{
              marginTop: 4,
              paddingTop: 4,
              borderTop: `1px solid ${t.tooltipBorder}`,
              color: t.muted,
              fontSize: 9,
              textAlign: "center",
              fontStyle: "italic",
            }}
          >
            {hint}
          </div>
        ) : null}
      </div>
    );
  }

  // ── Multi-item mode (only used by callers WITHOUT showShareOfTotal,
  // e.g. NetSalesByStore which has just 3 stack keys — no perf concern).
  const nonzero = payload.filter(
    (p) => typeof p.value === "number" && (p.value as number) > 0
  );
  let items: typeof nonzero;
  if (keyOrder && keyOrder.length > 0) {
    const rank = new Map(keyOrder.map((k, i) => [String(k), i]));
    items = nonzero
      .filter((p) => rank.has(String(p.dataKey ?? p.name ?? "")))
      .sort(
        (a, b) =>
          (rank.get(String(a.dataKey ?? a.name ?? "")) ?? 0) -
          (rank.get(String(b.dataKey ?? b.name ?? "")) ?? 0)
      );
  } else {
    items = [...nonzero].sort(
      (a, b) => (Number(b.value) || 0) - (Number(a.value) || 0)
    );
  }
  if (items.length === 0) return null;
  const total = items.reduce((s, p) => s + (Number(p.value) || 0), 0);
  const ROW_CAP = 14;
  const visibleItems = items.slice(0, ROW_CAP);
  const hiddenItems = items.slice(ROW_CAP);

  return (
    <div
      style={{
        background: t.tooltipBg,
        border: `1px solid ${t.tooltipBorder}`,
        borderRadius: 6,
        padding: "6px 8px",
        fontSize: 11,
        color: t.text,
        boxShadow: "0 4px 12px rgba(0,0,0,0.10)",
        minWidth: 220,
        maxWidth: 320,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          color: t.muted,
          fontSize: 10,
          marginBottom: 4,
          fontWeight: 600,
        }}
      >
        {headerLabel}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {visibleItems.map((p, i) => (
          <div
            key={`${p.dataKey ?? p.name ?? i}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              lineHeight: 1.3,
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: 2,
                background: String(p.color ?? "#94a3b8"),
                flexShrink: 0,
              }}
            />
            <span
              style={{
                color: t.text,
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={String(p.name ?? p.dataKey)}
            >
              {String(p.name ?? p.dataKey)}
            </span>
            <span
              style={{
                color: t.text,
                fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {fmt(Number(p.value))}
            </span>
          </div>
        ))}
        {hiddenItems.length > 0 && (
          <div
            style={{
              marginTop: 2,
              padding: "3px 6px",
              borderRadius: 4,
              background: "rgba(193,71,40,0.10)",
              color: t.text,
              fontSize: 10,
              fontWeight: 600,
              textAlign: "center",
            }}
          >
            + {hiddenItems.length} more · click bar for full breakdown
          </div>
        )}
      </div>
      {items.length > 1 && (
        <div
          style={{
            marginTop: 4,
            paddingTop: 4,
            borderTop: `1px solid ${t.tooltipBorder}`,
            display: "flex",
            justifyContent: "space-between",
            color: t.muted,
            fontSize: 10,
          }}
        >
          <span>
            Total ({items.length}
            {items.length === 1 ? " item" : " items"})
          </span>
          <span
            style={{
              color: t.text,
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {fmt(total)}
          </span>
        </div>
      )}
    </div>
  );
}

// Recharts re-renders the tooltip on every mouse move (and rebuilds the
// payload array reference each time), so the default React.memo would
// always see prop changes. We only re-render when the values that
// actually drive the visible output change: focusKey, label, and the
// payload's length / first key. This skips ~80% of the work during
// fast hover sweeps in high-cardinality views.
export const StackedTooltip = memo(StackedTooltipImpl, (prev, next) => {
  if (prev.active !== next.active) return false;
  if (prev.label !== next.label) return false;
  if (prev.focusKey !== next.focusKey) return false;
  if (prev.hint !== next.hint) return false;
  if (prev.summaryOnly !== next.summaryOnly) return false;
  if (prev.pickFromCoord !== next.pickFromCoord) return false;
  // For pickFromCoord we depend on coordinate.y to decide which
  // segment to show — re-render when it changes by more than ~1px so
  // the user sees the legend update as they sweep up/down a column,
  // without churning on sub-pixel mouse jitter.
  if (prev.pickFromCoord) {
    const py = prev.coordinate?.y ?? -1;
    const ny = next.coordinate?.y ?? -1;
    if (Math.abs(py - ny) > 1) return false;
  }
  const a = prev.payload ?? [];
  const b = next.payload ?? [];
  if (a.length !== b.length) return false;
  // Cheap fingerprint: dataKey of the first item is enough to detect
  // when Recharts has switched to a different column.
  const aKey = a[0]?.dataKey;
  const bKey = b[0]?.dataKey;
  if (aKey !== bKey) return false;
  return true;
});
