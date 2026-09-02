"use client";

/**
 * AP-3-Control report — one row per AP-3 clearing, linked to its AP-2 advance,
 * with per-step approval stamps. Mirrors the AP-1 report table styling.
 *
 * Data: GET /api/request/clear-advance/report → { ok, data: ClrControlRow[] }.
 * 403 → friendly "no access" state (back-office report).
 *
 * Column width (docs/superpowers/specs/2026-09-02-ap3-control-report-redesign-design.md):
 * 18 columns no longer render at once. 10 default-visible + 8 behind
 * `ColumnToggleMenu`, remembered per browser — same pattern AP-2's report page
 * uses. The Excel export (`report/export/route.ts`) is a separate route with
 * its own hardcoded 18-column header/body and is untouched by this file.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, FileX, Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FilterDateRangePicker } from "@/features/accounting/components/FilterDateRangePicker";
import { RequestStatusBadge } from "@/features/accounting/components/RequestStatusBadge";
import { STATUS_LABEL_TH } from "@/features/accounting/constants";
import { clearAdvanceDetailHref } from "@/features/clear-advance/lib/navigation";
import { ColumnToggleMenu, type ColumnToggleOption } from "@/features/travel-booking/components/ColumnToggleMenu";
import type { ClrControlRow } from "@/lib/clr/clear-advance-report-service";
import { DEFAULT_VISIBLE_KEYS, controlAdjustment } from "@/lib/clr/clr-control-report-view";
import {
  FilterBar,
  ForbiddenState,
  SelectFilter,
  TextFilter,
  fmtMoney,
  fmtDateOnly,
  fmtDateTime,
  buildQuery,
  useClrBrands,
  type SelectOption,
} from "@/features/clear-advance/components/report/ClrReportShared";

/** AccRequest.Status values the API matches exactly (status=…). */
const STATUS_VALUES = ["Draft", "Submitted", "Approved", "Rejected", "Returned", "Cancelled"] as const;
const STATUS_OPTIONS: SelectOption[] = STATUS_VALUES.map((s) => ({
  value: s,
  label: STATUS_LABEL_TH[s] ?? s,
}));

