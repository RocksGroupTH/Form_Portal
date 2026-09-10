"use client";

import { RotateCcw } from "lucide-react";
import {
  MultiSelectFilter,
  filterInputCls,
  filterInputStyle,
} from "@/features/accounting/components/ApprovalQueueFilters";
import {
  EMPTY_REIMBURSE_QUEUE_FILTERS,
  hasReimburseQueueFilters,
  type ReimburseQueueFilters,
} from "@/features/reimburse/lib/queue-filters";

/**
 * The filter bar over AP-4's accounting queue.
 *
 * **Five controls, not AP-1's eight.** `ApprovalQueueFilters` is not reused
 * whole because three of its fields — วันเดินทาง (from/to) and ยานพาหนะ — read
 * columns a receipt reimbursement does not have. A control that filters nothing
 * is worse than an absent one: somebody sets it, the list does not change, and
 * they conclude the list is right.
 *
 * What *is* reused is everything that decides meaning: `MultiSelectFilter`
 * itself, so แผนก and แบรนด์ behave identically on both screens including the
 * all-versus-none distinction, and `filterInputCls` / `filterInputStyle`, so the
 * two bars cannot drift apart visually. The matching lives in
 * `queue-filters.ts`, which is pure and tested.
 *
 * The options are derived from the rows in view rather than from a master list:
 * a department nobody has a pending claim in is a filter that can only ever
 * return nothing.
 */
export function ReimburseQueueFilterBar({
  filters,
  onChange,
  departmentOptions,
  brandOptions,
}: {
  filters: ReimburseQueueFilters;
  onChange: (next: ReimburseQueueFilters) => void;
  departmentOptions: string[];
  brandOptions: string[];
}) {
  const set = <K extends keyof ReimburseQueueFilters>(
    key: K,
    value: ReimburseQueueFilters[K],
  ) => onChange({ ...filters, [key]: value });

  const active = hasReimburseQueueFilters(filters);

  return (
    <div
      className="rounded-xl p-3 mb-4"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
    >
      <div className="grid gap-x-3 gap-y-2.5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 items-start">
        <Field label="เลขที่">
          <input
            value={filters.requestNo}
            onChange={(e) => set("requestNo", e.target.value)}
            placeholder="ค้นหาเลขที่..."
            className={filterInputCls}
            style={filterInputStyle}
          />
        </Field>

        {/* Two inputs under one label: a range is one question, and labelling
            them separately made the pair read as two unrelated filters. */}
        <Field label="วันที่ส่ง" className="sm:col-span-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <input
              type="date"
              value={filters.submittedFrom}
              onChange={(e) => set("submittedFrom", e.target.value)}
              aria-label="วันที่ส่ง ตั้งแต่"
              className={`${filterInputCls} min-w-0`}
              style={filterInputStyle}
            />
            <span className="text-[12px] shrink-0" style={{ color: "var(--text-faint)" }}>
              —
            </span>
            <input
              type="date"
              value={filters.submittedTo}
              onChange={(e) => set("submittedTo", e.target.value)}
              aria-label="วันที่ส่ง ถึง"
              className={`${filterInputCls} min-w-0`}
              style={filterInputStyle}
            />
          </div>
        </Field>

        <Field label="ผู้ขอ">
          <input
            value={filters.requesterName}
            onChange={(e) => set("requesterName", e.target.value)}
            placeholder="ชื่อผู้ขอ..."
            className={filterInputCls}
            style={filterInputStyle}
          />
        </Field>

        <MultiSelectFilter
          label="แผนก"
          options={departmentOptions}
          selected={filters.departmentNames}
          onChange={(v) => set("departmentNames", v)}
        />

        <MultiSelectFilter
          label="แบรนด์"
          options={brandOptions}
          selected={filters.brandCodes}
          onChange={(v) => set("brandCodes", v)}
        />
      </div>

      {/* Only once something is narrowing the list. A permanent "clear" invites
          a click that does nothing and teaches people it is decorative. */}
      {active && (
        <div className="flex justify-end mt-2.5">
          <button
            type="button"
            onClick={() => onChange(EMPTY_REIMBURSE_QUEUE_FILTERS)}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium cursor-pointer border-none bg-transparent p-0"
            style={{ color: "var(--text-muted)" }}
          >
            <RotateCcw size={12} /> ล้างตัวกรอง
          </button>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 flex flex-col gap-1 ${className}`}>
      <label className="text-[11px] font-semibold" style={{ color: "var(--text-muted)" }}>
        {label}
      </label>
      {children}
    </div>
  );
}
