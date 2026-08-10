"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMasterFilters } from "@/features/intelligence/master/hooks/useMasterFilters";
import { useDistincts } from "@/features/intelligence/master/hooks/useDistincts";
import { downloadAs, estimateBudget, formatBytes, Row } from "@/features/intelligence/master/lib/exporters";
import { todayStamp } from "@/features/intelligence/master/lib/csv";
import { FieldPicker } from "@/features/intelligence/master/components/export/FieldPicker";
import { TopProgressBar } from "@/features/intelligence/master/components/export/TopProgressBar";
import { PeriodPicker } from "@/features/intelligence/master/components/export/PeriodPicker";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  defaultDropAnimationSideEffects,
  type DragEndEvent,
  type DragStartEvent,
  type DropAnimation,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const ALL_FIELDS = [
  "Id",
  "branch_id",
  "branch_name",
  "order_datetime",
  "time",
  "unique_order_code",
  "receipt_no",
  "inv_no",
  "cash_drawer_code",
  "menu_code",
  "menu_name",
  "category",
  "order_type",
  "channel",
  "quantity_num",
  "price_num",
  "total_price",
  "discount_value",
  "discounted_price",
  "payment_type",
  "payment_channel",
  "payment_channel_original",
  "custompay_name",
  "bill_open_by",
  "bill_close_by",
  "CreatedAt",
  "payment_id",
  "void_flag",
  "is_revenue",
];

type PreviewLimit = number;
const PREVIEW_OPTIONS: Array<{ label: string; value: PreviewLimit }> = [
  { label: "25", value: 25 },
  { label: "50", value: 50 },
  { label: "100", value: 100 },
  { label: "1,000", value: 1000 },
  { label: "10,000", value: 10000 },
];
const SLOW_PREVIEW_THRESHOLD = 1000;

const COL_WIDTHS: Record<string, number> = {
  Id: 80,
  branch_id: 100,
  branch_name: 200,
  order_datetime: 150,
  time: 80,
  unique_order_code: 140,
  receipt_no: 120,
  inv_no: 130,
  cash_drawer_code: 130,
  menu_code: 110,
  menu_name: 200,
  category: 140,
  order_type: 110,
  channel: 110,
  quantity_num: 90,
  price_num: 100,
  total_price: 120,
  discount_value: 130,
  discounted_price: 140,
  payment_type: 130,
  payment_channel: 140,
  payment_channel_original: 170,
  custompay_name: 140,
  bill_open_by: 130,
  bill_close_by: 130,
  CreatedAt: 150,
  payment_id: 110,
  void_flag: 90,
  is_revenue: 100,
};
const DEFAULT_COL_WIDTH = 120;
function colWidth(f: string): number {
  return COL_WIDTHS[f] ?? DEFAULT_COL_WIDTH;
}

interface Props {
  brand: string;
  onClose: () => void;
}

