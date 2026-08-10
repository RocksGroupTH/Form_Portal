"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ColorByKey, ViewKey } from "@/features/intelligence/master/types";
import { SummaryTab } from "@/features/intelligence/master/components/export/SummaryTab";
import { FullDataTab } from "@/features/intelligence/master/components/export/FullDataTab";

type Tab = "summary" | "full";

interface Props {
  brand: string;
  open: boolean;
  onClose: () => void;
  view: ViewKey;
  colorBy: ColorByKey;
}

export function ExportModal({ brand, open, onClose, view, colorBy }: Props) {
  const [tab, setTab] = useState<Tab>("summary");
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // ESC to close + scroll-lock the page beneath the modal.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);

    const html = document.documentElement;
    const body = document.body;
    const scrollY = window.scrollY;
    const scrollX = window.scrollX;
    const prev = {
      htmlOverflow: html.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyWidth: body.style.width,
    };
    html.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = `-${scrollX}px`;
    body.style.width = "100%";

    return () => {
      document.removeEventListener("keydown", onKey);
      html.style.overflow = prev.htmlOverflow;
      body.style.position = prev.bodyPosition;
      body.style.top = prev.bodyTop;
      body.style.left = prev.bodyLeft;
      body.style.width = prev.bodyWidth;
      window.scrollTo(scrollX, scrollY);
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  const node = (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Export data"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 backdrop-blur-sm"
        style={{ background: "rgba(15,23,42,0.40)" }}
      />

      {/* Dialog card */}
      <div
        className="relative flex flex-col w-[880px] max-w-[95vw] h-[700px] max-h-[95vh] overflow-hidden rounded-xl"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-card)",
          boxShadow: "0 24px 80px rgba(15,23,42,0.30)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <Header onClose={onClose} />

        {/* Tab strip */}
        <div
          className="flex items-center gap-1 px-4 pt-2"
          style={{ borderBottom: "1px solid var(--border-card)" }}
        >
          <span data-tour="export-tab-summary">
            <TabButton active={tab === "summary"} onClick={() => setTab("summary")}>
              <span className="text-sm">📊</span> Summary
            </TabButton>
          </span>
          <span data-tour="export-tab-full">
            <TabButton active={tab === "full"} onClick={() => setTab("full")}>
              <TableIcon className="h-3.5 w-3.5" /> Full Data
            </TabButton>
          </span>
        </div>

        {/* Tab body */}
        <div
          className="flex-1 min-h-0 p-4 overflow-hidden"
          style={{ overscrollBehavior: "contain" }}
        >
          {tab === "summary" ? (
            <SummaryTab brand={brand} view={view} colorBy={colorBy} onClose={onClose} />
          ) : (
            <FullDataTab brand={brand} onClose={onClose} />
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}

function Header({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="flex items-center justify-between px-4 py-3"
      style={{ borderBottom: "1px solid var(--border-card)" }}
    >
      <div className="flex items-center gap-2">
        <span
          className="inline-flex h-7 w-7 items-center justify-center rounded-md"
          style={{ background: "var(--accent-subtle)", color: "var(--accent)" }}
        >
          <DownloadIcon className="h-4 w-4" />
        </span>
        <div>
          <div
            className="text-sm font-display font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            Export Data
          </div>
          <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            Choose a tab and download your data as CSV or XLSX
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        data-tour-close="export-modal"
        className="h-7 w-7 inline-flex items-center justify-center rounded-md transition-colors"
        style={{ color: "var(--text-muted)" }}
      >
        ✕
      </button>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex items-center gap-1.5 px-3 py-2 text-xs font-semibold transition-colors"
      style={{ color: active ? "var(--accent)" : "var(--text-muted)" }}
    >
      {children}
      {active && (
        <span
          className="absolute left-2 right-2 -bottom-px h-[2px] rounded-t"
          style={{ background: "var(--accent)" }}
        />
      )}
    </button>
  );
}

function DownloadIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M8 2v8" />
      <path d="m4.5 7 3.5 3.5L11.5 7" />
      <path d="M2.5 12.5h11" />
    </svg>
  );
}

function TableIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="2" y="3" width="12" height="10" rx="1.6" />
      <line x1="2" y1="6.2" x2="14" y2="6.2" />
      <line x1="2" y1="9.6" x2="14" y2="9.6" />
      <line x1="6" y1="3" x2="6" y2="13" />
      <line x1="10" y1="3" x2="10" y2="13" />
    </svg>
  );
}
