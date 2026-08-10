"use client";

import { useState } from "react";
import { ColorByKey, ViewKey } from "@/features/intelligence/master/types";
import { ExportModal } from "@/features/intelligence/master/components/export/ExportModal";

interface Props {
  brand: string;
  view: ViewKey;
  colorBy: ColorByKey;
}

/**
 * Trigger that opens the full Export dialog. The button itself is intentionally
 * compact — it lives in the LeftRail as a standalone action card so the user
 * always knows where to click without crowding the rest of the chrome.
 */
export function ExportButton({ brand, view, colorBy }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex w-full items-center justify-center gap-1.5 h-8 rounded-md text-[12px] font-semibold tracking-wide uppercase transition-colors"
        style={{
          border: "1px solid var(--accent)",
          background: "var(--accent-subtle)",
          color: "var(--accent)",
        }}
      >
        <DownloadIcon className="h-3.5 w-3.5" />
        Export Data
      </button>
      <ExportModal
        brand={brand}
        open={open}
        onClose={() => setOpen(false)}
        view={view}
        colorBy={colorBy}
      />
    </>
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