export function FullDataTab({ brand, onClose }: Props) {
  const { queryString, filters } = useMasterFilters();

  const [scope, setScope] = useState<"filtered" | "all">("filtered");
  const [format, setFormat] = useState<"csv" | "xlsx">("csv");
  const [period, setPeriod] = useState<"monthly" | "weekly" | "daily">(
    "monthly"
  );
  const [selectedMonths, setSelectedMonths] = useState<string[]>(
    () => filters.ym ?? []
  );
  const [weeks, setWeeks] = useState<string[]>([]);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);

  // Months the picker should expose — data-backed distinct values.
  const ymDistincts = useDistincts(brand, "ym");
  const monthsForPicker = useMemo(
    () => (ymDistincts.options ?? []),
    [ymDistincts.options]
  );

  const [userOrder, setUserOrder] = useState<string[]>(() => Array.from(ALL_FIELDS));
  const [selectedSet, setSelectedSet] = useState<Set<string>>(
    () => new Set(ALL_FIELDS)
  );
  const fields = useMemo(
    () => userOrder.filter((f) => selectedSet.has(f)),
    [userOrder, selectedSet]
  );
  const fieldsForPicker = useMemo(
    () => userOrder.filter((f) => selectedSet.has(f)),
    [userOrder, selectedSet]
  );

  function onPickerChange(next: string[]) {
    setSelectedSet(new Set(next));
  }

  function resetFieldOrder() {
    setUserOrder(Array.from(ALL_FIELDS));
    setSelectedSet(new Set(ALL_FIELDS));
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const [activeId, setActiveId] = useState<string | null>(null);

  function reorderFields(fromField: string, toField: string) {
    if (fromField === toField) return;
    const remaining = userOrder.filter((f) => f !== fromField);
    const targetIdx = remaining.indexOf(toField);
    if (targetIdx === -1) {
      remaining.push(fromField);
    } else {
      const fromIdxInFields = fields.indexOf(fromField);
      const toIdxInFields = fields.indexOf(toField);
      const insertAt =
        fromIdxInFields < toIdxInFields ? targetIdx + 1 : targetIdx;
      remaining.splice(insertAt, 0, fromField);
    }
    setUserOrder(remaining);
  }

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }
  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    reorderFields(String(active.id), String(over.id));
  }
  function handleDragCancel() {
    setActiveId(null);
  }

  const [previewLimit, setPreviewLimit] = useState<PreviewLimit>(50);
  const resolvedPreviewLimit = previewLimit;
  const [count, setCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);
  const [countError, setCountError] = useState<string | null>(null);

  const [preview, setPreview] = useState<Row[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [displayedProgress, setDisplayedProgress] = useState(0);
  const [downloadPhase, setDownloadPhase] = useState<string>("");

  const targetRef = useRef(0);
  targetRef.current = downloadProgress;
  useEffect(() => {
    if (!downloading) {
      setDisplayedProgress(0);
      return;
    }
    let rafId = 0;
    let lastTime = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      setDisplayedProgress((prev) => {
        const target = targetRef.current;
        const diff = target - prev;
        if (diff <= 0.0005) return target;
        const step = diff * 3.5 * dt + 0.04 * dt;
        return Math.min(prev + step, target);
      });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [downloading]);

  const fieldsKey = useMemo(() => fields.join("|"), [fields]);

  // Build the export's URL query string.
  const apiQs = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set("brand", brand);
    sp.set("scope", scope);
    sp.set("cols", fields.join(","));
    if (scope === "filtered" && queryString.length > 1) {
      const inner = new URLSearchParams(queryString.slice(1));
      inner.forEach((v, k) => {
        if (k === "ym") return; // overridden by PeriodPicker selection
        sp.append(k, v);
      });
    }
    if (period === "monthly" && selectedMonths.length > 0) {
      for (const m of selectedMonths) sp.append("ym", m);
    } else if (period === "weekly" && weeks.length > 0) {
      sp.set("period", "weekly");
      sp.set("weeks", weeks.join(","));
    } else if (period === "daily" && selectedDays.length > 0) {
      sp.set("period", "daily");
      sp.set("days", selectedDays.join(","));
    } else if (period === "daily" && selectedDays.length === 0) {
      sp.set("period", "daily");
    } else if (period === "weekly" && weeks.length === 0) {
      sp.set("period", "weekly");
    }
    return `?${sp.toString()}`;
  }, [brand, scope, fields, queryString, period, selectedMonths, weeks, selectedDays]);

  const countQs = useMemo(() => {
    const sp = new URLSearchParams();
    sp.set("brand", brand);
    sp.set("scope", scope);
    if (scope === "filtered" && queryString.length > 1) {
      const inner = new URLSearchParams(queryString.slice(1));
      inner.forEach((v, k) => {
        if (k === "ym") return;
        sp.append(k, v);
      });
    }
    if (period === "monthly" && selectedMonths.length > 0) {
      for (const m of selectedMonths) sp.append("ym", m);
    } else if (period === "weekly" && weeks.length > 0) {
      sp.set("period", "weekly");
      sp.set("weeks", weeks.join(","));
    } else if (period === "daily" && selectedDays.length > 0) {
      sp.set("period", "daily");
      sp.set("days", selectedDays.join(","));
    } else if (period === "daily" && selectedDays.length === 0) {
      sp.set("period", "daily");
    } else if (period === "weekly" && weeks.length === 0) {
      sp.set("period", "weekly");
    }
    return `?${sp.toString()}`;
  }, [brand, scope, queryString, period, selectedMonths, weeks, selectedDays]);

  // Row count — depends only on scope + filters.
  // Route returns { ok: true, data: { count: number } } — unwrap envelope.
  useEffect(() => {
    let cancelled = false;
    setCountLoading(true);
    setCountError(null);
    fetch(`/api/intelligence/dashboards/master/full-data/count${countQs}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json() as Promise<{ ok: boolean; data: { count: number } }>;
      })
      .then((j) => {
        if (cancelled) return;
        setCount(j.data.count);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setCountError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setCountLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [countQs]);

  // Preview rows — streaming endpoint returns JSON bytes directly (no envelope).
  useEffect(() => {
    if (fields.length === 0) {
      setPreview([]);
      setPreviewLoading(false);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreview(null);
    setPreviewError(null);

    const sp = new URLSearchParams(apiQs.slice(1));
    sp.set("limit", String(resolvedPreviewLimit));

    fetch(`/api/intelligence/dashboards/master/full-data?${sp.toString()}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json() as Promise<Row[]>;
      })
      .then((rows) => {
        if (cancelled) return;
        setPreview(rows);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setPreviewError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [apiQs, resolvedPreviewLimit, fields.length]);

  const budget = useMemo(
    () => estimateBudget(count ?? 0, fields.length || 1),
    [count, fields.length]
  );

  async function download() {
    if (!count || count === 0) return;
    setDownloading(true);
    setDownloadProgress(0);
    setDownloadPhase("Connecting…");
    try {
      const sp = new URLSearchParams(apiQs.slice(1));
      sp.set("limit", "1000000");
      const res = await fetch(
        `/api/intelligence/dashboards/master/full-data?${sp.toString()}`
      );
      if (!res.ok) throw new Error(await res.text());

      const NETWORK_CAP = 0.78;
      const PARSE_CAP = 0.92;
      const BUILD_CAP = 0.99;

      const contentLength = Number(res.headers.get("Content-Length") ?? "");
      const estimatedTotal =
        contentLength > 0
          ? contentLength
          : Math.max(1, count * fields.length * 9);

      setDownloadPhase("Downloading…");

      const periodSlug =
        scope === "filtered" && period === "weekly" && weeks.length > 0
          ? `weekly-${weeks.length}wk`
          : scope === "filtered" &&
              period === "daily" &&
              selectedDays.length > 0
            ? `daily-${selectedDays.length}d`
            : scope;

      const reader = res.body?.getReader();
      if (!reader) {
        const text = await res.text();
        setDownloadProgress(NETWORK_CAP);
        await yieldFrame();
        setDownloadPhase("Parsing…");
        const rows = JSON.parse(text) as Row[];
        setDownloadProgress(PARSE_CAP);
        await yieldFrame();
        setDownloadPhase(`Building ${format.toUpperCase()}…`);
        const stamp = todayStamp();
        const filename = `master-full-data-${brand.toLowerCase()}-${periodSlug}-${stamp}.${format}`;
        await downloadAs(format, filename, rows, fields);
        setDownloadProgress(1);
        return;
      }

      const chunks: Uint8Array[] = [];
      let received = 0;
      let lastUiPaint = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        chunks.push(value);
        received += value.length;
        const networkPct = Math.min(received / estimatedTotal, 1);
        const overall = networkPct * NETWORK_CAP;
        const now = performance.now();
        if (now - lastUiPaint > 33) {
          setDownloadProgress(overall);
          lastUiPaint = now;
        }
      }
      setDownloadProgress(NETWORK_CAP);
      await yieldFrame();

      setDownloadPhase("Parsing…");
      const totalBytes = chunks.reduce((s, c) => s + c.length, 0);
      const merged = new Uint8Array(totalBytes);
      let off = 0;
      for (const c of chunks) {
        merged.set(c, off);
        off += c.length;
      }
      const text = new TextDecoder("utf-8").decode(merged);
      setDownloadProgress((NETWORK_CAP + PARSE_CAP) / 2);
      await yieldFrame();

      const rows = JSON.parse(text) as Row[];
      setDownloadProgress(PARSE_CAP);
      await yieldFrame();

      setDownloadPhase(`Building ${format.toUpperCase()}…`);
      await yieldFrame();
      const stamp = todayStamp();
      const filename = `master-full-data-${brand.toLowerCase()}-${periodSlug}-${stamp}.${format}`;
      await downloadAs(format, filename, rows, fields);
      setDownloadProgress(BUILD_CAP);
      await yieldFrame();

      setDownloadPhase("Done");
      setDownloadProgress(1);
    } catch (e) {
      alert(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTimeout(() => {
        setDownloading(false);
        setDownloadProgress(0);
        setDownloadPhase("");
      }, 350);
    }
  }

  const visibleOptions = PREVIEW_OPTIONS.filter((o, i) => {
    if (i === 0) return true;
    return count == null || o.value <= count;
  });

  return (
    <div className="flex flex-col gap-3 h-full">
      <div
        className={`grid grid-cols-1 gap-3 ${
          scope === "filtered" ? "md:grid-cols-4" : "md:grid-cols-3"
        }`}
      >
        {scope === "filtered" && (
          <div data-tour="export-period-picker">
            <label
              className="block text-[11px] uppercase tracking-[0.08em] font-semibold mb-1.5"
              style={{ color: "var(--text-muted)" }}
            >
              Period
            </label>
            <PeriodPicker
              brand={brand}
              period={period}
              selectedMonths={selectedMonths}
              selectedWeeks={weeks}
              selectedDays={selectedDays}
              months={monthsForPicker}
              onChange={({ period: p, months, weeks: w, days: d }) => {
                setPeriod(p);
                setSelectedMonths(months);
                setWeeks(w);
                setSelectedDays(d);
              }}
            />
          </div>
        )}

        <div data-tour="export-scope-toggle">
          <label
            className="block text-[11px] uppercase tracking-[0.08em] font-semibold mb-1.5"
            style={{ color: "var(--text-muted)" }}
          >
            Data scope
          </label>
          <Segmented
            value={scope}
            onChange={(v) => setScope(v as "filtered" | "all")}
            options={[
              {
                value: "filtered",
                label: "Filtered",
                title:
                  "Use the filters set on the dashboard (month / branch / channel / etc.)",
              },
              {
                value: "all",
                label: "All data",
                title:
                  "Pull every row from the database — no filtering. Slow + large file.",
              },
            ]}
          />
        </div>

        <div>
          <label
            className="block text-[11px] uppercase tracking-[0.08em] font-semibold mb-1.5"
            style={{ color: "var(--text-muted)" }}
          >
            File format
          </label>
          <Segmented
            value={format}
            onChange={(v) => setFormat(v as "csv" | "xlsx")}
            options={[
              { value: "csv", label: "CSV" },
              { value: "xlsx", label: "XLSX" },
            ]}
          />
        </div>

        <div>
          <label
            className="block text-[11px] uppercase tracking-[0.08em] font-semibold mb-1.5"
            style={{ color: "var(--text-muted)" }}
          >
            Fields ({fields.length}/{ALL_FIELDS.length})
          </label>
          <FieldPicker
            all={userOrder}
            selected={fieldsForPicker}
            onChange={onPickerChange}
            onReset={resetFieldOrder}
          />
        </div>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-2 text-[12px]">
        <Stat
          label="Rows"
          value={
            countLoading
              ? "…"
              : countError
              ? "—"
              : (count ?? 0).toLocaleString()
          }
        />
        <Stat label="Columns" value={fields.length.toLocaleString()} />
        <Stat
          label={`Est. ${format.toUpperCase()} size`}
          value={formatBytes(
            format === "csv" ? budget.estBytesCsv : budget.estBytesXlsx
          )}
        />
      </div>

      {/* Size warning */}
      {count !== null && count > 100_000 && (
        <div
          className="rounded-md px-2.5 py-1.5 flex items-start gap-2 text-[10.5px] leading-tight"
          style={{
            background: "rgba(217,119,6,0.08)",
            border: "1px solid rgba(217,119,6,0.35)",
            color: "var(--text-primary)",
          }}
        >
          <span className="text-base leading-none mt-[1px]">⚠️</span>
          <div className="flex-1">
            {count > 500_000 ? (
              <>
                <strong>
                  Very large dataset ({count.toLocaleString()} rows).
                </strong>{" "}
                The download can take 30 seconds or more and the browser may
                briefly freeze while the file is built. We recommend{" "}
                <strong>CSV</strong> and trimming any fields you don&apos;t
                need.
              </>
            ) : (
              <>
                <strong>
                  Large dataset ({count.toLocaleString()} rows).
                </strong>{" "}
                We recommend <strong>CSV</strong> for speed — XLSX still
                works but takes longer to build.
              </>
            )}
          </div>
        </div>
      )}

      {/* Preview header + row-count selector */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-baseline justify-between mb-1.5 gap-2 flex-wrap shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div
              className="text-[11px] uppercase tracking-[0.08em] font-semibold"
              style={{ color: "var(--text-muted)" }}
            >
              Preview ({resolvedPreviewLimit.toLocaleString()} of{" "}
              {count != null ? count.toLocaleString() : "?"} rows)
            </div>
            {(() => {
              const reordered =
                userOrder.length !== ALL_FIELDS.length ||
                userOrder.some((f, i) => f !== ALL_FIELDS[i]);
              const deselected = selectedSet.size !== ALL_FIELDS.length;
              const dirty = reordered || deselected;
              return (
                <button
                  type="button"
                  onClick={resetFieldOrder}
                  disabled={!dirty}
                  data-tour="export-reset-columns"
                  title="Restore the default column order and re-select every field"
                  className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11px] font-semibold transition-colors"
                  style={{
                    border: "1px solid var(--border-card)",
                    color: dirty ? "var(--accent)" : "var(--text-muted)",
                    opacity: dirty ? 1 : 0.6,
                    cursor: dirty ? undefined : "not-allowed",
                  }}
                >
                  <ResetIcon className="h-3 w-3" />
                  Reset columns
                </button>
              );
            })()}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>Show:</span>
            <div
              className="inline-flex rounded-md overflow-hidden"
              style={{ border: "1px solid var(--border-card)", background: "var(--bg-elevated)" }}
            >
              {visibleOptions.map((o, i) => (
                <button
                  key={String(o.value)}
                  type="button"
                  onClick={() => setPreviewLimit(o.value)}
                  className="h-6 px-2 text-[11px] font-semibold transition-colors"
                  style={{
                    borderLeft: i > 0 ? "1px solid var(--border-card)" : undefined,
                    background: previewLimit === o.value ? "var(--accent-subtle)" : undefined,
                    color: previewLimit === o.value ? "var(--accent)" : "var(--text-primary)",
                  }}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {resolvedPreviewLimit >= SLOW_PREVIEW_THRESHOLD && (
              <span className="text-[9px] italic" style={{ color: "var(--text-muted)" }}>
                may be slow
              </span>
            )}
            {previewError && (
              <span className="text-[11px] text-red-600 truncate max-w-[40%]">
                {previewError}
              </span>
            )}
          </div>
        </div>
        <div
          className="rounded-lg overflow-auto scroll-thin flex-1 min-h-[200px]"
          style={{ border: "1px solid var(--border-card)" }}
          data-tour="export-preview-table"
        >
          {/* DndContext wraps the table from OUTSIDE — dnd-kit's
              <DragOverlay> mounts a <div> portal, and a <div> child of
              <table> is invalid HTML (React 19 surfaces it as a
              hydration error). Keeping <SortableContext> as the only
              dnd-kit thing inside the table is fine — it's a context
              provider with no DOM. */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
            autoScroll={{
              acceleration: 4,
              threshold: { x: 0.12, y: 0 },
              interval: 5,
            }}
          >
            <table
              key={fieldsKey}
              className="text-[11px] tabular-nums border-collapse table-fixed"
              style={{
                width: fields.reduce((s, f) => s + colWidth(f), 0),
              }}
            >
              <colgroup>
                {fields.map((f) => (
                  <col key={f} style={{ width: colWidth(f) }} />
                ))}
              </colgroup>
              <SortableContext
                items={fields}
                strategy={horizontalListSortingStrategy}
              >
                <thead
                  className="sticky top-0 z-10"
                  style={{ background: "var(--bg-elevated)", color: "var(--text-primary)" }}
                >
                  <tr>
                    {fields.map((h) => (
                      <SortableHeaderCell key={h} field={h} />
                    ))}
                  </tr>
                </thead>
              </SortableContext>
              <tbody>
              {previewLoading || preview === null ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr
                    key={`skel-${i}`}
                    style={{ borderTop: "1px solid var(--border-card)" }}
                  >
                    {fields.map((h) => (
                      <td key={h} className="px-2 py-1">
                        <div
                          className="skeleton h-3 rounded"
                          style={{
                            width: `${
                              55 +
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
              ) : preview.length === 0 ? (
                <tr>
                  <td
                    colSpan={fields.length || 1}
                    className="px-2 py-6 text-center"
                    style={{ color: "var(--text-muted)" }}
                  >
                    No rows
                  </td>
                </tr>
              ) : (
                preview.map((row, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--border-card)" }}>
                    {fields.map((h) => (
                      <td
                        key={h}
                        className="px-2 py-1 whitespace-nowrap overflow-hidden text-ellipsis"
                        style={{ color: "var(--text-primary)" }}
                        title={String(row[h] ?? "")}
                      >
                        {formatCell(row[h])}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
            </table>
            <DragOverlay
              dropAnimation={DROP_ANIM}
              modifiers={[]}
              zIndex={1000}
              style={{ cursor: "grabbing" }}
            >
              {activeId ? (
                <FloatingFieldChip
                  field={activeId}
                  width={colWidth(activeId)}
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      </div>

      {/* Footer actions + download progress */}
      <div className="mt-auto">
        <TopProgressBar
          active={downloading}
          progress={
            downloadPhase === "Connecting…" ? undefined : displayedProgress
          }
        />
      </div>
      {downloading && (
        <div
          className="text-[11px] text-center -mt-1 tabular-nums"
          style={{ color: "var(--text-muted)" }}
        >
          {downloadPhase}{" "}
          {downloadPhase !== "Connecting…" && (
            <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
              {Math.round(displayedProgress * 100)}%
            </span>
          )}
        </div>
      )}
      <div
        className="flex items-center justify-between gap-2 pt-2"
        style={{ borderTop: "1px solid var(--border-card)" }}
      >
        <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {scope === "filtered" && period === "weekly" && weeks.length === 0 ? (
            <span style={{ color: "var(--warning, #d97706)" }}>
              Pick at least one week to enable the download.
            </span>
          ) : scope === "filtered" &&
            period === "daily" &&
            selectedDays.length === 0 ? (
            <span style={{ color: "var(--warning, #d97706)" }}>
              Pick at least one day to enable the download.
            </span>
          ) : count !== null && count > 0 ? (
            `Will download up to ${count.toLocaleString()} rows × ${fields.length} fields as ${format.toUpperCase()}.`
          ) : (
            ""
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-8 px-3 text-xs rounded-md transition-colors"
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
            disabled={
              downloading ||
              !count ||
              fields.length === 0 ||
              (scope === "filtered" &&
                period === "weekly" &&
                weeks.length === 0) ||
              (scope === "filtered" &&
                period === "daily" &&
                selectedDays.length === 0)
            }
            onClick={download}
            className="h-8 px-3 text-xs rounded-md font-semibold disabled:opacity-50 inline-flex items-center gap-1.5"
            style={{
              background: "var(--accent)",
              color: "#fff",
            }}
          >
            {downloading ? "Preparing…" : `Download ${format.toUpperCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{
    value: T;
    label: string;
    disabled?: boolean;
    title?: string;
  }>;
}) {
  return (
    <div
      className="inline-flex w-full rounded-md overflow-hidden"
      style={{ border: "1px solid var(--border-card)", background: "var(--bg-elevated)" }}
    >
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className="flex-1 h-8 text-xs font-semibold transition-colors"
          style={{
            borderLeft: i > 0 ? "1px solid var(--border-card)" : undefined,
            background: value === o.value ? "var(--accent-subtle)" : undefined,
            color: value === o.value ? "var(--accent)" : "var(--text-primary)",
            opacity: o.disabled ? 0.4 : 1,
            cursor: o.disabled ? "not-allowed" : undefined,
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-md px-2 py-1.5"
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-card)",
      }}
    >
      <div
        className="text-[9px] uppercase tracking-wide"
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </div>
      <div
        className="text-[12px] font-semibold tabular-nums"
        style={{ color: "var(--text-primary)" }}
      >
        {value}
      </div>
    </div>
  );
}

const DROP_ANIM: DropAnimation = {
  duration: 260,
  easing: "cubic-bezier(0.18, 0.89, 0.32, 1.15)",
  sideEffects: defaultDropAnimationSideEffects({
    styles: {
      active: { opacity: "0" },
    },
  }),
};

function SortableHeaderCell({ field }: { field: string }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: field,
    transition: {
      duration: 220,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    },
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    cursor: isDragging ? "grabbing" : "grab",
    opacity: isDragging ? 0 : 1,
    background: isDragging ? "var(--bg-elevated)" : undefined,
  };
  return (
    <th
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      title={`${field} — drag to reorder`}
      className="text-left font-semibold px-2 py-1.5 whitespace-nowrap truncate select-none touch-none"
    >
      <span className="inline-flex items-center gap-1">
        <span aria-hidden style={{ color: "var(--text-muted)" }} className="text-[8px]">
          ⋮⋮
        </span>
        {field}
      </span>
    </th>
  );
}

function FloatingFieldChip({
  field,
  width,
}: {
  field: string;
  width: number;
}) {
  return (
    <div
      style={{
        width,
        transform: "scale(1.06) rotate(-1.5deg)",
        boxShadow:
          "0 18px 36px -6px rgba(15, 23, 42, 0.32), 0 8px 16px -4px rgba(15, 23, 42, 0.18)",
        background: "var(--bg-card)",
        borderColor: "var(--accent)",
        animation: "field-chip-pickup 180ms cubic-bezier(0.34,1.56,0.64,1)",
        outline: "2px solid var(--accent)",
        outlineOffset: "-2px",
      }}
      className="rounded-md border-2 px-2 py-1.5 text-[11px] font-semibold whitespace-nowrap truncate cursor-grabbing"
    >
      <span
        className="inline-flex items-center gap-1"
        style={{ color: "var(--text-primary)" }}
      >
        <span aria-hidden style={{ color: "var(--accent)" }} className="text-[8px]">
          ⋮⋮
        </span>
        {field}
      </span>
    </div>
  );
}

function ResetIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" />
      <path d="M2.5 3v3h3" />
    </svg>
  );
}

function yieldFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" && v.includes("T") && /\d{4}-\d{2}-\d{2}T/.test(v))
    return v.replace("T", " ").slice(0, 19);
  if (typeof v === "number")
    return v.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  return String(v);
}
