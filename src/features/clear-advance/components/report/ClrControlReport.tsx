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
 * `ColumnToggleMenu`, and the reader drags them into their own order —
 * remembered per browser by AP-2's `makeColumnPrefs`, the same helper its two
 * queues use, under this report's own keys. The Excel export
 * (`report/export/route.ts`) is a separate route with its own hardcoded
 * 18-column header/body and is untouched by this file.
 *
 * Stacked filters (brand, status — §"Stacked filters"): each takes several
 * picks, OR'd within the column; filter state is CSV, same shape AP-2's
 * report page uses. Filtering happens server-side here (unlike AP-2, which
 * filters an already-fetched full table client-side), so the CSV rides the
 * query string and `report/route.ts` queries every (brand, status)
 * combination and merges — see `stackedAxisCombos` / `mergeControlRows` in
 * `clr-control-report-view.ts`.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, FileX, Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FilterDateRangePicker } from "@/features/accounting/components/FilterDateRangePicker";
import { RequestStatusBadge } from "@/features/accounting/components/RequestStatusBadge";
import { STATUS_LABEL_TH } from "@/features/accounting/constants";
import { clearAdvanceDetailHref } from "@/features/clear-advance/lib/navigation";
import { makeColumnPrefs } from "@/features/advance/lib/queue-column-prefs";
import { ColumnToggleMenu, type ColumnToggleOption } from "@/features/travel-booking/components/ColumnToggleMenu";
import type { ClrControlRow } from "@/lib/clr/clear-advance-report-service";
import { DEFAULT_VISIBLE_KEYS, controlAdjustment, singleStackedValue } from "@/lib/clr/clr-control-report-view";
import { QueueColumnFilter } from "@/features/advance/components/QueueColumnFilter";
import {
  FilterBar,
  ForbiddenState,
  StackedSelectFilter,
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
  /** CSV of picks — OR within this column (design doc §"Stacked filters"). */
  brand: string;
  /** CSV of picks — OR within this column. */
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

/**
 * The header filter each column offers. A column absent from this map has no
 * filter — the two approval-stamp columns and the PV column pack a name and a
 * date into one cell, and filtering on that concatenation matches nothing a
 * reader would predict.
 *
 * "select" for the columns whose values repeat across rows, so the reader picks
 * from what the report actually holds and can stack two of them; "text" where
 * every row differs and typing part of it is the faster way in.
 */
const FILTER_KIND: Record<string, "text" | "select"> = {
  submittedAt: "text",
  requestNo: "text",
  staffId: "text",
  advanceRequestNo: "text",
  requesterFullName: "text",
  requesterPosition: "select",
  requesterDepartmentName: "select",
  advanceAmount: "text",
  expenseOf: "select",
  actualTotal: "text",
  adjustment: "text",
  refundTransferDate: "text",
  pendingOn: "select",
  overallStatus: "select",
};

/**
 * A column's value as plain text — what the free-text-free filter row matches
 * on and what fills a select's options.
 *
 * Defined once, beside the column model rather than inside the component, so
 * the filter and the options can never disagree about what a column contains.
 * It mirrors what `render` puts on screen; where the cell shows a badge or a
 * two-line stack, this is the part a reader would type.
 */
function cellText(r: ClrControlRow, key: string): string {
  switch (key) {
    case "submittedAt": return fmtDateOnly(r.submittedAt);
    case "requestNo": return r.requestNo ?? "";
    case "staffId": return r.staffId != null ? String(r.staffId) : "";
    case "advanceRequestNo": return r.advanceRequestNo ?? "";
    case "requesterFullName": return r.requesterFullName ?? "";
    case "requesterPosition": return r.requesterPosition ?? "";
    case "requesterDepartmentName": return r.requesterDepartmentName ?? "";
    case "advanceAmount": return fmtMoney(r.advanceAmount);
    case "expenseOf": return r.expenseOf ?? "";
    case "actualTotal": return fmtMoney(r.actualTotal);
    case "adjustment": {
      const adj = controlAdjustment(r);
      return adj.direction === "none" ? "" : fmtMoney(adj.amount);
    }
    case "refundTransferDate": return fmtDateOnly(r.refundTransferDate);
    case "pvDocNo": return r.pvDocNo ?? "";
    case "pendingOn": return r.pendingOn ?? "";
    // The badge shows the Thai label, so that is what the filter matches; an
    // unmapped status falls back to the raw value rather than showing blank.
    case "overallStatus":
      return (STATUS_LABEL_TH as Record<string, string>)[r.overallStatus] ?? r.overallStatus ?? "";
    default: return "";
  }
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
    key: "pendingOn",
    label: "รอที่ใคร",
    align: "left",
    render: (r) => r.pendingOn ?? <span style={{ color: "var(--text-faint)" }}>—</span>,
  },
  { key: "overallStatus", label: "สถานะ", align: "left", render: (r) => <RequestStatusBadge status={r.overallStatus} /> },
];

/** `ap3-control-report-cols` is the key readers already have their shown /
 *  hidden choice under, so it is kept; the order is a new key of its own. */
const PREFS = makeColumnPrefs(SCREEN_COLS, "ap3-control-report-cols", "ap3-control-report-col-order", DEFAULT_VISIBLE_KEYS);

