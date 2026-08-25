"use client";

import { FileText } from "lucide-react";

/** Centered popup loading overlay for AP-1 form (load / submit) and batch actions. */
export function TravelExpenseLoadingPopup({
  label = "กำลังโหลด...",
  subtitle = "แบบฟอร์มเบิกค่าเดินทาง (AP-1)",
  progress = null,
}: {
  label?: string;
  subtitle?: string | null;
  progress?: { done: number; total: number } | null;
}) {
  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : null;

  return (
    <div
      className="app-overlay acc-theme fixed inset-0 z-[60] flex items-center justify-center px-4"
      style={{ animation: "overlayFadeIn 0.15s ease-out" }}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div
        className="acc-fade-up flex flex-col items-center gap-5 rounded-2xl px-10 py-9 text-center"
        style={{
          background: "var(--bg-modal)",
          border: "1px solid var(--border-card)",
          boxShadow: "var(--shadow-lg)",
          minWidth: 280,
          maxWidth: 360,
        }}
      >
        {/* Animated ring + icon */}
        <div className="relative w-16 h-16 flex items-center justify-center">
          <span
            className="absolute inset-0 rounded-full acc-spin"
            style={{
              border: "3px solid color-mix(in srgb, var(--color-action) 18%, transparent)",
              borderTopColor: "var(--color-action)",
            }}
          />
          <span
            className="absolute inset-0 rounded-full acc-ping"
            style={{ border: "2px solid color-mix(in srgb, var(--color-action) 35%, transparent)" }}
          />
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "var(--nav-active-bg)" }}
          >
            <FileText size={18} style={{ color: "var(--nav-active-text)" }} />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <p className="text-[15px] font-bold" style={{ color: "var(--text-heading)" }}>
            {label}
          </p>
          {subtitle ? (
            <p className="text-[12px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
              {subtitle}
            </p>
          ) : null}
          {progress && progress.total > 0 ? (
            <p className="text-[11px] font-semibold tabular-nums m-0 mt-1" style={{ color: "var(--nav-active-text)" }}>
              {progress.done} / {progress.total} รายการ
            </p>
          ) : null}
        </div>

        {/*
          Progress bar — determinate when progress provided.

          The fill is `--color-action` itself, not `--btn-primary-bg`. That
          token is a *soft button surface* — `color-mix(action 14%, --bg-card)`
          — so against this track, which is action at 12%, the bar was very
          nearly the colour of the groove it sat in and read as empty. A 1px
          border on a 6px bar also ate a third of its height, and `color` on a
          div holding no text did nothing at all; both are gone.
        */}
        <div
          className="w-full h-1.5 rounded-full overflow-hidden"
          style={{ background: "color-mix(in srgb, var(--color-action) 12%, transparent)" }}
        >
          {pct != null ? (
            <div
              className="h-full rounded-full transition-[width] duration-300 ease-out"
              style={{ width: `${pct}%`, background: "var(--color-action)" }}
            />
          ) : (
            <div className="acc-progress h-full rounded-full" style={{ background: "var(--color-action)" }} />
          )}
        </div>
      </div>
    </div>
  );
}
