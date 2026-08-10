"use client";

import { BackButton } from "@/components/layout/BackButton";
import type React from "react";

type IconType = React.ComponentType<{ size?: number; style?: React.CSSProperties }>;

interface PageHeaderBarProps {
  /** Leading icon for the title tile */
  icon: IconType;
  title: string;
  subtitle?: string;
  /** Inline content rendered after the title (badges, status chips) */
  titleExtra?: React.ReactNode;
  /** Static destination — renders a Link */
  backHref?: string;
  /** Dynamic back navigation — renders a button calling this */
  onBack?: () => void;
  backLabel?: string;
  /** Right-aligned content (e.g. brand chip) */
  right?: React.ReactNode;
  /** Guided-tour spotlight target */
  dataTour?: string;
}

/**
 * Shared page header bar: back control + icon tile + title/subtitle + right slot.
 * The back control is a clearly-affordant chip (surface, border, hover) so it
 * reads as a button, not a floating glyph.
 */
export function PageHeaderBar({
  icon: Icon,
  title,
  subtitle,
  titleExtra,
  backHref,
  onBack,
  backLabel = "กลับ",
  right,
  dataTour,
}: PageHeaderBarProps) {
  return (
    <div
      data-tour={dataTour}
      className="flex items-center gap-3 rounded-2xl px-4 py-3 mb-6 min-w-0"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-card)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      {backHref ? (
        <BackButton href={backHref} label={backLabel} />
      ) : onBack ? (
        <BackButton onClick={onBack} label={backLabel} />
      ) : null}

      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: "var(--nav-active-bg)" }}
      >
        <Icon size={20} style={{ color: "var(--nav-active-text)" }} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-[20px] font-bold leading-tight" style={{ color: "var(--text-heading)" }}>
            {title}
          </h1>
          {titleExtra}
        </div>
        {subtitle && (
          <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
            {subtitle}
          </p>
        )}
      </div>

      {right && <div className="shrink-0">{right}</div>}
    </div>
  );
}
