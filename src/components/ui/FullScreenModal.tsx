"use client";
import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";

export const FullScreenModal = React.memo(function FullScreenModal({
  open, onClose, title, children, zIndex = 50, uniformSurface = false, hideHeader = false,
}: {
  open: boolean; onClose: () => void; title?: string; children: React.ReactNode; zIndex?: number;
  /** Use --bg-modal for entire sheet (light white / dark gold) */
  uniformSurface?: boolean;
  /** Children manage their own chrome (title / close) */
  hideHeader?: boolean;
}) {
  const bg = uniformSurface ? "var(--bg-modal)" : "var(--bg-page)";
  const headerBg = uniformSurface ? "var(--bg-modal)" : "var(--bg-card)";
  const borderColor = uniformSurface ? "var(--border-light)" : "var(--border-main)";
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
    <div className="fixed inset-0 flex flex-col"
      style={{ zIndex, background: bg, animation: "fullScreenSlideUp 0.25s var(--ease-out-expo)" }}>
      {!hideHeader && (
        <div className="flex items-center justify-between shrink-0 px-4 py-2.5"
          style={{ borderBottom: `1px solid ${borderColor}`, background: headerBg }}>
          {title && <h2 className="text-[15px] font-bold" style={{ color: "var(--text-heading)" }}>{title}</h2>}
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg cursor-pointer ml-auto shrink-0"
            style={{ color: "var(--text-muted)", background: "transparent", border: "none" }} aria-label="Close">
            <X size={16} />
          </button>
        </div>
      )}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">{children}</div>
    </div>
  );
});