interface ControlFilters {
  brand: string;
  status: string;
  requestNo: string;
  advanceNo: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: ControlFilters = {
  brand: "",
  status: "",
  requestNo: "",
  advanceNo: "",
  from: "",
  to: "",
};

function ApprovalCell({ name, at }: { name: string | null; at: string | null }) {
  if (!name && !at) return <span style={{ color: "var(--text-faint)" }}>—</span>;
  return (
    <div className="leading-tight">
      <div style={{ color: "var(--text-primary)" }}>{name ?? "—"}</div>
      {at && (
        <div className="text-[10px] tabular-nums mt-0.5" style={{ color: "var(--text-faint)" }}>
          {fmtDateTime(at)}
        </div>
      )}
    </div>
  );
}

/**
 * คืน/เบิกเพิ่ม, on screen only — refund shown negative (money flowing back to
 * the company), extra shown positive (company paying out more). The export
 * keeps `refundToCompany` / `extraToEmployee` as separate columns.
 */
function AdjustmentCell({ row }: { row: ClrControlRow }) {
  const adj = controlAdjustment(row);
  if (adj.direction === "none") return <span style={{ color: "var(--text-faint)" }}>—</span>;
  const color = adj.direction === "refund" ? "var(--text-info-green)" : "var(--text-info-yellow)";
  const sign = adj.direction === "refund" ? "-" : "+";
  return (
    <span className="tabular-nums" style={{ color }}>
      {sign}
      {fmtMoney(adj.amount)}
    </span>
  );
}

interface ScreenCol {
  key: string;
  label: string;
  align: "left" | "right";
  /** On-screen cap in px for a free-text column whose longest value would
   *  otherwise widen the whole table (design doc §"Width, learned from AP-2"). */
  maxW?: number;
  /** Plain-text value for the `title` attribute when `maxW` clips the cell —
   *  `render` may return JSX, so it cannot serve as `title` itself. */
  title?: (row: ClrControlRow) => string;
  render: (row: ClrControlRow) => React.ReactNode;
}

// Kept in the same relative order as the pre-redesign 18-column table so a
// toggled-on column reappears roughly where it used to sit, not appended at
// the end. Default-visible set is DEFAULT_VISIBLE_KEYS (design doc §"Default
// columns"); the other 8 start hidden behind ColumnToggleMenu.
const SCREEN_COLS: ScreenCol[] = [
  { key: "submittedAt", label: "วันที่ส่ง", align: "left", render: (r) => fmtDateOnly(r.submittedAt) },
  {
    key: "requestNo",
    label: "เลขที่ ADC",
    align: "left",
    render: (r) => (
      <span className="font-semibold underline-offset-2 hover:underline" style={{ color: "var(--nav-active-text)" }}>
        {r.requestNo ?? "—"}
      </span>
    ),
  },
  { key: "staffId", label: "รหัสพนักงาน", align: "left", render: (r) => r.staffId ?? "—" },
  {
    key: "advanceRequestNo",
    label: "เลขที่ ADV",
    align: "left",
    render: (r) =>
      r.advanceRequestNo ? (
        <span
          className="text-[11px] font-semibold px-1.5 py-0.5 rounded"
          style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
        >
          {r.advanceRequestNo}
        </span>
      ) : (
        <span style={{ color: "var(--text-faint)" }}>—</span>
      ),
  },
  {
    key: "requesterFullName",
    label: "ผู้ขอ",
    align: "left",
    // An unclipped Thai full name was the single widest cell in the table —
    // capped and clipped; the full value is still in `title` and the export.
    maxW: 140,
    title: (r) => r.requesterFullName ?? "",
    render: (r) => r.requesterFullName ?? "—",
  },
  {
    key: "requesterPosition",
    label: "ตำแหน่ง",
    align: "left",
    render: (r) => r.requesterPosition ?? <span style={{ color: "var(--text-faint)" }}>—</span>,
  },
  { key: "requesterDepartmentName", label: "แผนก", align: "left", render: (r) => r.requesterDepartmentName ?? "—" },
  { key: "advanceAmount", label: "วงเงินที่ได้รับ", align: "right", render: (r) => fmtMoney(r.advanceAmount) },
  { key: "expenseOf", label: "เป็นค่าใช้จ่ายของ", align: "left", render: (r) => r.expenseOf ?? "—" },
  {
    key: "actualTotal",
    label: "รวมใช้จริง",
    align: "right",
    render: (r) => (
      <span className="font-medium" style={{ color: "var(--color-action)" }}>
        {fmtMoney(r.actualTotal)}
      </span>
    ),
  },
  { key: "adjustment", label: "คืน/เบิกเพิ่ม", align: "right", render: (r) => <AdjustmentCell row={r} /> },
  { key: "refundTransferDate", label: "วันที่โอนคืน", align: "left", render: (r) => fmtDateOnly(r.refundTransferDate) },
  {
    key: "pvDocNo",
    label: "PV",
    align: "left",
    // Payment date rides as a sub-line under the PV doc no. (same two-line
    // pattern as ApprovalCell below) rather than its own column — it is a
    // detail of *when this PV was paid*, not a fact worth a whole column.
    render: (r) => (
      <div className="leading-tight">
        <div style={{ color: "var(--text-secondary)" }}>{r.pvDocNo ?? "—"}</div>
        {r.paymentDate && (
          <div className="text-[10px] tabular-nums mt-0.5" style={{ color: "var(--text-faint)" }}>
            {fmtDateOnly(r.paymentDate)}
          </div>
        )}
      </div>
    ),
  },
  {
    key: "managerApproved",
    label: "ผู้จัดการอนุมัติ",
    align: "left",
    render: (r) => <ApprovalCell name={r.managerApprovedName} at={r.managerApprovedAt} />,
  },
  {
    key: "accountActioned",
    label: "บัญชี Action",
    align: "left",
    render: (r) => <ApprovalCell name={r.accountActionedName} at={r.accountActionedAt} />,
  },
  {
    key: "headApproved",
    label: "หัวหน้าบัญชีอนุมัติ",
    align: "left",
    render: (r) => <ApprovalCell name={r.headApprovedName} at={r.headApprovedAt} />,
  },
  {
    key: "pendingOn",
    label: "รอที่ใคร",
    align: "left",
    render: (r) => r.pendingOn ?? <span style={{ color: "var(--text-faint)" }}>—</span>,
  },
  { key: "overallStatus", label: "สถานะ", align: "left", render: (r) => <RequestStatusBadge status={r.overallStatus} /> },
];

const DEFAULT_VISIBLE: Record<string, boolean> = SCREEN_COLS.reduce(
  (acc, c) => ({ ...acc, [c.key]: DEFAULT_VISIBLE_KEYS.includes(c.key) }),
  {} as Record<string, boolean>,
);

const PICKER_COLUMNS: ColumnToggleOption<string>[] = SCREEN_COLS.map((c) => ({ key: c.key, label: c.label }));

const COLS_STORAGE_KEY = "ap3-control-report-cols";

function loadStoredVisibility(): Record<string, boolean> {
  if (typeof window === "undefined") return DEFAULT_VISIBLE;
  try {
    const raw = window.localStorage.getItem(COLS_STORAGE_KEY);
    if (!raw) return DEFAULT_VISIBLE;
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return { ...DEFAULT_VISIBLE, ...parsed };
  } catch {
    return DEFAULT_VISIBLE;
  }
}

export function ClrControlReport() {
  const router = useRouter();
  const brands = useClrBrands();

  const [filters, setFilters] = useState<ControlFilters>(EMPTY_FILTERS);
  const [rows, setRows] = useState<ClrControlRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [visible, setVisible] = useState<Record<string, boolean>>(DEFAULT_VISIBLE);

  useEffect(() => {
    setVisible(loadStoredVisibility());
  }, []);

  const handleVisibleChange = useCallback((next: Record<string, boolean>) => {
    setVisible(next);
    try {
      window.localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // best-effort — ignore storage failures (private mode / quota)
    }
  }, []);

  const visibleColumns = useMemo(() => SCREEN_COLS.filter((c) => visible[c.key] ?? true), [visible]);

  const patch = useCallback((p: Partial<ControlFilters>) => {
    setFilters((prev) => ({ ...prev, ...p }));
  }, []);

  const fetchRows = useCallback(() => {
    setLoading(true);
    setForbidden(false);
    setLoadError(null);
    const qs = buildQuery({
      brand: filters.brand,
      status: filters.status,
      requestNo: filters.requestNo,
      advanceNo: filters.advanceNo,
      from: filters.from,
      to: filters.to,
    });
    fetch(`/api/request/clear-advance/report?${qs}`)
      .then(async (res) => {
        if (res.status === 403) {
          setForbidden(true);
          setRows([]);
          return;
        }
        const json: { ok: boolean; data?: ClrControlRow[]; error?: string } = await res.json();
        if (!res.ok || !json.ok) {
          setRows([]);
          setLoadError(json.error ?? "โหลดรายงานไม่สำเร็จ");
          return;
        }
        setRows(json.data ?? []);
      })
      .catch(() => {
        setRows([]);
        setLoadError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ — ลองโหลดใหม่อีกครั้ง");
      })
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const handleExport = useCallback(() => {
    const qs = buildQuery({
      brand: filters.brand,
      status: filters.status,
      requestNo: filters.requestNo,
      advanceNo: filters.advanceNo,
      from: filters.from,
      to: filters.to,
    });
    window.open(`/api/request/clear-advance/report/export?${qs}`, "_blank");
  }, [filters]);

  const brandOptions = useMemo<SelectOption[]>(
    () => brands.map((b) => ({ value: b.brandCode, label: b.brandName || b.brandCode })),
    [brands],
  );

  const filterBar = (
    <FilterBar>
      <SelectFilter label="แบรนด์" value={filters.brand} onChange={(v) => patch({ brand: v })} options={brandOptions} />
      <SelectFilter label="สถานะ" value={filters.status} onChange={(v) => patch({ status: v })} options={STATUS_OPTIONS} />
      <TextFilter label="เลขที่เคลียร์ (ADC)" value={filters.requestNo} onChange={(v) => patch({ requestNo: v })} placeholder="เช่น ADC26-0001" />
      <TextFilter label="เลขที่ Advance (AP-2)" value={filters.advanceNo} onChange={(v) => patch({ advanceNo: v })} placeholder="เช่น ADV26-0001" />
      <div className="min-w-0">
        <FilterDateRangePicker
          label="ช่วงวันที่ส่ง"
          from={filters.from}
          to={filters.to}
          onChange={(from, to) => patch({ from, to })}
        />
      </div>
      <div className="flex items-end gap-2">
        <ColumnToggleMenu columns={PICKER_COLUMNS} visible={visible} onChange={handleVisibleChange} label="คอลัมน์" />
        <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
          ล้างตัวกรอง
        </Button>
        <Button variant="secondary" size="sm" icon={<Download size={14} />}
          onClick={handleExport} disabled={loading || rows.length === 0}>
          Export Excel
        </Button>
      </div>
    </FilterBar>
  );

  if (forbidden) return <ForbiddenState />;

  return (
    <div className="flex flex-col">
      {filterBar}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin" style={{ color: "var(--text-muted)" }} />
        </div>
      ) : loadError ? (
        <div
          className="rounded-xl p-8 flex flex-col items-center gap-4 text-center"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
        >
          <p className="text-[13px] m-0" style={{ color: "var(--text-muted)" }}>{loadError}</p>
          <Button variant="secondary" size="sm" onClick={() => fetchRows()}>โหลดใหม่</Button>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-card)" }}>
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center" style={{ background: "var(--bg-card)" }}>
              <FileX size={32} style={{ color: "var(--text-muted)" }} />
              <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>ไม่พบข้อมูลตามเงื่อนไขที่ระบุ</p>
            </div>
          ) : (
            <div className="overflow-x-auto no-scrollbar max-h-[min(72vh,760px)] overflow-y-auto" style={{ background: "var(--bg-card)" }}>
              <table className="w-full text-[12px] border-collapse">
                <thead
                  className="sticky top-0 z-10"
                  style={{ background: "var(--bg-card-alt)", boxShadow: "0 1px 0 var(--border-light)" }}
                >
                  <tr style={{ borderBottom: "1px solid var(--border-light)" }}>
                    {visibleColumns.map((col) => (
                      <th
                        key={col.key}
                        className={`px-3 py-2.5 font-semibold whitespace-nowrap text-${col.align}`}
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => {
                    const rowBg = idx % 2 === 0 ? "transparent" : "color-mix(in srgb, var(--bg-card) 50%, var(--bg-page))";
                    return (
                      <tr
                        key={row.id}
                        className="transition-colors cursor-pointer"
                        style={{ background: rowBg, borderBottom: "1px solid var(--border-light)" }}
                        onClick={() => router.push(clearAdvanceDetailHref(row.id))}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "color-mix(in srgb, var(--nav-active-bg) 28%, var(--bg-card))";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = rowBg;
                        }}
                      >
                        {visibleColumns.map((col) => (
                          <td
                            key={col.key}
                            className={`px-3 py-2 whitespace-nowrap tabular-nums text-${col.align}`}
                            style={{
                              color: "var(--text-primary)",
                              ...(col.maxW
                                ? { maxWidth: col.maxW, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }
                                : null),
                            }}
                            title={col.title?.(row)}
                          >
                            {col.render(row)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="sticky bottom-0 z-10">
                  <tr
                    style={{
                      borderTop: "2px solid var(--border-card)",
                      background: "color-mix(in srgb, var(--bg-card) 80%, var(--bg-page))",
                      boxShadow: "0 -1px 0 var(--border-card), 0 -8px 16px -10px rgba(0,0,0,0.25)",
                    }}
                  >
                    <td colSpan={visibleColumns.length} className="px-3 py-2.5 font-bold" style={{ color: "var(--text-heading)" }}>
                      รวมทั้งหมด ({rows.length} รายการ)
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
