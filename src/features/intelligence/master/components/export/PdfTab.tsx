"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  prepareCloneForCapture,
  type Orientation,
} from "@/features/intelligence/master/lib/pdf-export";
import { useMasterFilters } from "@/features/intelligence/master/hooks/useMasterFilters";
import { ViewKey } from "@/features/intelligence/master/types";
import { TopProgressBar } from "@/features/intelligence/master/components/export/TopProgressBar";

type Mode = "view" | "sheets";

interface SheetSpec {
  id: string; // matches data-export-id on the host element
  title: string;
}

const SHEETS: SheetSpec[] = [
  { id: "kpi-strip", title: "Net Sales Detail" },
  { id: "ticket-strip", title: "Average Ticket Usage" },
  { id: "ticket-by-sale-type", title: "Average Ticket by Sale Channel" },
  { id: "main-bar", title: "Net Sales (Main bar chart)" },
  { id: "branch-ads", title: "Branch ADS — MoM Growth %" },
  { id: "by-store", title: "Net Sales by Store" },
  { id: "channel-proportion", title: "Channel Proportion" },
  { id: "hourly", title: "Average Ticket by Hour" },
];

interface Props {
  brand: string;
  onClose: () => void;
  /** Current dashboard view — forwarded to the print endpoint so the PDF
   *  reflects whatever the user was looking at. */
  view?: ViewKey;
}