export function ClrControlReport() {
  const router = useRouter();
  const brands = useClrBrands();

  const [filters, setFilters] = useState<ControlFilters>(EMPTY_FILTERS);
  const [rows, setRows] = useState<ClrControlRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [visible, setVisible] = useState<Record<string, boolean>>(PREFS.defaultVisible);
  const [order, setOrder] = useState<string[]>(() => SCREEN_COLS.map((c) => c.key));
  /* Per-column filters, keyed by column: plain text for a "text" column, a CSV
     of picks for a "select" one. They narrow the rows already fetched rather
     than the query — `listControlRows` takes no such parameters — so the Excel
     export comes back as a superset while any of them is set, the same honest
     difference the stacked brand/status filters already make. */
  const [colFilters, setColFilters] = useState<Record<string, string>>({});

  // Read after mount, not in the initial state: localStorage does not exist on
  // the server, and seeding from it would make the first render disagree.
  useEffect(() => {
    setVisible(PREFS.loadVisibility());
    setOrder(PREFS.loadOrder());
  }, []);

  const handleVisibleChange = useCallback((next: Record<string, boolean>) => {
    setVisible(next);
    PREFS.saveVisibility(next);
  }, []);

  const handleReorder = useCallback((next: string[]) => {
    setOrder(next);
    PREFS.saveOrder(next);
  }, []);

  /** Every column in the reader's order — what the picker lists. */
  const orderedCols = useMemo(() => {
    const byKey = new Map(SCREEN_COLS.map((c) => [c.key, c]));
    return order.map((k) => byKey.get(k)).filter((c): c is ScreenCol => !!c);
  }, [order]);

  const pickerColumns = useMemo<ColumnToggleOption<string>[]>(
    () => orderedCols.map((c) => ({ key: c.key, label: c.label })),
    [orderedCols],
  );

  const visibleColumns = useMemo(() => orderedCols.filter((c) => visible[c.key] ?? true), [orderedCols, visible]);

  /** Select options come from the rows on hand, so a reader is never offered a
   *  value that would return nothing. */
  const selectOptions = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const [key, kind] of Object.entries(FILTER_KIND)) {
      if (kind !== "select") continue;
      map[key] = Array.from(new Set(rows.map((r) => cellText(r, key)).filter(Boolean))).sort();
    }
    return map;
  }, [rows]);

  const visibleRows = useMemo(() => {
    const active = Object.entries(colFilters).filter(([, v]) => v.trim() !== "");
    if (active.length === 0) return rows;
    return rows.filter((r) =>
      active.every(([key, f]) => {
        const v = cellText(r, key).toLowerCase();
        if (FILTER_KIND[key] === "select") {
          // CSV of picks: any one matching keeps the row, so the report can show
          // two departments or two statuses at once.
          const picks = f.split(",").filter(Boolean).map((s) => s.toLowerCase());
          return picks.length === 0 || picks.includes(v);
        }
        return v.includes(f.trim().toLowerCase());
      }),
    );
  }, [rows, colFilters]);

  const setColFilter = useCallback((key: string, next: string) => {
    setColFilters((prev) => ({ ...prev, [key]: next }));
  }, []);

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
    // The export route is untouched (design doc §"Out of scope") and only
    // understands one exact value per filter — two or more picks on a
    // stacked axis are dropped rather than forwarded, so the file comes back
    // as a (visibly broader) superset instead of a silently empty one.
    const qs = buildQuery({
      brand: singleStackedValue(filters.brand),
      status: singleStackedValue(filters.status),
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
      <StackedSelectFilter label="แบรนด์" valueCsv={filters.brand} onChange={(v) => patch({ brand: v })} options={brandOptions} />
      <StackedSelectFilter label="สถานะ" valueCsv={filters.status} onChange={(v) => patch({ status: v })} options={STATUS_OPTIONS} />
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
        <ColumnToggleMenu columns={pickerColumns} visible={visible} onChange={handleVisibleChange} onReorder={handleReorder} label="คอลัมน์" />
        <Button variant="ghost" size="sm" onClick={() => { setFilters(EMPTY_FILTERS); setColFilters({}); }}>
          ล้างตัวกรอง
        </Button>
        <Button variant="secondary" size="sm" icon={<Download size={14} />}
          onClick={handleExport} disabled={loading || visibleRows.length === 0}>
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
          {visibleRows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center" style={{ background: "var(--bg-card)" }}>
              <FileX size={32} style={{ color: "var(--text-muted)" }} />
              {/* Telling a reader there is nothing here while their own toggle
                  hides it sends them looking in the wrong place. */}
              <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
                {rows.length > 0
                  ? "ตัวกรองคอลัมน์กรองรายการออกหมด — กด “ล้างตัวกรอง” เพื่อดูทั้งหมด"
                  : "ไม่พบข้อมูลตามเงื่อนไขที่ระบุ"}
              </p>
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
                  {/* Filter row — one cell per shown column, so it follows the
                      reader's order and disappears with a hidden column. */}
                  <tr style={{ borderBottom: "1px solid var(--border-light)" }}>
                    {visibleColumns.map((col) => (
                      <td key={col.key} className="px-3 py-1.5 align-top">
                        {FILTER_KIND[col.key] ? (
                          <QueueColumnFilter
                            kind={FILTER_KIND[col.key]}
                            value={colFilters[col.key] ?? ""}
                            options={selectOptions[col.key]}
                            onChange={(v) => setColFilter(col.key, v)}
                          />
                        ) : null}
                      </td>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row, idx) => {
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
                      รวมทั้งหมด ({visibleRows.length} รายการ)
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
