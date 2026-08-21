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

const COLS: { label: string; align: "left" | "right" }[] = [
  { label: "เลขที่เคลียร์", align: "left" },
  { label: "วันที่", align: "left" },
  { label: "ลำดับ", align: "right" },
  { label: "รหัสพนักงาน", align: "left" },
  { label: "ชื่อ", align: "left" },
  { label: "เป็นค่าใช้จ่ายของ", align: "left" },
  { label: "สาขา", align: "left" },
  { label: "วันที่เอกสาร", align: "left" },
  { label: "เลขที่เอกสาร", align: "left" },
  { label: "G/L", align: "left" },
  { label: "ชื่อบัญชี", align: "left" },
  { label: "รายละเอียด", align: "left" },
  { label: "ก่อน VAT", align: "right" },
  { label: "VAT", align: "right" },
  { label: "รวม", align: "right" },
  { label: "หัก ณ ที่จ่าย", align: "right" },
  { label: "จ่ายสุทธิ", align: "right" },
  { label: "เลขผู้เสียภาษี", align: "left" },
  { label: "ชื่อ/บริษัท", align: "left" },
  { label: "ที่อยู่", align: "left" },
  { label: "Advance (AP-2)", align: "left" },
];

function money2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function ClrDetailReport() {
  const brands = useClrBrands();

  const [filters, setFilters] = useState<DetailFilters>(EMPTY_FILTERS);
  const [rows, setRows] = useState<ClrDetailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

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
              <table className="w-full text-[12px] border-collapse min-w-[1900px]">
                <thead
                  className="sticky top-0 z-10"
                  style={{ background: "var(--bg-card-alt)", boxShadow: "0 1px 0 var(--border-light)" }}
                >
                  <tr style={{ borderBottom: "1px solid var(--border-light)" }}>
                    {COLS.map((col) => (
                      <th
                        key={col.label}
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
                        <td className="px-3 py-2 whitespace-nowrap font-semibold" style={{ color: "var(--text-primary)" }}>
                          {row.requestNo ?? "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums" style={{ color: "var(--text-secondary)" }}>
                          {fmtDateOnly(row.requestDate)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>
                          {row.lineNo}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                          {row.staffId ?? "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                          {row.requesterFullName ?? "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                          {row.expenseOf ?? "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                          {row.branchCode ?? "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums" style={{ color: "var(--text-secondary)" }}>
                          {fmtDateOnly(row.expenseDate)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                          {row.docNo ?? "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums" style={{ color: "var(--text-secondary)" }}>
                          {row.glAccountNo ?? "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                          {row.glAccountName ?? "—"}
                        </td>
                        <td className="px-3 py-2 max-w-[240px] truncate" style={{ color: "var(--text-secondary)" }} title={row.description ?? undefined}>
                          {row.description ?? "—"}
                        </td>
                        {moneyCell(row.amountBeforeVat)}
                        {moneyCell(row.vatAmount)}
                        {moneyCell(row.totalInclVat, "var(--color-action)")}
                        {moneyCell(row.whtAmount)}
                        {moneyCell(row.netAmount, "var(--text-info-green)")}
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums" style={{ color: "var(--text-secondary)" }}>
                          {row.taxId ?? "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                          {row.payeeName ?? "—"}
                        </td>
                        <td className="px-3 py-2 max-w-[240px] truncate" style={{ color: "var(--text-secondary)" }} title={row.payeeAddress ?? undefined}>
                          {row.payeeAddress ?? "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                          {row.advanceRequestNo ?? "—"}
                        </td>
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
                    <td colSpan={12} className="px-3 py-2.5 font-bold" style={{ color: "var(--text-heading)" }}>
                      รวมทั้งหมด ({rows.length} รายการ)
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-bold" style={{ color: "var(--text-heading)" }}>{fmtMoney(totals.before)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-bold" style={{ color: "var(--text-heading)" }}>{fmtMoney(totals.vat)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-bold" style={{ color: "var(--color-action)" }}>{fmtMoney(totals.total)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-bold" style={{ color: "var(--text-heading)" }}>{fmtMoney(totals.wht)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-bold" style={{ color: "var(--text-info-green)" }}>{fmtMoney(totals.net)}</td>
                    <td colSpan={4} />
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
