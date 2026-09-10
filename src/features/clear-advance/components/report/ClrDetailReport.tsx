"use client";

/**
 * AP-3-Detail report — one row per expense line, Approved (complete) clearings
 * only, with a totals row and an Excel export. Mirrors AP-1 report styling.
 *
 * Data:   GET /api/request/clear-advance/report/detail → { ok, data: ClrDetailRow[] }.
 * Export: GET /api/request/clear-advance/report/detail/export?<same filters> → xlsx.
 * 403 → friendly "no access" state.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, FileX, Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FilterDateRangePicker } from "@/features/accounting/components/FilterDateRangePicker";
import type { ClrDetailRow } from "@/lib/clr/clear-advance-report-service";
import { makeColumnPrefs } from "@/features/advance/lib/queue-column-prefs";
import { ColumnToggleMenu, type ColumnToggleOption } from "@/features/travel-booking/components/ColumnToggleMenu";
import {
  FilterBar,
  ForbiddenState,
  SelectFilter,
  TextFilter,
  fmtMoney,
  fmtDateOnly,
  buildQuery,
  useClrBrands,
  type SelectOption,
} from "@/features/clear-advance/components/report/ClrReportShared";

interface DetailFilters {
  brand: string;
  requestNo: string;
  advanceNo: string;
  staffId: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: DetailFilters = {
  brand: "",
  requestNo: "",
  advanceNo: "",
  staffId: "",
  from: "",
  to: "",
};

interface DetailTotals {
  before: number;
  vat: number;
  total: number;
  wht: number;
  net: number;
}

interface DetailCol {
  key: string;
  label: string;
  align: "left" | "right";
  render: (r: ClrDetailRow) => React.ReactNode;
  /** Rendered in this column's footer cell. Columns without one stay blank. */
  total?: (t: DetailTotals) => React.ReactNode;
  /** Colour for the value, so the footer can match the column it sums. */
  color?: string;
  /** Long free text: clamped with the full value on hover. */
  wide?: boolean;
}

const dim = "var(--text-secondary)";
const txt = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === "" ? "—" : String(v);

/**
 * Every column, in the order the report shipped with.
 *
 * The reader hides and reorders them (`ColumnToggleMenu` + `makeColumnPrefs`,
 * the same pair AP-3-Control and AP-2's queues use), which is why each cell is
 * a render function rather than a hand-written <td>: twenty-one <td>s in a fixed
 * sequence cannot be reordered, and the totals row was worse — it spanned twelve
 * columns and counted five money cells by position, so hiding one silently
 * shifted every figure under the wrong heading.
 *
 * All start visible: this table already had all twenty-one, and a redesign of
 * what a reader sees is not what was asked for. They can hide what they do not
 * use, and the choice sticks per browser.
 */
const SCREEN_COLS: DetailCol[] = [
  { key: "requestNo", label: "เลขที่เคลียร์", align: "left",
    render: (r) => <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{txt(r.requestNo)}</span> },
  { key: "requestDate", label: "วันที่", align: "left", render: (r) => fmtDateOnly(r.requestDate) },
  { key: "lineNo", label: "ลำดับ", align: "right", render: (r) => r.lineNo },
  { key: "staffId", label: "รหัสพนักงาน", align: "left", render: (r) => txt(r.staffId) },
  { key: "requesterFullName", label: "ชื่อ", align: "left", render: (r) => txt(r.requesterFullName) },
  { key: "expenseOf", label: "เป็นค่าใช้จ่ายของ", align: "left", render: (r) => txt(r.expenseOf) },
  { key: "branchCode", label: "สาขา", align: "left", render: (r) => txt(r.branchCode) },
  { key: "expenseDate", label: "วันที่เอกสาร", align: "left", render: (r) => fmtDateOnly(r.expenseDate) },
  { key: "docNo", label: "เลขที่เอกสาร", align: "left", render: (r) => txt(r.docNo) },
  { key: "glAccountNo", label: "G/L", align: "left", render: (r) => txt(r.glAccountNo) },
  { key: "glAccountName", label: "ชื่อบัญชี", align: "left", render: (r) => txt(r.glAccountName) },
  { key: "description", label: "รายละเอียด", align: "left", wide: true, render: (r) => txt(r.description) },
  { key: "amountBeforeVat", label: "ก่อน VAT", align: "right",
    render: (r) => fmtMoney(r.amountBeforeVat), total: (t) => fmtMoney(t.before) },
  { key: "vatAmount", label: "VAT", align: "right",
    render: (r) => fmtMoney(r.vatAmount), total: (t) => fmtMoney(t.vat) },
  { key: "totalInclVat", label: "รวม", align: "right", color: "var(--color-action)",
    render: (r) => fmtMoney(r.totalInclVat), total: (t) => fmtMoney(t.total) },
  { key: "whtAmount", label: "หัก ณ ที่จ่าย", align: "right",
    render: (r) => fmtMoney(r.whtAmount), total: (t) => fmtMoney(t.wht) },
  { key: "netAmount", label: "จ่ายสุทธิ", align: "right", color: "var(--text-info-green)",
    render: (r) => fmtMoney(r.netAmount), total: (t) => fmtMoney(t.net) },
  { key: "taxId", label: "เลขผู้เสียภาษี", align: "left", render: (r) => txt(r.taxId) },
  { key: "payeeName", label: "ชื่อ/บริษัท", align: "left", render: (r) => txt(r.payeeName) },
  { key: "payeeAddress", label: "ที่อยู่", align: "left", wide: true, render: (r) => txt(r.payeeAddress) },
  { key: "advanceRequestNo", label: "Advance (AP-2)", align: "left", render: (r) => txt(r.advanceRequestNo) },
];

