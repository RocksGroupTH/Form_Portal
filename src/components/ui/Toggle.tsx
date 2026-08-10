"use client";

import React from "react";

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

/**
 * Switch-style toggle with a large, full-row hit area — easier to tap than a
 * bare checkbox. Use for boolean settings.
 */
export function Toggle({ checked, onChange, label, description, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className="w-full flex items-center justify-between gap-3 rounded-xl px-3.5 py-3 text-left transition-colors select-none"
      style={{
        background: checked ? "var(--nav-active-bg)" : "var(--bg-card-alt)",
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: checked ? "var(--nav-active-text)" : "var(--border-card)",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <span className="flex flex-col min-w-0">
        <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
          {label}
        </span>
        {description && (
          <span className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
            {description}
          </span>
        )}
      </span>
      <span
        className="relative shrink-0 rounded-full transition-colors"
        aria-hidden
        style={{ width: 42, height: 24, background: checked ? "var(--color-action)" : "var(--border-input)" }}
      >
        <span
          className="absolute rounded-full transition-all"
          style={{
            width: 18,
            height: 18,
            top: 3,
            left: checked ? 21 : 3,
            background: "#fff",
            boxShadow: "0 1px 2px rgba(0,0,0,.35)",
          }}
        />
      </span>
    </button>
  );
}
