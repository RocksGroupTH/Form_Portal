"use client";
import React, { useEffect, useRef } from "react";
import { X } from "lucide-react";

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

export const SidePanelClose = React.memo(function SidePanelClose({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-6 h-6 flex items-center justify-center rounded-md cursor-pointer shrink-0"
      style={{ color: "var(--text-muted)", background: "transparent", border: "none" }} aria-label="Close panel">
      <X size={14} />
    </button>
  );
});
