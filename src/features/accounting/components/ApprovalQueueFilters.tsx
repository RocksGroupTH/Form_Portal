"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ChevronDown } from "lucide-react";
import { FilterDateRangePicker } from "@/features/accounting/components/FilterDateRangePicker";
import { reportVehicleNames } from "@/features/accounting/lib/travel-sections";

export interface QueueFilters {
  requestNo: string;
  submittedFrom: string;
  submittedTo: string;
  requesterFullName: string;
  departmentNames: string[];
  brandCodes: string[];
  travelFrom: string;
  travelTo: string;
  vehicleNames: string[];
}

export const MULTI_SELECT_NONE = "__MULTI_SELECT_NONE__";

export function isMultiSelectAll(selected: string[]): boolean {
  return selected.length === 0;
}

export function isMultiSelectNone(selected: string[]): boolean {
  return selected.length === 1 && selected[0] === MULTI_SELECT_NONE;
}

export function isMultiSelectActive(selected: string[]): boolean {
  return !isMultiSelectAll(selected);
}

export function matchesMultiSelectValue(
  value: string | null | undefined,
  selected: string[],
): boolean {
  if (isMultiSelectAll(selected)) return true;
  if (isMultiSelectNone(selected)) return false;
  if (!value) return false;
  return selected.includes(value);
}

export function matchesMultiSelectAny(values: string[], selected: string[]): boolean {
  if (isMultiSelectAll(selected)) return true;
  if (isMultiSelectNone(selected)) return false;
  return values.some((v) => selected.includes(v));
}

export const EMPTY_QUEUE_FILTERS: QueueFilters = {
  requestNo: "",
  submittedFrom: "",
  submittedTo: "",
  requesterFullName: "",
  departmentNames: [],
  brandCodes: [],
  travelFrom: "",
  travelTo: "",
  vehicleNames: [],
};

export const filterInputCls = "w-full text-[12px] px-2.5 py-2 rounded-lg outline-none";
export const filterInputStyle: React.CSSProperties = {
  background: "var(--bg-input)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-input)",
};

export function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

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

export function fmtDateOnly(raw: string | null | undefined): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/** YYYY-MM from ERP interface sent timestamp (local calendar month). */
export function sentMonthKey(sentAt: string | null | undefined): string | null {
  if (!sentAt) return null;
  const d = new Date(sentAt);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export { fmtSentMonthLabel } from "@/features/accounting/components/FilterMonthPicker";

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="block text-[10px] font-semibold mb-1"
      style={{ color: "var(--text-muted)" }}
    >
      {children}
    </span>
  );
}

function matchText(term: string, value: string | null | undefined): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  return (value ?? "").toLowerCase().includes(q);
}

