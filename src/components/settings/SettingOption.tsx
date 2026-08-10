"use client";

import React from "react";
import { CheckSquare, Square } from "lucide-react";
import { Toggle } from "@/components/ui/Toggle";

export interface SettingOptionProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  /** `switch` = toggle on the right; `checkbox` = check icon on the left */
  variant?: "switch" | "checkbox";
  /** Checkbox row highlight: saved = green, pending = yellow (unsaved change) */
  rowStatus?: "default" | "saved" | "pending";
  leading?: React.ReactNode;
}

/** Boolean setting row with label + description — switch or checkbox style. */
export function SettingOption({
  checked,
  onChange,
  label,
  description,
  disabled,
  variant = "switch",
  rowStatus = "default",
  leading,
}: SettingOptionProps) {
  if (variant === "switch") {
    return (
      <Toggle
        checked={checked}
        onChange={onChange}
        label={label}
        description={description}
        disabled={disabled}
      />
    );
  }

  const rowBg =
    rowStatus === "pending"
      ? "var(--bg-info-yellow)"
      : rowStatus === "saved"
        ? "var(--bg-info-green)"
        : checked
          ? "var(--nav-active-bg)"
          : "var(--bg-card-alt)";
  const rowBorder =
    rowStatus === "pending"
      ? "var(--border-info-yellow)"
      : rowStatus === "saved"
        ? "var(--border-info-green)"
        : checked
          ? "color-mix(in srgb, var(--nav-active-text) 30%, var(--border-card))"
          : "var(--border-card)";
  const iconColor =
    rowStatus === "pending"
      ? "var(--text-info-yellow)"
      : rowStatus === "saved"
        ? "var(--text-info-green)"
        : checked
          ? "var(--nav-active-text)"
          : "var(--text-muted)";

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className="w-full flex items-start gap-3 rounded-xl px-3.5 py-3 text-left transition-colors select-none border-none"
      style={{
        background: rowBg,
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: rowBorder,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {leading && <span className="shrink-0 mt-0.5">{leading}</span>}
      <span className="shrink-0 mt-0.5" style={{ color: iconColor }}>
        {checked ? <CheckSquare size={20} /> : <Square size={20} />}
      </span>
      <span className="flex flex-col min-w-0 flex-1">
        <span className="text-[13px] font-semibold leading-snug" style={{ color: "var(--text-primary)" }}>
          {label}
        </span>
        {description && (
          <span className="text-[11px] mt-0.5 leading-relaxed" style={{ color: "var(--text-muted)" }}>
            {description}
          </span>
        )}
      </span>
    </button>
  );
}

export function SettingOptionGroup({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide m-0" style={{ color: "var(--text-muted)" }}>
          {title}
        </p>
        {description && (
          <p className="text-[11px] m-0 mt-0.5 leading-relaxed" style={{ color: "var(--text-faint)" }}>
            {description}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}