/** Its own storage keys — a reader arranging this report must not rearrange
 *  AP-3-Control underneath them. */
const PREFS = makeColumnPrefs(SCREEN_COLS, "ap3-detail-report-cols", "ap3-detail-report-col-order");

function money2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function ClrDetailReport() {
  const brands = useClrBrands();

  const [filters, setFilters] = useState<DetailFilters>(EMPTY_FILTERS);
  const [rows, setRows] = useState<ClrDetailRow[]>([]);
  const [visible, setVisible] = useState<Record<string, boolean>>(PREFS.defaultVisible);
  const [order, setOrder] = useState<string[]>(() => SCREEN_COLS.map((c) => c.key));
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Read after mount: localStorage does not exist on the server, and seeding
  // the initial state from it would make the first render disagree.
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

  const orderedCols = useMemo(() => {
    const byKey = new Map(SCREEN_COLS.map((c) => [c.key, c]));
    return order.map((k) => byKey.get(k)).filter((c): c is DetailCol => !!c);
  }, [order]);

  const pickerColumns = useMemo<ColumnToggleOption<string>[]>(
    () => orderedCols.map((c) => ({ key: c.key, label: c.label })),
    [orderedCols],
  );

  const visibleColumns = useMemo(
    () => orderedCols.filter((c) => visible[c.key] ?? true),
    [orderedCols, visible],
  );

  const patch = useCallback((p: Partial<DetailFilters>) => {
    setFilters((prev) => ({ ...prev, ...p }));
  }, []);

  const queryString = useCallback(
    () =>
      buildQuery({
        brand: filters.brand,
        requestNo: filters.requestNo,
        advanceNo: filters.advanceNo,
        staffId: filters.staffId,
        from: filters.from,
        to: filters.to,
      }),
    [filters],
  );

  const fetchRows = useCallback(() => {
    setLoading(true);
    setForbidden(false);
    setLoadError(null);
    fetch(`/api/request/clear-advance/report/detail?${queryString()}`)
      .then(async (res) => {
        if (res.status === 403) {
          setForbidden(true);
          setRows([]);
          return;
        }
        const json: { ok: boolean; data?: ClrDetailRow[]; error?: string } = await res.json();
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
  }, [queryString]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const handleExport = useCallback(() => {
    const qs = queryString();
    window.open(`/api/request/clear-advance/report/detail/export?${qs}`, "_blank");
  }, [queryString]);

  const brandOptions = useMemo<SelectOption[]>(
    () => brands.map((b) => ({ value: b.brandCode, label: b.brandName || b.brandCode })),
    [brands],
  );

  const totals = useMemo(() => {
    const acc = { before: 0, vat: 0, total: 0, wht: 0, net: 0 };
    for (const r of rows) {
      acc.before += r.amountBeforeVat ?? 0;
      acc.vat += r.vatAmount ?? 0;
      acc.total += r.totalInclVat ?? 0;
      acc.wht += r.whtAmount ?? 0;
      acc.net += r.netAmount ?? 0;
    }
    return {
      before: money2(acc.before),
      vat: money2(acc.vat),
      total: money2(acc.total),
      wht: money2(acc.wht),
      net: money2(acc.net),
    };
  }, [rows]);

  const filterBar = (
    <FilterBar>
      <SelectFilter label="แบรนด์" value={filters.brand} onChange={(v) => patch({ brand: v })} options={brandOptions} />
      <TextFilter label="เลขที่เคลียร์ (ADC)" value={filters.requestNo} onChange={(v) => patch({ requestNo: v })} placeholder="เช่น ADC26-0001" />
      <TextFilter label="เลขที่ Advance (AP-2)" value={filters.advanceNo} onChange={(v) => patch({ advanceNo: v })} placeholder="เช่น ADV26-0001" />
      <TextFilter label="รหัสพนักงาน" type="number" value={filters.staffId} onChange={(v) => patch({ staffId: v })} placeholder="เช่น 1234" />
      <div className="min-w-0">
        <FilterDateRangePicker
          label="ช่วงวันที่ส่ง"
          from={filters.from}
          to={filters.to}
          onChange={(from, to) => patch({ from, to })}
        />
      </div>
      <div className="flex items-end gap-2">
        {/* Same control AP-3-Control uses, so a reader who has arranged one
            already knows how to arrange the other. */}
        <ColumnToggleMenu
          columns={pickerColumns}
          visible={visible}
          onChange={handleVisibleChange}
          onReorder={handleReorder}
          label="คอลัมน์"
        />
        <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
          ล้างตัวกรอง
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<Download size={14} />}
          disabled={rows.length === 0}
          onClick={handleExport}
        >
          Export Excel
        </Button>
      </div>
    </FilterBar>
  );

  if (forbidden) return <ForbiddenState />;

  const moneyCell = (n: number | null, color?: string) => (
    <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums" style={{ color: color ?? "var(--text-primary)" }}>
      {fmtMoney(n)}
    </td>
  );

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
              <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
                ไม่พบข้อมูล — รายงานรายบรรทัดแสดงเฉพาะรายการที่อนุมัติครบแล้ว
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto no-scrollbar max-h-[min(72vh,760px)] overflow-y-auto" style={{ background: "var(--bg-card)" }}>
              <table className="w-full text-[12px] border-collapse" style={{ minWidth: `${Math.max(600, visibleColumns.length * 110)}px` }}>
                <thead
                  className="sticky top-0 z-10"
                  style={{ background: "var(--bg-card-alt)", boxShadow: "0 1px 0 var(--border-light)" }}
                >
                  <tr style={{ borderBottom: "1px solid var(--border-light)" }}>
                    {visibleColumns.map((col) => (
                      <th
                        key={col.key}
                        className={`px-3 py-2.5 font-semibold whitespace-nowrap ${col.align === "right" ? "text-right" : "text-left"}`}
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
                        key={`${row.requestNo ?? "?"}-${row.lineNo}-${idx}`}
                        className="transition-colors"
                        style={{ background: rowBg, borderBottom: "1px solid var(--border-light)" }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "color-mix(in srgb, var(--nav-active-bg) 22%, var(--bg-card))";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = rowBg;
                        }}
                      >
                        {visibleColumns.map((col) => {
                          const value = col.render(row);
                          return (
                            <td
                              key={col.key}
                              className={`px-3 py-2 ${col.wide ? "max-w-[240px] truncate" : "whitespace-nowrap"} ${col.align === "right" ? "text-right tabular-nums" : ""}`}
                              style={{ color: col.color ?? dim }}
                              title={col.wide && typeof value === "string" ? value : undefined}
                            >
                              {value}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="sticky bottom-0 z-10">
                  {/* One cell per visible column. The old footer spanned twelve
                      and then counted five money cells by position, so hiding or
                      moving one put every total under the wrong heading. */}
                  <tr
                    style={{
                      borderTop: "2px solid var(--border-card)",
                      background: "color-mix(in srgb, var(--bg-card) 80%, var(--bg-page))",
                      boxShadow: "0 -1px 0 var(--border-card), 0 -8px 16px -10px rgba(0,0,0,0.25)",
                    }}
                  >
                    {visibleColumns.map((col, i) => (
                      <td
                        key={col.key}
                        className={`px-3 py-2.5 font-bold ${col.align === "right" ? "text-right tabular-nums" : "whitespace-nowrap"}`}
                        style={{ color: col.color ?? "var(--text-heading)" }}
                      >
                        {col.total
                          ? col.total(totals)
                          : i === 0
                            ? `รวมทั้งหมด (${rows.length} รายการ)`
                            : ""}
                      </td>
                    ))}
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