function toYmd(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function inDateRange(value: string | null | undefined, from: string, to: string): boolean {
  const ymd = toYmd(value);
  if (!ymd) return !from && !to;
  if (from && ymd < from) return false;
  if (to && ymd > to) return false;
  return true;
}

export function hasQueueFilters(f: QueueFilters): boolean {
  return (
    f.requestNo.trim() !== "" ||
    !!f.submittedFrom ||
    !!f.submittedTo ||
    f.requesterFullName.trim() !== "" ||
    isMultiSelectActive(f.departmentNames) ||
    isMultiSelectActive(f.brandCodes) ||
    !!f.travelFrom ||
    !!f.travelTo ||
    isMultiSelectActive(f.vehicleNames)
  );
}

export interface QueueFilterableRow {
  requestNo: string | null;
  submittedAt: string | null;
  requesterFullName: string | null;
  requesterDepartmentName: string | null;
  brandCode: string | null;
  travelDate: string | null;
  travelDates?: string[];
  vehicleName: string | null;
  vehicleNames?: string[];
}

function matchesTravelDateRange(
  row: QueueFilterableRow,
  from: string,
  to: string,
): boolean {
  if (!from && !to) return true;
  const dates = row.travelDates && row.travelDates.length > 0
    ? row.travelDates
    : row.travelDate
      ? [row.travelDate]
      : [];
  if (dates.length === 0) return !from && !to;
  return dates.some((d) => inDateRange(d, from, to));
}

export function applyQueueFilters<T extends QueueFilterableRow>(rows: T[], filters: QueueFilters): T[] {
  return rows.filter((r) => {
    if (!matchText(filters.requestNo, r.requestNo)) return false;
    if (!inDateRange(r.submittedAt, filters.submittedFrom, filters.submittedTo)) return false;
    if (!matchText(filters.requesterFullName, r.requesterFullName)) return false;
    if (!matchesMultiSelectValue(r.requesterDepartmentName, filters.departmentNames)) {
      return false;
    }
    if (!matchesMultiSelectValue(r.brandCode, filters.brandCodes)) {
      return false;
    }
    if (!matchesTravelDateRange(r, filters.travelFrom, filters.travelTo)) return false;
    if (!matchesMultiSelectAny(reportVehicleNames(r), filters.vehicleNames)) {
      return false;
    }
    return true;
  });
}

function MultiSelectFilter({
  label,
  options,
  selected,
  onChange,
  formatLabel,
  allLabel = "ทั้งหมด",
  noneLabel = "ไม่ได้เลือก",
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  formatLabel?: (value: string) => string;
  allLabel?: string;
  noneLabel?: string;
}) {
  const labelOf = formatLabel ?? ((v: string) => v);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const allSelected = isMultiSelectAll(selected);
  const noneSelected = isMultiSelectNone(selected);

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    function place() {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.max(r.width, 160);
      let left = r.left;
      const overflow = left + width - window.innerWidth + 8;
      if (overflow > 0) left = Math.max(8, left - overflow);
      const panelHeight = 224;
      let top = r.bottom + 4;
      if (top + panelHeight > window.innerHeight - 8) {
        top = Math.max(8, r.top - panelHeight - 4);
      }
      setCoords({ top, left, width });
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function toggleAll() {
    if (allSelected) {
      onChange([MULTI_SELECT_NONE]);
      return;
    }
    onChange([]);
  }

  function toggle(opt: string) {
    if (allSelected) {
      onChange(options.filter((o) => o !== opt));
      return;
    }
    if (noneSelected) {
      onChange([opt]);
      return;
    }
    if (selected.includes(opt)) {
      const next = selected.filter((s) => s !== opt);
      onChange(next.length === 0 ? [MULTI_SELECT_NONE] : next);
      return;
    }
    const next = Array.from(new Set([...selected, opt])).sort();
    if (options.length > 0 && next.length === options.length) {
      onChange([]);
      return;
    }
    onChange(next);
  }

  const summary = allSelected
    ? allLabel
    : noneSelected
      ? noneLabel
      : selected.length === 1
        ? labelOf(selected[0])
        : `${labelOf(selected[0])} +${selected.length - 1}`;

  const dropdownPanel =
    open && coords ? (
      <div
        ref={panelRef}
        className="rounded-lg py-1 max-h-56 overflow-y-auto no-scrollbar"
        style={{
          position: "fixed",
          top: coords.top,
          left: coords.left,
          width: coords.width,
          zIndex: 9999,
          background: "var(--bg-dropdown)",
          border: "1px solid var(--border-main)",
          boxShadow: "var(--shadow-md)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <label
          className="flex items-center gap-2.5 px-3 py-2 cursor-pointer text-[12px] font-semibold sticky top-0"
          style={{
            color: allSelected ? "var(--nav-active-text)" : "var(--text-primary)",
            background: allSelected ? "var(--nav-active-bg)" : "var(--bg-dropdown)",
            borderBottom: "1px solid var(--border-light)",
          }}
        >
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            className="shrink-0"
            style={{ accentColor: "var(--nav-active-text)" }}
          />
          <span>{allLabel}</span>
        </label>
        {options.length === 0 ? (
          <p className="px-3 py-2 text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
            ไม่มีข้อมูล
          </p>
        ) : (
          options.map((opt) => {
            const checked = allSelected || selected.includes(opt);
            return (
              <label
                key={opt}
                className="flex items-center gap-2.5 px-3 py-2 cursor-pointer text-[12px] hover:opacity-90"
                style={{
                  color: "var(--text-primary)",
                  background: checked
                    ? "color-mix(in srgb, var(--nav-active-bg) 50%, transparent)"
                    : undefined,
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(opt)}
                  className="shrink-0"
                  style={{ accentColor: "var(--nav-active-text)" }}
                />
                <span className="truncate">{labelOf(opt)}</span>
              </label>
            );
          })
        )}
      </div>
    ) : null;

  return (
    <div className="relative min-w-0">
      <FilterLabel>{label}</FilterLabel>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`${filterInputCls} flex items-center justify-between gap-2 cursor-pointer`}
        style={{
          ...filterInputStyle,
          borderColor: allSelected
            ? "var(--border-input)"
            : noneSelected
              ? "var(--border-input)"
              : "var(--nav-active-text)",
        }}
        aria-expanded={open}
      >
        <span
          className="truncate text-left"
          style={{ color: allSelected || noneSelected ? "var(--text-muted)" : "var(--text-primary)" }}
        >
          {summary}
        </span>
        <ChevronDown
          size={14}
          className="shrink-0 transition-transform"
          style={{
            color: "var(--text-muted)",
            transform: open ? "rotate(180deg)" : undefined,
          }}
        />
      </button>
      {mounted && dropdownPanel ? createPortal(dropdownPanel, document.body) : null}
    </div>
  );
}

export { MultiSelectFilter };

export function CellTruncate({
  text,
  className = "",
  style,
  maxWidth = 140,
}: {
  text: string | null | undefined;
  className?: string;
  style?: React.CSSProperties;
  maxWidth?: number;
}) {
  if (!text?.trim()) {
    return <span style={{ color: "var(--text-faint)" }}>—</span>;
  }
  const value = text.trim();
  return (
    <span
      className={`block truncate ${className}`}
      style={{ maxWidth, color: "var(--text-secondary)", ...style }}
      title={value}
    >
      {value}
    </span>
  );
}

interface ApprovalQueueFiltersProps {
  filters: QueueFilters;
  onChange: (next: QueueFilters) => void;
  brandOptions: string[];
  departmentOptions: string[];
  vehicleOptions: string[];
  /** Hide submission/travel date pickers (use primary period filter elsewhere). */
  hideDateFilters?: boolean;
  /** Extra filter fields rendered after vehicle (e.g. prep status, payment date). */
  trailing?: React.ReactNode;
}

export function ApprovalQueueFilters({
  filters,
  onChange,
  brandOptions,
  departmentOptions,
  vehicleOptions,
  hideDateFilters = false,
  trailing,
}: ApprovalQueueFiltersProps) {
  function setFilter<K extends keyof QueueFilters>(key: K, value: QueueFilters[K]) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 pt-3"
      style={{ borderTop: "1px solid var(--border-light)" }}
    >
      <div className="min-w-0">
        <FilterLabel>เลขที่</FilterLabel>
        <input
          type="text"
          value={filters.requestNo}
          onChange={(e) => setFilter("requestNo", e.target.value)}
          placeholder="ค้นหาเลขที่..."
          className={filterInputCls}
          style={filterInputStyle}
        />
      </div>

      {!hideDateFilters && (
        <FilterDateRangePicker
          label="วันที่ส่ง"
          from={filters.submittedFrom}
          to={filters.submittedTo}
          onChange={(from, to) => onChange({ ...filters, submittedFrom: from, submittedTo: to })}
        />
      )}

      <div className="min-w-0">
        <FilterLabel>ผู้ขอ</FilterLabel>
        <input
          type="text"
          value={filters.requesterFullName}
          onChange={(e) => setFilter("requesterFullName", e.target.value)}
          placeholder="ชื่อผู้ขอ..."
          className={filterInputCls}
          style={filterInputStyle}
        />
      </div>

      <MultiSelectFilter
        label="แผนก"
        options={departmentOptions}
        selected={filters.departmentNames}
        onChange={(v) => setFilter("departmentNames", v)}
      />

      <MultiSelectFilter
        label="แบรนด์"
        options={brandOptions}
        selected={filters.brandCodes}
        onChange={(v) => setFilter("brandCodes", v)}
      />

      {!hideDateFilters && (
        <FilterDateRangePicker
          label="วันเดินทาง"
          from={filters.travelFrom}
          to={filters.travelTo}
          onChange={(from, to) => onChange({ ...filters, travelFrom: from, travelTo: to })}
        />
      )}

      <MultiSelectFilter
        label="ยานพาหนะ"
        options={vehicleOptions}
        selected={filters.vehicleNames}
        onChange={(v) => setFilter("vehicleNames", v)}
      />

      {trailing}
    </div>
  );
}

interface QueueToolbarProps {
  countLabel: string;
  filteredCount: number;
  totalCount: number;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  extra?: React.ReactNode;
}

export function QueueToolbar({
  countLabel,
  filteredCount,
  totalCount,
  hasActiveFilters,
  onClearFilters,
  extra,
}: QueueToolbarProps) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span
        className="text-[11px] font-medium px-2.5 py-1 rounded-full"
        style={{
          background: "var(--bg-info-yellow)",
          color: "var(--text-info-yellow)",
          border: "1px solid var(--border-info-yellow)",
        }}
      >
        {countLabel} {filteredCount}
        {hasActiveFilters ? ` / ${totalCount}` : ""} รายการ
      </span>
      {extra}
      {hasActiveFilters && (
        <button
          type="button"
          onClick={onClearFilters}
          className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-lg cursor-pointer"
          style={{
            color: "var(--text-muted)",
            background: "var(--bg-card-alt)",
            border: "1px solid var(--border-card)",
          }}
        >
          <X size={12} />
          ล้างตัวกรอง
        </button>
      )}
    </div>
  );
}
