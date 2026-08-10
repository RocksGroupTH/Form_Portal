"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";

/**
 * Shared back control — an affordant chip (surface + border + hover nudge) so it
 * reads as a button, not a floating glyph. Used by PageHeaderBar and by dense
 * pages (reports/dashboards) that keep their own compact header layout.
 * Renders a `<Link>` when `href` is given, else a `<button>` calling `onClick`.
 */
export function BackButton({
  href,
  onClick,
  label = "กลับ",
}: {
  href?: string;
  onClick?: () => void;
  label?: string;
}) {
  const className =
    "page-back-btn group w-9 h-9 rounded-full flex items-center justify-center shrink-0 no-underline cursor-pointer";
  const style: React.CSSProperties = {
    color: "var(--text-muted)",
    background: "var(--bg-badge)",
    border: "none",
  };
  const icon = (
    <ChevronLeft size={18} className="transition-transform duration-150 group-hover:-translate-x-0.5" />
  );

  if (href) {
    return (
      <Link href={href} className={className} style={style} title={label} aria-label={label}>
        {icon}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className} style={style} title={label} aria-label={label}>
      {icon}
    </button>
  );
}
