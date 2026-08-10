"use client";
import React from "react";

export const Badge = React.memo(function Badge({
  label, color, bg, border, small,
}: { label: string; color: string; bg?: string; border?: string; small?: boolean }) {
  return (
    <span
      className={`inline-block font-bold rounded-lg whitespace-nowrap text-center gold-badge-glow transition-shadow ${
        small ? "text-[11px] px-2 py-[2px]" : "text-[12px] px-2.5 py-0.5"
      }`}
      style={{
        backgroundColor: bg ?? `${color}12`,
        border: border ?? `1px solid ${color}35`,
        color,
      }}
    >
      {label.trim()}
    </span>
  );
});
