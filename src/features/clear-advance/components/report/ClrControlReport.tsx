"use client";

/**
 * AP-3-Control report — one row per AP-3 clearing, linked to its AP-2 advance,
 * with per-step approval stamps. Mirrors the AP-1 report table styling.
 *
 * Data: GET /api/request/clear-advance/report → { ok, data: ClrControlRow[] }.
 * 403 → friendly "no access" state (back-office report).
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, FileX, Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FilterDateRangePicker } from "@/features/accounting/components/FilterDateRangePicker";
import { RequestStatusBadge } from "@/features/accounting/components/RequestStatusBadge";
import { STATUS_LABEL_TH } from "@/features/accounting/constants";
import { clearAdvanceDetailHref } from "@/features/clear-advance/lib/navigation";
import type { ClrControlRow } from "@/lib/clr/clear-advance-report-service";
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

const COLS: { label: string; align: "left" | "right" }[] = [
  { label: "วันที่ส่ง", align: "left" },
  { label: "เลขที่เคลียร์ (ADC)", align: "left" },
  { label: "รหัสพนักงาน", align: "left" },
  { label: "เลขที่ Advance (AP-2)", align: "left" },
  { label: "ชื่อ", align: "left" },
  { label: "แผนก", align: "left" },
  { label: "วงเงินที่ได้รับ", align: "right" },
  { label: "เป็นค่าใช้จ่ายของ", align: "left" },
  { label: "รวมใช้จริง", align: "right" },
  { label: "โอนคืนบริษัท", align: "right" },
  { label: "เบิกเพิ่ม", align: "right" },
  { label: "PV", align: "left" },
  { label: "Payment Date", align: "left" },
  { label: "ผู้จัดการอนุมัติ", align: "left" },
  { label: "บัญชี Action", align: "left" },
  { label: "หัวหน้าบัญชีอนุมัติ", align: "left" },
  { label: "Pending On", align: "left" },
  { label: "สถานะ", align: "left" },
];

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

export function ClrControlReport() {
  const router = useRouter();
  const brands = useClrBrands();

  const [filters, setFilters] = useState<ControlFilters>(EMPTY_FILTERS);
  const [rows, setRows] = useState<ClrControlRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

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
              <table className="w-full text-[12px] border-collapse min-w-[1600px]">
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
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums" style={{ color: "var(--text-secondary)" }}>
                          {fmtDateOnly(row.submittedAt)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="font-semibold underline-offset-2 hover:underline" style={{ color: "var(--nav-active-text)" }}>
                            {row.requestNo ?? "—"}
                          </span>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                          {row.staffId ?? "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                          {row.advanceRequestNo ? (
                            <span
                              className="text-[11px] font-semibold px-1.5 py-0.5 rounded"
                              style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
                            >
                              {row.advanceRequestNo}
                            </span>
                          ) : (
                            <span style={{ color: "var(--text-faint)" }}>—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                          {row.requesterFullName ?? "—"}
                          {row.requesterPosition && (
                            <div className="text-[10px] mt-0.5" style={{ color: "var(--text-faint)" }}>{row.requesterPosition}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                          {row.requesterDepartmentName ?? "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums" style={{ color: "var(--text-primary)" }}>
                          {fmtMoney(row.advanceAmount)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                          {row.expenseOf ?? "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-right tabular-nums font-medium" style={{ color: "var(--color-action)" }}>
                          {fmtMoney(row.actualTotal)}
                        </td>
                        <td
                          className="px-3 py-2 whitespace-nowrap text-right tabular-nums"
                          style={{ color: row.refundToCompany ? "var(--text-info-green)" : "var(--text-faint)" }}
                        >
                          {row.refundToCompany ? fmtMoney(row.refundToCompany) : "—"}
                        </td>
                        <td
                          className="px-3 py-2 whitespace-nowrap text-right tabular-nums"
                          style={{ color: row.extraToEmployee ? "var(--text-info-yellow)" : "var(--text-faint)" }}
                        >
                          {row.extraToEmployee ? fmtMoney(row.extraToEmployee) : "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                          {row.pvDocNo ?? "—"}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums" style={{ color: "var(--text-secondary)" }}>
                          {fmtDateOnly(row.paymentDate)}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <ApprovalCell name={row.managerApprovedName} at={row.managerApprovedAt} />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <ApprovalCell name={row.accountActionedName} at={row.accountActionedAt} />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <ApprovalCell name={row.headApprovedName} at={row.headApprovedAt} />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                          {row.pendingOn ?? <span style={{ color: "var(--text-faint)" }}>—</span>}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <RequestStatusBadge status={row.overallStatus} />
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
                    <td colSpan={COLS.length} className="px-3 py-2.5 font-bold" style={{ color: "var(--text-heading)" }}>
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