export function PdfTab({ brand, onClose, view = "Sale Channel" }: Props) {
  const [mode, setMode] = useState<Mode>("view");
  const [orientation, setOrientation] = useState<Orientation>("landscape");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(SHEETS.map((s) => s.id))
  );
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const selectedSheets = useMemo(
    () => SHEETS.filter((s) => selectedIds.has(s.id)),
    [selectedIds]
  );

  const targets = useMemo(() => {
    if (mode === "view") {
      return [{ id: "dashboard-root", title: "Master Dashboard" }];
    }
    return selectedSheets.map((s) => ({ id: s.id, title: s.title }));
  }, [mode, selectedSheets]);

  const pageCount = targets.length;

  function toggleSheet(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /* ───────────── Preview generation (debounced, low-res) ───────────── */
  const [previews, setPreviews] = useState<
    Array<{
      title: string;
      dataUrl: string | null;
      sheetId: string;
      heavy?: boolean;
    }>
  >([]);
  const [fetchingThumbs, setFetchingThumbs] = useState<Set<string>>(
    () => new Set()
  );
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const previewKey = useMemo(
    () => `${mode}|${Array.from(selectedIds).sort().join(",")}|${orientation}`,
    [mode, selectedIds, orientation]
  );

  const [previewProgress, setPreviewProgress] = useState(0);

  useEffect(() => {
    if (targets.length === 0) {
      setPreviews([]);
      setPreviewProgress(0);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setPreviewLoading(true);
      setPreviewError(null);
      setPreviewProgress(0);
      setPreviews([]);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const html2canvas = ((await import("html2canvas" as never)) as any).default as (el: HTMLElement, opts: Record<string, unknown>) => Promise<HTMLCanvasElement>;
        const isDark =
          document.documentElement.classList.contains("dark");
        const themeBg = isDark
          ? getComputedStyle(document.documentElement)
              .getPropertyValue("--bg-card")
              .trim() || "#14171f"
          : "#ffffff";

        if (document.fonts?.ready) {
          await document.fonts.ready;
        }

        const PREVIEW_SCALE = 0.32;
        const PREVIEW_QUALITY = 0.88;
        const HEAVY_PATH_THRESHOLD = 3500;

        let completed = 0;
        const captureOne = async (t: (typeof targets)[number]) => {
          const el = document.querySelector<HTMLElement>(
            `[data-export-id="${t.id}"]`
          );
          if (!el || cancelled) return null;

          const heavyCount = el.querySelectorAll(
            "svg path, svg rect, svg line"
          ).length;
          if (heavyCount > HEAVY_PATH_THRESHOLD) {
            setPreviews((prev) => [
              ...prev,
              {
                title: t.title,
                sheetId: t.id,
                dataUrl: null,
                heavy: true,
              },
            ]);
            completed += 1;
            setPreviewProgress(completed / targets.length);
            return null;
          }

          const canvas = await html2canvas(el, {
            backgroundColor: themeBg,
            scale: PREVIEW_SCALE,
            useCORS: true,
            logging: false,
            foreignObjectRendering: false,
            onclone: (doc: Document) => {
              const target = doc.querySelector<HTMLElement>(
                `[data-export-id="${t.id}"]`
              );
              if (target) prepareCloneForCapture(doc, target, themeBg);
            },
          });
          if (cancelled) return null;
          const dataUrl = canvas.toDataURL("image/jpeg", PREVIEW_QUALITY);
          setPreviews((prev) => [
            ...prev,
            { title: t.title, sheetId: t.id, dataUrl },
          ]);
          completed += 1;
          setPreviewProgress(completed / targets.length);
          return dataUrl;
        }

        for (let i = 0; i < targets.length; i++) {
          if (cancelled) return;
          await yieldToBrowser();
          await yieldToBrowser();
          await captureOne(targets[i]);
        }
      } catch (e) {
        if (!cancelled)
          setPreviewError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  /* ───────────── On-demand server-side thumbnail ─────────────
     Hits /api/intelligence/dashboards/master/preview-thumbnail.
     If the route returns 501 (not yet implemented), shows a
     friendly "coming soon" message. */
  const dashboardFilters = useMasterFilters();
  const viewRef = useRef(view);
  viewRef.current = view;
  const filtersRef = useRef(dashboardFilters.filters);
  filtersRef.current = dashboardFilters.filters;
  const tabModeRef = useRef(mode);
  tabModeRef.current = mode;
  const fetchingRef = useRef<Set<string>>(new Set());

  const fetchHeavyPreview = useCallback(async (sheetId: string) => {
    if (fetchingRef.current.has(sheetId)) return;
    fetchingRef.current.add(sheetId);
    setFetchingThumbs(new Set(fetchingRef.current));
    try {
      const isDark = document.documentElement.classList.contains("dark");
      const sp = new URLSearchParams();
      sp.set("brand", brand);
      sp.set("theme", isDark ? "dark" : "light");
      sp.set("view", viewRef.current);
      if (sheetId === "dashboard-root" || tabModeRef.current === "view") {
        sp.set("mode", "view");
      } else {
        sp.set("mode", "sheet");
        sp.set("sheetId", sheetId);
      }
      for (const [k, vals] of Object.entries(filtersRef.current)) {
        if (!vals) continue;
        for (const v of vals) sp.append(k, v);
      }
      const res = await fetch(
        `/api/intelligence/dashboards/master/preview-thumbnail?${sp.toString()}`,
        { method: "GET", cache: "no-store" }
      );
      // 501 = not yet implemented — show friendly message
      if (res.status === 501) {
        toast.error("Preview thumbnail not yet available — coming soon!");
        return;
      }
      if (!res.ok) {
        const txt = await res.text().catch(() => `HTTP ${res.status}`);
        throw new Error(txt || `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const dataUrl = await blobToDataUrl(blob);
      setPreviews((prev) =>
        prev.map((p) =>
          p.sheetId === sheetId
            ? { ...p, dataUrl, heavy: false }
            : p
        )
      );
    } catch (e) {
      setPreviewError(
        `Preview failed: ${e instanceof Error ? e.message : String(e)}`
      );
    } finally {
      fetchingRef.current.delete(sheetId);
      setFetchingThumbs(new Set(fetchingRef.current));
    }
  }, [brand]);

  /* ───────────── Download ─────────────
     Calls /api/intelligence/dashboards/master/export-pdf.
     If the route returns 501, shows a "coming soon" toast. */
  async function handleDownload() {
    if (pageCount === 0) return;
    setError(null);
    setDownloading(true);
    setProgress(0);

    const tweenStart = performance.now();
    const tweenInterval = window.setInterval(() => {
      const elapsed = (performance.now() - tweenStart) / 1000;
      const target = 0.85 * (1 - Math.exp(-elapsed / 4));
      setProgress(target);
    }, 80);

    try {
      const isDark = document.documentElement.classList.contains("dark");
      const sp = new URLSearchParams();
      sp.set("brand", brand);
      sp.set("theme", isDark ? "dark" : "light");
      sp.set("view", view);
      sp.set("mode", mode);
      sp.set("orientation", orientation);
      if (mode === "sheets") {
        for (const id of Array.from(selectedIds)) sp.append("sheetId", id);
      }
      for (const [k, vals] of Object.entries(dashboardFilters.filters)) {
        if (!vals) continue;
        for (const v of vals) sp.append(k, v);
      }

      const res = await fetch(
        `/api/intelligence/dashboards/master/export-pdf?${sp.toString()}`,
        { method: "GET", cache: "no-store" }
      );

      // 501 = PDF export not yet implemented — show friendly message
      if (res.status === 501) {
        toast.error("PDF export not yet available — coming soon!");
        return;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `Server returned ${res.status}`);
      }
      const blob = await res.blob();

      window.clearInterval(tweenInterval);
      setProgress(1);

      const stamp = new Date().toISOString().slice(0, 10);
      const fileName = `master-dashboard-${brand.toLowerCase()}-${
        mode === "view" ? "view" : "sheets"
      }-${stamp}.pdf`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      window.clearInterval(tweenInterval);
      setTimeout(() => {
        setDownloading(false);
        setProgress(0);
      }, 350);
    }
  }

  const fileSizeEst = pageCount * 0.7;

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Mode picker */}
      <div>
        <label
          className="block text-[11px] uppercase tracking-[0.08em] font-semibold mb-1.5"
          style={{ color: "var(--text-muted)" }}
        >
          Export mode
        </label>
        <div className="grid grid-cols-2 gap-2">
          <ModeCard
            active={mode === "view"}
            title="This view"
            description="Capture the entire dashboard as a single PDF page."
            onClick={() => setMode("view")}
          />
          <ModeCard
            active={mode === "sheets"}
            title="Specific sheets"
            description="Pick chart sections; each becomes its own PDF page."
            onClick={() => setMode("sheets")}
          />
        </div>
      </div>

      {/* Orientation + Sheets row */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            className="block text-[11px] uppercase tracking-[0.08em] font-semibold mb-1.5"
            style={{ color: "var(--text-muted)" }}
          >
            Orientation
          </label>
          <div
            className="inline-flex w-full rounded-md overflow-hidden"
            style={{ border: "1px solid var(--border-card)", background: "var(--bg-elevated)" }}
          >
            {(
              [
                { value: "landscape", label: "Landscape" },
                { value: "portrait", label: "Portrait" },
              ] as const
            ).map((o, i) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setOrientation(o.value)}
                className="flex-1 h-8 text-xs font-semibold transition-colors"
                style={{
                  borderLeft: i > 0 ? "1px solid var(--border-card)" : undefined,
                  background: orientation === o.value ? "var(--accent-subtle)" : undefined,
                  color: orientation === o.value ? "var(--accent)" : "var(--text-primary)",
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label
            className="block text-[11px] uppercase tracking-[0.08em] font-semibold mb-1.5"
            style={{ color: "var(--text-muted)" }}
          >
            {mode === "sheets"
              ? `Sheets (${selectedSheets.length}/${SHEETS.length})`
              : "Sheets"}
          </label>
          <SheetDropdown
            disabled={mode !== "sheets"}
            sheets={SHEETS}
            selectedIds={selectedIds}
            onToggle={toggleSheet}
            onSelectAll={() => setSelectedIds(new Set(SHEETS.map((s) => s.id)))}
            onClear={() => setSelectedIds(new Set())}
          />
        </div>
      </div>

      {/* Preview pane */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-baseline justify-between mb-1.5">
          <label
            className="text-[11px] uppercase tracking-[0.08em] font-semibold"
            style={{ color: "var(--text-muted)" }}
          >
            Preview ({pageCount} page{pageCount !== 1 ? "s" : ""})
          </label>
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {previewLoading
              ? `Rendering ${previews.length}/${pageCount}…`
              : previewError
              ? "Preview error"
              : `~ ${fileSizeEst.toFixed(1)} MB · A4 ${orientation}`}
          </span>
        </div>
        <div className="mb-1.5">
          <TopProgressBar
            active={previewLoading}
            progress={previewProgress}
          />
        </div>
        <div
          className="rounded-lg flex-1 min-h-0 overflow-hidden p-3"
          style={{
            border: "1px solid var(--border-card)",
            background: "var(--bg-elevated)",
          }}
        >
          {previewError ? (
            <div className="text-[12px] text-red-600 px-2 py-1">
              {previewError}
            </div>
          ) : pageCount === 0 ? (
            <div
              className="text-[12px] text-center py-8"
              style={{ color: "var(--text-muted)" }}
            >
              {mode === "sheets" && selectedSheets.length === 0
                ? "Select at least one sheet to preview."
                : "No preview available."}
            </div>
          ) : (() => {
            const cols = gridCols(pageCount);
            const rows = Math.ceil(pageCount / cols);
            return (
              <div
                className="grid gap-2 h-full w-full"
                style={{
                  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                  gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
                }}
              >
                {targets.map((t, i) => {
                  const p = previews[i];
                  return p ? (
                    <PreviewCard
                      key={`${t.id}-${i}`}
                      pageNumber={i + 1}
                      title={p.title}
                      dataUrl={p.dataUrl}
                      heavy={!!p.heavy}
                      loading={fetchingThumbs.has(p.sheetId)}
                      onShowPreview={
                        p.heavy ? () => fetchHeavyPreview(p.sheetId) : undefined
                      }
                    />
                  ) : (
                    <PreviewSkeletonCard
                      key={`skel-${t.id}-${i}`}
                    />
                  );
                })}
              </div>
            );
          })()}
        </div>
      </div>

      {error && (
        <div className="text-[11px] text-red-600 -mt-1">{error}</div>
      )}

      {/* Footer + progress */}
      <div className="mt-auto">
        <TopProgressBar active={downloading} progress={progress} />
      </div>
      {downloading && (
        <div
          className="text-[11px] text-center -mt-1 tabular-nums"
          style={{ color: "var(--text-muted)" }}
        >
          Rendering on server (Chromium){" "}
          <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
            {Math.round(progress * 100)}%
          </span>
        </div>
      )}
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
          disabled={downloading || pageCount === 0}
          onClick={handleDownload}
          className="h-8 px-3 text-xs rounded-md font-semibold disabled:opacity-50 inline-flex items-center gap-1.5"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          {downloading ? "Generating…" : "Download PDF"}
        </button>
      </div>
    </div>
  );
}

/* ───────────── ModeCard ───────────── */
function ModeCard({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-lg px-3 py-2 transition-colors"
      style={{
        border: active ? "1px solid var(--accent)" : "1px solid var(--border-card)",
        background: active ? "var(--accent-subtle)" : undefined,
      }}
    >
      <div
        className="text-xs font-semibold"
        style={{ color: active ? "var(--accent)" : "var(--text-primary)" }}
      >
        {title}
      </div>
      <div className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
        {description}
      </div>
    </button>
  );
}

/* ───────────── SheetDropdown ───────────── */
const PANEL_W = 280;

function SheetDropdown({
  disabled,
  sheets,
  selectedIds,
  onToggle,
  onSelectAll,
  onClear,
}: {
  disabled: boolean;
  sheets: SheetSpec[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null
  );
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    function update() {
      const btn = triggerRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const vw = window.innerWidth;
      let left = r.left;
      if (left + PANEL_W > vw - 8) left = vw - PANEL_W - 8;
      if (left < 8) left = 8;
      setCoords({ top: r.bottom + 4, left });
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const triggerLabel = disabled
    ? "Whole dashboard"
    : selectedIds.size === sheets.length
    ? "All sheets"
    : selectedIds.size === 0
    ? "Pick sheets…"
    : `${selectedIds.size} sheets`;

  const panel = open && coords && !disabled && (
    <div
      ref={panelRef}
      style={{
        position: "fixed",
        top: coords.top,
        left: coords.left,
        width: PANEL_W,
        zIndex: 10001,
        boxShadow: "0 12px 40px rgba(15,23,42,0.18)",
        background: "var(--bg-card)",
        border: "1px solid var(--border-card)",
      }}
      className="rounded-xl"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="px-3 py-2 flex items-center justify-between"
        style={{ borderBottom: "1px solid var(--border-card)" }}
      >
        <span
          className="text-[11px] uppercase tracking-[0.08em] font-semibold"
          style={{ color: "var(--text-muted)" }}
        >
          Pick sheets
        </span>
        <div className="flex items-center gap-2 text-[11px]">
          <button
            type="button"
            onClick={onSelectAll}
            style={{ color: "var(--text-muted)" }}
          >
            Select all
          </button>
          <span style={{ color: "var(--text-muted)" }}>·</span>
          <button
            type="button"
            onClick={onClear}
            disabled={selectedIds.size === 0}
            className="disabled:opacity-40"
            style={{ color: "var(--text-muted)" }}
          >
            Clear
          </button>
        </div>
      </div>
      <div className="max-h-64 overflow-y-auto py-1 scroll-thin">
        {sheets.map((s, i) => {
          const checked = selectedIds.has(s.id);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onToggle(s.id)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors"
              style={{
                background: checked ? "var(--accent-subtle)" : undefined,
              }}
            >
              <span
                aria-hidden
                className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded"
                style={{
                  background: checked ? "var(--accent)" : "var(--bg-elevated)",
                  border: checked ? "1px solid var(--accent)" : "1px solid var(--border-card)",
                  color: checked ? "#fff" : undefined,
                }}
              >
                {checked && (
                  <svg viewBox="0 0 12 12" className="h-3 w-3">
                    <path
                      d="M2.5 6.5l2.5 2.5 4.5-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
              <span style={{ color: "var(--text-primary)" }}>{s.title}</span>
              <span className="ml-auto text-[9px]" style={{ color: "var(--text-muted)" }}>
                Page {i + 1}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left text-xs rounded-md h-8 px-2 transition-colors"
        style={{
          background: "var(--bg-elevated)",
          border: disabled
            ? "1px solid var(--border-card)"
            : open
            ? "1px solid var(--accent)"
            : "1px solid var(--border-card)",
          color: disabled ? "var(--text-muted)" : "var(--text-primary)",
          opacity: disabled ? 0.6 : 1,
          cursor: disabled ? "not-allowed" : undefined,
        }}
      >
        <span>{triggerLabel}</span>
        {!disabled && (
          <span
            className="float-right text-[11px] mt-[2px]"
            style={{ color: "var(--text-muted)" }}
          >
            {open ? "▴" : "▾"}
          </span>
        )}
      </button>
      {mounted && panel ? createPortal(panel, document.body) : null}
    </>
  );
}

/* ───────────── Preview thumbnail card ───────────── */
function PreviewCard({
  pageNumber,
  title,
  dataUrl,
  heavy,
  loading,
  onShowPreview,
}: {
  pageNumber: number;
  title: string;
  dataUrl: string | null;
  heavy?: boolean;
  loading?: boolean;
  onShowPreview?: () => void;
}) {
  return (
    <div
      className="rounded-md overflow-hidden flex flex-col min-h-0"
      style={{
        border: "1px solid var(--border-card)",
        background: "var(--bg-card)",
        boxShadow: "0 1px 3px rgba(15,23,42,0.06)",
      }}
    >
      <div
        className="relative flex-1 min-h-0 flex items-center justify-center"
        style={{ background: "var(--bg-base)" }}
      >
        {dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={dataUrl}
            alt={title}
            className="absolute inset-0 m-auto max-h-full max-w-full object-contain"
          />
        ) : loading ? (
          <div className="flex flex-col items-center gap-2 px-3 text-center">
            <div
              className="h-5 w-5 rounded-full border-2 animate-spin"
              style={{
                borderColor: "var(--border-card)",
                borderTopColor: "var(--accent)",
              }}
              aria-hidden
            />
            <span className="text-[9px] leading-tight" style={{ color: "var(--text-muted)" }}>
              Generating preview…
              <br />
              (server-side, ~5s)
            </span>
          </div>
        ) : heavy && onShowPreview ? (
          <div className="flex flex-col items-center gap-1.5 px-3 text-center">
            <svg
              viewBox="0 0 24 24"
              className="h-6 w-6"
              style={{ color: "var(--text-muted)", opacity: 0.6 }}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden
            >
              <rect x="3" y="4" width="18" height="14" rx="2" />
              <path d="M3 14l5-5 4 4 3-3 6 6" />
              <circle cx="9" cy="9" r="1" fill="currentColor" />
            </svg>
            <button
              type="button"
              onClick={onShowPreview}
              className="text-[11px] font-semibold hover:underline"
              style={{ color: "var(--accent)" }}
            >
              Show preview
            </button>
            <span className="text-[9px] leading-tight" style={{ color: "var(--text-muted)" }}>
              Skipped to keep the tab snappy
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1 px-3 text-center">
            <svg
              viewBox="0 0 24 24"
              className="h-7 w-7"
              style={{ color: "var(--text-muted)", opacity: 0.6 }}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden
            >
              <rect x="3" y="4" width="18" height="14" rx="2" />
              <path d="M3 14l5-5 4 4 3-3 6 6" />
              <circle cx="9" cy="9" r="1" fill="currentColor" />
            </svg>
            <span className="text-[9px] leading-tight" style={{ color: "var(--text-muted)" }}>
              Preview not generated
              <br />
              (export will include full chart)
            </span>
          </div>
        )}
      </div>
      <div
        className="px-2 py-1 flex items-center justify-between gap-2 shrink-0"
        style={{ borderTop: "1px solid var(--border-card)" }}
      >
        <span
          className="text-[11px] truncate"
          style={{ color: "var(--text-primary)" }}
          title={title}
        >
          {title}
        </span>
        <span className="text-[9px] shrink-0" style={{ color: "var(--text-muted)" }}>
          Pg {pageNumber}
        </span>
      </div>
    </div>
  );
}

function PreviewSkeletonCard() {
  return (
    <div
      className="rounded-md overflow-hidden flex flex-col min-h-0"
      style={{ border: "1px solid var(--border-card)" }}
    >
      <div className="skeleton flex-1 min-h-0" />
      <div
        className="px-2 py-1 shrink-0"
        style={{ borderTop: "1px solid var(--border-card)" }}
      >
        <div className="skeleton h-3 rounded" style={{ width: "70%" }} />
      </div>
    </div>
  );
}

function gridCols(count: number): number {
  if (count <= 1) return 1;
  if (count <= 2) return 2;
  if (count <= 4) return 2;
  if (count <= 6) return 3;
  if (count <= 9) return 3;
  if (count <= 12) return 4;
  return 4;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}
