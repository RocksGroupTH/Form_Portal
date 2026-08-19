"use client";

/**
 * Shared styling primitives for the AP-17 form's field components — kept in one
 * place so TravelBookingTab/TransportSection/WorkLocationList/etc. render a
 * consistent look without each redefining the same inline styles (mirrors the
 * pattern inlined in AP-1's TravelExpenseForm.tsx, factored out here because
 * AP-17 splits the form across many more small components).
 */

import React from "react";
import { Check, Tag } from "lucide-react";

export const inputClass = "w-full rounded-lg px-3 py-2 text-[14px] outline-none";
export const inputStyle: React.CSSProperties = {
  background: "var(--bg-input)",
  color: "var(--text-primary)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border-input)",
};
export const labelClass = "block text-[12px] font-semibold mb-1.5 uppercase tracking-wide";
export const labelStyle: React.CSSProperties = { color: "var(--text-muted)" };
export const requiredStar = (
  <span style={{ color: "var(--color-danger)" }}> *</span>
);

export function errInputStyle(hasError: boolean): React.CSSProperties {
  return hasError
    ? {
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: "var(--color-danger)",
        boxShadow: "0 0 0 1px var(--color-danger)",
      }
    : {};
}

export function errLabelStyle(hasError: boolean): React.CSSProperties {
  return hasError ? { color: "var(--color-danger)" } : labelStyle;
}

/** Section card wrapper — icon + title header, body slot. */
export function SectionCard({
  icon,
  title,
  extra,
  children,
  dataTour,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  extra?: React.ReactNode;
  children: React.ReactNode;
  /** Guided-tour anchor (`[data-tour="ap17-…"]`); omitted on cards the tour skips. */
  dataTour?: string;
}) {
  return (
    <div
      data-tour={dataTour}
      className="w-full min-w-0 rounded-2xl overflow-hidden"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-card)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div
        className="flex items-center gap-2.5 px-5 py-3 rounded-t-2xl"
        style={{ borderBottom: "1px solid var(--border-card)", background: "var(--bg-card-alt)" }}
      >
        <span
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
        >
          {icon}
        </span>
        <h3 className="text-[14px] font-bold flex-1 min-w-0" style={{ color: "var(--text-heading)" }}>
          {title}
        </h3>
        {extra}
      </div>
      <div className="px-5 py-4 flex flex-col gap-4 min-w-0">{children}</div>
    </div>
  );
}

/** Compact inline checkbox pill — used for the 10.1 / 12.1–12.4 / 15.1 booking flags. */
export function CheckboxChip({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold cursor-pointer transition-all select-none disabled:opacity-50 disabled:cursor-not-allowed"
      style={{
        borderWidth: 1.5,
        borderStyle: "solid",
        borderColor: checked ? "var(--nav-active-text)" : "var(--border-card)",
        background: checked ? "var(--nav-active-bg)" : "var(--bg-card-alt)",
        color: checked ? "var(--nav-active-text)" : "var(--text-secondary)",
      }}
    >
      <span
        className="w-4 h-4 rounded flex items-center justify-center shrink-0"
        style={{
          background: checked ? "var(--nav-active-text)" : "var(--bg-card)",
          border: checked ? "none" : "1px solid var(--border-card)",
        }}
      >
        {checked && <Check size={11} color="#fff" />}
      </span>
      {label}
    </button>
  );
}

export function fmtBaht(n: number): string {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export interface CardOption {
  value: string;
  label: string;
  /** Emoji configured in settings; falls back to a neutral icon when absent. */
  icon?: string | null;
  subLabel?: string | null;
}

/**
 * Icon-card single-select — replaces a plain dropdown for the AP-17 option lists
 * (reason / accommodation / vehicle / rent). Shows each option's configured emoji
 * in a responsive card grid; the selected card is highlighted.
 */
export function OptionCardSelect({
  options,
  value,
  onChange,
  hasError,
  columnsClass = "grid-cols-2 sm:grid-cols-3",
}: {
  options: CardOption[];
  value: string;
  onChange: (value: string) => void;
  hasError?: boolean;
  columnsClass?: string;
}) {
  if (options.length === 0) {
    return (
      <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
        — ยังไม่มีตัวเลือก —
      </p>
    );
  }
  return (
    <div className={`grid ${columnsClass} gap-2`}>
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left cursor-pointer transition-all hover:-translate-y-[1px]"
            style={{
              borderWidth: 1.5,
              borderStyle: "solid",
              borderColor: selected
                ? "var(--nav-active-text)"
                : hasError && !value
                  ? "var(--color-danger)"
                  : "var(--border-card)",
              background: selected ? "var(--nav-active-bg)" : "var(--bg-card-alt)",
            }}
          >
            <span
              className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-[19px] leading-none"
              style={{ background: selected ? "var(--bg-card)" : "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
            >
              {o.icon ? <span>{o.icon}</span> : <Tag size={16} />}
            </span>
            <span className="min-w-0 flex flex-col">
              <span
                className="text-[13px] font-semibold truncate"
                style={{ color: selected ? "var(--nav-active-text)" : "var(--text-primary)" }}
              >
                {o.label}
              </span>
              {o.subLabel && (
                <span className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                  {o.subLabel}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
