"use client";

import { Loader2 } from "lucide-react";

/**
 * Compact switch — a real control, for a cell or a toolbar.
 *
 * `Toggle` is the full-row settings switch: it fills its container, carries a
 * label and a description, and is right for a settings panel. This is the other
 * half — small enough for a table cell, where AP-11's reward catalogue had been
 * drawing lucide's `ToggleLeft` / `ToggleRight` glyphs instead. Those are
 * pictures of a switch: no `role`, no `aria-checked`, no focus ring, no hit area
 * beyond the 16px icon, and nothing at all to say a click is in flight.
 *
 * The markup follows the switch already shipping in Settings → Form Environment
 * (`FormEnvironmentSettings.tsx`), which shares the `.ui-switch` focus rule in
 * `globals.css` — an inline style cannot express `:focus-visible`, and the ring
 * has to follow the theme.
 *
 * Track and knob are both `currentColor` at different alphas, so a caller
 * changes the whole control by setting one colour — success when on, muted when
 * off — without naming a second token that would then need checking in both
 * themes.
 *
 * `pending` is not cosmetic. A switch that writes to a server and does not say
 * so invites a second click, and two clicks on the same row are two PATCHes
 * whose order nobody controls.
 */
interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /**
   * Accessible name — always announced, and always distinct enough to identify
   * *which* row this is ("สถานะ บัตรกำนัล 500"). The visible words beside the
   * track only say on or off, which a screen reader alone cannot place.
   */
  label: string;
  /** Words beside the track. Omit both to render the track on its own. */
  onText?: string;
  offText?: string;
  /** `sm` for a table cell, `md` for a toolbar or a form row. */
  size?: "sm" | "md";
  disabled?: boolean;
  /** A write is in flight: the state word becomes a spinner and clicks stop. */
  pending?: boolean;
  /**
   * Colour when on. Defaults to `--status-ok-text`, which is the theme-aware
   * green (#3d8560 light, #7cc4a0 dark). Not `--text-success` — that token is
   * undefined, so the reward table's "ใช้งาน" had been inheriting the row's
   * colour and rendering grey while claiming to be green.
   */
  onColor?: string;
  className?: string;
}

const SIZES = {
  sm: { track: 26, height: 15, knob: 11, text: "text-[11.5px]", pad: "py-0.5 pl-0.5 pr-2", gap: "gap-1.5", spinner: 11 },
  md: { track: 32, height: 18, knob: 14, text: "text-[12.5px]", pad: "py-1 pl-1 pr-2.5", gap: "gap-2", spinner: 13 },
} as const;

export function Switch({
  checked,
  onChange,
  label,
  onText,
  offText,
  size = "sm",
  disabled,
  pending,
  onColor = "var(--status-ok-text)",
  className = "",
}: SwitchProps) {
  const s = SIZES[size];
  const locked = disabled || pending;
  const word = checked ? onText : offText;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={pending || undefined}
      disabled={locked}
      onClick={() => !locked && onChange(!checked)}
      className={`ui-switch inline-flex items-center ${s.gap} ${s.pad} ${s.text} font-bold rounded-full border-none whitespace-nowrap transition-colors enabled:cursor-pointer disabled:cursor-default ${className}`}
      style={{
        background: "var(--bg-badge)",
        color: checked ? onColor : "var(--text-muted)",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        aria-hidden
        className="relative inline-block shrink-0 rounded-full"
        style={{
          width: s.track,
          height: s.height,
          background: "color-mix(in srgb, currentColor 25%, transparent)",
        }}
      >
        <span
          className="absolute rounded-full transition-transform"
          style={{
            width: s.knob,
            height: s.knob,
            top: (s.height - s.knob) / 2,
            left: (s.height - s.knob) / 2,
            background: "currentColor",
            transform: checked ? `translateX(${s.track - s.knob - (s.height - s.knob)}px)` : "translateX(0)",
          }}
        />
      </span>
      {pending ? (
        <Loader2 size={s.spinner} className="animate-spin" />
      ) : (
        word && <span>{word}</span>
      )}
    </button>
  );
}
