"use client";
import React, { useEffect, useRef } from "react";
import { Maximize2, Minimize2, X } from "lucide-react";

export const SidePanel = React.memo(function SidePanel({
  open, onClose, width = "65%", children, zIndex = 40,
}: { open: boolean; onClose: () => void; width?: string; children: React.ReactNode; zIndex?: number }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseRef.current(); };
    document.addEventListener("keydown", handler);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", handler); document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div className="app-overlay fixed inset-0" style={{ zIndex }} onClick={onClose} />
      <div className="fixed top-0 right-0 bottom-0 flex flex-col"
        style={{ width, maxWidth: "100vw", zIndex: zIndex + 1, background: "var(--bg-card)",
          borderLeft: "1px solid var(--border-main)", animation: "slideInRight 0.25s ease-out" }}>
        {children}
      </div>
    </>
  );
});

/**
 * Widen / narrow the panel it sits in.
 *
 * Extracted rather than copied when AP-4's accounting queue needed the same
 * control /my-request's drawer already had: the JSX is short enough to
 * duplicate and the LABELS are the part that drifts — one panel saying
 * "ขยายเต็มความกว้าง" while another says something else, for the same gesture,
 * is how two screens stop feeling like one app.
 *
 * The width itself stays with the caller. A panel showing a fourteen-column
 * table wants a different wide than one showing a form, and `SidePanel` takes
 * a `width` for exactly that reason.
 *
 * Sits beside `SidePanelClose` because both act on the PANEL rather than on
 * whatever it contains.
 */
export const SidePanelExpand = React.memo(function SidePanelExpand({
  wide,
  onToggle,
}: {
  wide: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      aria-pressed={wide}
      aria-label={wide ? "ย่อกล่องรายละเอียดกลับ" : "ขยายกล่องรายละเอียด"}
      title={wide ? "ย่อกลับ" : "ขยายเต็มความกว้าง"}
      className="w-6 h-6 flex items-center justify-center rounded-md cursor-pointer shrink-0"
      style={{ color: "var(--text-muted)", background: "transparent", border: "none" }}
    >
      {wide ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
    </button>
  );
});

export const SidePanelClose = React.memo(function SidePanelClose({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-6 h-6 flex items-center justify-center rounded-md cursor-pointer shrink-0"
      style={{ color: "var(--text-muted)", background: "transparent", border: "none" }} aria-label="Close panel">
      <X size={14} />
    </button>
  );
});
