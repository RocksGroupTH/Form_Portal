"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { X, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";

interface ImageLightboxProps {
  open: boolean;
  src: string;
  alt?: string;
  onClose: () => void;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const STEP = 0.5;

/** Full-screen image viewer with zoom (buttons + wheel) and drag-to-pan. */
export function ImageLightbox({ open, src, alt, onClose }: ImageLightboxProps) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  const reset = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  // Reset transform each time a new image opens.
  useEffect(() => {
    if (open) reset();
  }, [open, src, reset]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

  const zoomBy = (delta: number) => {
    setZoom((z) => {
      const next = clampZoom(z + delta);
      if (next === 1) setOffset({ x: 0, y: 0 });
      return next;
    });
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? STEP : -STEP);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (zoom <= 1) return;
    dragging.current = true;
    last.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - last.current.x;
    const dy = e.clientY - last.current.y;
    last.current = { x: e.clientX, y: e.clientY };
    setOffset((o) => ({ x: o.x + dx, y: o.y + dy }));
  };

  const onPointerUp = () => {
    dragging.current = false;
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.85)", animation: "overlayFadeIn 0.15s ease-out" }}
      onClick={onClose}
    >
      {/* Toolbar — sits on its own dark pill: once zoomed, the image covers the backdrop and
          white-on-white controls would otherwise vanish over a light picture. */}
      <div
        className="absolute top-4 right-4 flex items-center gap-1.5 z-[2] rounded-2xl px-2 py-1.5"
        style={{
          background: "rgba(18,18,18,0.72)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          border: "1px solid rgba(255,255,255,0.14)",
          boxShadow: "0 6px 24px rgba(0,0,0,0.45)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <ToolBtn label="ซูมออก" onClick={() => zoomBy(-STEP)} disabled={zoom <= MIN_ZOOM}>
          <ZoomOut size={18} />
        </ToolBtn>
        <span
          className="text-[12px] font-bold tabular-nums px-2 select-none"
          style={{ color: "rgba(255,255,255,0.85)", minWidth: 44, textAlign: "center" }}
        >
          {Math.round(zoom * 100)}%
        </span>
        <ToolBtn label="ซูมเข้า" onClick={() => zoomBy(STEP)} disabled={zoom >= MAX_ZOOM}>
          <ZoomIn size={18} />
        </ToolBtn>
        <ToolBtn label="รีเซ็ต" onClick={reset} disabled={zoom === 1 && offset.x === 0 && offset.y === 0}>
          <RotateCcw size={16} />
        </ToolBtn>
        <ToolBtn label="ปิด" onClick={onClose}>
          <X size={18} />
        </ToolBtn>
      </div>

      {/* Image */}
      <img
        src={src}
        alt={alt ?? ""}
        draggable={false}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={() => (zoom > 1 ? reset() : zoomBy(STEP * 3))}
        style={{
          maxWidth: "92vw",
          maxHeight: "88vh",
          objectFit: "contain",
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          transition: dragging.current ? "none" : "transform 0.12s ease-out",
          cursor: zoom > 1 ? "grab" : "zoom-in",
          touchAction: "none",
          userSelect: "none",
          borderRadius: 8,
          boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
        }}
      />
    </div>
  );
}

function ToolBtn({
  children, onClick, label, disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer border-none transition-opacity"
      style={{
        background: "rgba(255,255,255,0.16)",
        color: "#fff",
        opacity: disabled ? 0.35 : 1,
      }}
    >
      {children}
    </button>
  );
}
