"use client";

import { useState } from "react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

/**
 * Navigation "menu card" with a consistent hover/focus affordance across the
 * app: accent border + soft focus ring + a slight lift (no hover arrow).
 * Renders a `<Link>` when `href` is given, or a `<button>` when `onClick` is
 * given (e.g. a card that opens a modal). Pass layout/padding via `className`
 * (e.g. "p-5") and base colors via `style`; the interactive border/shadow/
 * transform are applied on top.
 */
export function HoverCard({
  href,
  onClick,
  children,
  className = "",
  style,
}: {
  href?: string;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const [active, setActive] = useState(false);

  const mergedStyle: CSSProperties = {
    background: "var(--bg-card)",
    borderWidth: 1,
    borderStyle: "solid",
    ...style,
    borderColor: active ? "var(--nav-active-text)" : (style?.borderColor ?? "var(--border-card)"),
    boxShadow: active
      ? "0 0 0 3px var(--nav-active-bg), var(--shadow-sm)"
      : (style?.boxShadow ?? "var(--shadow-sm)"),
    transform: active ? "translateY(-3px)" : "translateY(0)",
  };

  const handlers = {
    onMouseEnter: () => setActive(true),
    onMouseLeave: () => setActive(false),
    onFocus: () => setActive(true),
    onBlur: () => setActive(false),
  };

  const base = "rounded-xl no-underline transition-all outline-none";

  if (href) {
    return (
      <Link href={href} className={`${base} ${className}`} style={mergedStyle} {...handlers}>
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} text-left w-full cursor-pointer ${className}`}
      style={mergedStyle}
      {...handlers}
    >
      {children}
    </button>
  );
}
