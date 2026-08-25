"use client";

/**
 * Shared building blocks for the two AP-3 (Clear Advance) report pages.
 * Kept intentionally lean — filter primitives, a friendly forbidden state,
 * a brands loader hook, and the money/date formatters both tables use.
 *
 * Money: toLocaleString. Dates: local getters (never toISOString for display).
 * CSS: var(--…) only. Icons: lucide. API shape: { ok, data } | { ok, error }.
 */

import React, { useEffect, useState } from "react";
import { Lock } from "lucide-react";

/* ─────────────── formatters ─────────────── */

export function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Format an ISO/date string with local getters (server is Thai time). */
export function fmtDateTime(raw: string | null | undefined): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

/** Format a date-only value (ISO or "YYYY-MM-DD") with local getters. */
export function fmtDateOnly(raw: string | null | undefined): string {
  if (!raw) return "—";
  // "YYYY-MM-DD" from the service — render directly to avoid TZ drift.
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (ymd) return `${ymd[3]}/${ymd[2]}/${ymd[1]}`;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/* ─────────────── filter input styles (mirror ApprovalQueueFilters) ─────────────── */

export const filterInputCls = "w-full text-[12px] px-2.5 py-2 rounded-lg outline-none";
export const filterInputStyle: React.CSSProperties = {
  background: "var(--bg-input)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-input)",
};

export function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-[10px] font-semibold mb-1" style={{ color: "var(--text-muted)" }}>
      {children}
    </span>
  );
}

export function TextFilter({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: "text" | "number";
}) {
  return (
    <div className="min-w-0">
      <FilterLabel>{label}</FilterLabel>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={filterInputCls}
        style={filterInputStyle}
      />
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export function SelectFilter({
  label,
  value,
  onChange,
  options,
  anyLabel = "ทั้งหมด",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  anyLabel?: string;
}) {
  return (
    <div className="min-w-0">
      <FilterLabel>{label}</FilterLabel>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={filterInputCls}
        style={{ ...filterInputStyle, cursor: "pointer" }}
      >
        <option value="">{anyLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Card shell wrapping the collapsible-free filter bar used on both reports. */
export function FilterBar({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl p-3 sm:p-4 mb-4"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-end">
        {children}
      </div>
    </div>
  );
}

/* ─────────────── friendly 403 state ─────────────── */

export function ForbiddenState() {
  return (
    <div
      className="rounded-xl p-8 flex flex-col items-center gap-3 text-center"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
    >
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center"
        style={{ background: "var(--nav-active-bg)" }}
      >
        <Lock size={22} style={{ color: "var(--nav-active-text)" }} />
      </div>
      <p className="text-[14px] font-semibold m-0" style={{ color: "var(--text-heading)" }}>
        ไม่มีสิทธิ์เข้าถึงรายงานนี้
      </p>
      <p className="text-[12px] m-0 max-w-sm" style={{ color: "var(--text-muted)" }}>
        รายงานนี้สำหรับทีมบัญชีเท่านั้น หากต้องการสิทธิ์เข้าถึง กรุณาติดต่อผู้ดูแลระบบ
      </p>
    </div>
  );
}

/* ─────────────── brands loader ─────────────── */

export interface BrandOption {
  brandCode: string;
  brandName: string;
}

/** Load AP-3 brand options once. Silent on failure — filter just shows none. */
export function useClrBrands(): BrandOption[] {
  const [brands, setBrands] = useState<BrandOption[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/request/clear-advance/options/brands")
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: BrandOption[] }) => {
        if (cancelled) return;
        if (json.ok && json.data) setBrands(json.data);
      })
      .catch(() => {
        /* leave empty */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return brands;
}

/** Build a URLSearchParams string from a filter record, dropping empties. */
export function buildQuery(params: Record<string, string | null | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && String(v).trim() !== "") qs.set(k, String(v).trim());
  }
  return qs.toString();
}
