"use client";

import { CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";

export type ErpSyncPopupStatus = "running" | "done" | "error";

export interface ErpSyncPopupState {
  open: boolean;
  brandCode: string;
  part: string;
  percent: number;
  status: ErpSyncPopupStatus;
  detail?: string;
}

export function ErpAccountSyncPopup({
  state,
}: {
  state: ErpSyncPopupState;
}) {
  if (!state.open) return null;

  const isDone = state.status === "done";
  const isError = state.status === "error";

  return (
    <div
      className="app-overlay acc-theme fixed inset-0 z-[60] flex items-center justify-center px-4"
      style={{ animation: "overlayFadeIn 0.15s ease-out" }}
      role="status"
      aria-live="polite"
    >
      <div
        className="acc-fade-up w-full max-w-md rounded-2xl px-6 py-6"
        style={{
          background: "var(--bg-modal)",
          border: "1px solid var(--border-card)",
          boxShadow: "var(--shadow-lg)",
        }}
      >
        <div className="flex items-start gap-3 mb-4">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: isError
                ? "color-mix(in srgb, var(--color-danger) 12%, transparent)"
                : isDone
                  ? "rgba(79, 163, 122, 0.12)"
                  : "var(--nav-active-bg)",
              color: isError
                ? "var(--color-danger)"
                : isDone
                  ? "#4fa37a"
                  : "var(--nav-active-text)",
            }}
          >
            {isError ? (
              <XCircle size={20} />
            ) : isDone ? (
              <CheckCircle2 size={20} />
            ) : (
              <RefreshCw size={18} className="animate-spin" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-bold m-0" style={{ color: "var(--text-heading)" }}>
              {isError ? "Sync ERP ไม่สำเร็จ" : isDone ? "Sync ERP สำเร็จ" : "กำลัง Sync ERP"}
            </p>
            <p className="text-[12px] m-0 mt-1" style={{ color: "var(--text-muted)" }}>
              {isDone || isError
                ? (state.detail ?? "เสร็จสิ้น")
                : state.brandCode
                  ? `${state.brandCode} — ${state.part}`
                  : "กำลังเตรียมข้อมูล..."}
            </p>
          </div>
          {!isDone && !isError && (
            <span className="text-[13px] font-bold tabular-nums shrink-0" style={{ color: "var(--nav-active-text)" }}>
              {state.percent}%
            </span>
          )}
        </div>

        <div
          className="h-2 rounded-full overflow-hidden mb-3"
          style={{ background: "var(--bg-badge)" }}
        >
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${Math.min(100, Math.max(0, state.percent))}%`,
              background: isError
                ? "var(--color-danger)"
                : isDone
                  ? "linear-gradient(90deg, #4fa37a, #6bc48f)"
                  : "var(--nav-active-text)",
            }}
          />
        </div>

        {!isDone && !isError && state.brandCode && (
          <div className="flex items-center gap-2 text-[11px]" style={{ color: "var(--text-faint)" }}>
            <Loader2 size={12} className="animate-spin shrink-0" />
            <span>ดึงข้อมูลจาก Business Central...</span>
          </div>
        )}
      </div>
    </div>
  );
}
