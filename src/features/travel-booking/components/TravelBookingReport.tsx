"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Download, FileX, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SidePanel, SidePanelClose } from "@/components/ui/SidePanel";
import { fmtYmdDisplay } from "@/features/accounting/lib/format-travel-dates";
import { FilterDateRangePicker } from "@/features/accounting/components/FilterDateRangePicker";
import { TravelBookingStatusBadge } from "@/features/travel-booking/components/TravelBookingStatusBadge";
import { ColumnToggleMenu, type ColumnToggleOption } from "@/features/travel-booking/components/ColumnToggleMenu";
import { MultiSelectFilter } from "@/features/travel-booking/components/MultiSelectFilter";
import { TravelBookingDetail } from "@/features/travel-booking/components/TravelBookingDetail";
import { fmtBaht } from "@/features/travel-booking/components/shared";
import { STATUS_LABEL_TH, TRAVEL_BOOKING_STATUSES } from "@/features/travel-booking/constants";
import type {
  ProvinceOption,
  TravelBookingRequest,
  TravelBookingStatus,
  TravelReasonOption,
} from "@/features/travel-booking/types";
import type { TravelBookingReportRow } from "@/lib/acc/travel-booking/report-service";

type DateBasis = "travel" | "submit" | "approve" | "payment";

const DATE_BASIS_OPTIONS: { id: DateBasis; label: string }[] = [
  { id: "submit", label: "วันส่งคำขอ" },
  { id: "travel", label: "วันเดินทาง" },
  { id: "approve", label: "วันที่อนุมัติ" },
  { id: "payment", label: "วันจ่าย" },
];

/** Multi-value filters: an empty array means "no filter" (the old `<select>`'s ทั้งหมด option). */
interface ServerFilters {
  dateBasis: DateBasis;
  from: string;
  to: string;
  provinceIds: string[];
  reasonIds: string[];
  statuses: string[];
}

/** First and last day of the current month as YYYY-MM-DD (local getters — server is Thai time). */
function currentMonthRange(): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(y, m + 1, 0).getDate();
  return { from: `${y}-${pad(m + 1)}-01`, to: `${y}-${pad(m + 1)}-${pad(lastDay)}` };
}

/** Opening state: this month's submissions. Recomputed per call so a long-lived tab isn't stuck. */
function defaultServerFilters(): ServerFilters {
  const { from, to } = currentMonthRange();
  return { dateBasis: "submit", from, to, provinceIds: [], reasonIds: [], statuses: [] };
}

type ColKey =
  | "requestNo" | "brandCode" | "staffId" | "fullName" | "position" | "departmentName"
  | "reasonName" | "workDetail" | "departDate" | "returnDate" | "provinceName"
  | "accommodationName" | "workLocationsCsv" | "approvedDate" | "status"
  | "perDiemRate" | "perDiemDays" | "perDiemTotal" | "paymentDate" | "rateChangeNote";

const ALL_COLUMNS: (ColumnToggleOption<ColKey> & { align?: "right" })[] = [
  { key: "requestNo", label: "เลขที่คำขอ" },
  // Beside the request number, not at the end: the brand is a property of the
  // claim rather than of the journey, and it is per trip — two rows of one
  // group can name different companies.
  { key: "brandCode", label: "แบรนด์ที่เบิก" },
  { key: "staffId", label: "รหัสพนักงาน" },
  { key: "fullName", label: "ชื่อ-นามสกุล" },
  { key: "position", label: "ตำแหน่ง" },
  { key: "departmentName", label: "แผนก" },
  { key: "reasonName", label: "เหตุผลการเดินทาง" },
  { key: "workDetail", label: "รายละเอียดการไปปฏิบัติงาน" },
  { key: "departDate", label: "วันเดินทางขาไป" },
  { key: "returnDate", label: "วันเดินทางขากลับ" },
  { key: "provinceName", label: "จังหวัด" },
  { key: "accommodationName", label: "สถานที่พักค้างคืน" },
  { key: "workLocationsCsv", label: "สถานที่ไปปฏิบัติงาน" },
  { key: "approvedDate", label: "วันที่อนุมัติ" },
  { key: "status", label: "สถานะ" },
  { key: "perDiemRate", label: "เบี้ยเลี้ยง (เรท/วัน)", align: "right" },
  { key: "perDiemDays", label: "เบี้ยเลี้ยง (จำนวนวัน)", align: "right" },
  { key: "perDiemTotal", label: "เบี้ยเลี้ยง (ยอดรวม)", align: "right" },
  { key: "paymentDate", label: "วันที่จ่าย" },
  { key: "rateChangeNote", label: "หมายเหตุการเปลี่ยนเรท" },
];

const DEFAULT_VISIBLE: Record<ColKey, boolean> = ALL_COLUMNS.reduce(
  (acc, c) => ({ ...acc, [c.key]: true }),
  {} as Record<ColKey, boolean>,
);

const COLS_STORAGE_KEY = "ap17-report-cols";

function loadStoredVisibility(): Record<ColKey, boolean> {
  if (typeof window === "undefined") return DEFAULT_VISIBLE;
  try {
    const raw = window.localStorage.getItem(COLS_STORAGE_KEY);
    if (!raw) return DEFAULT_VISIBLE;
    const parsed = JSON.parse(raw) as Partial<Record<ColKey, boolean>>;
    return { ...DEFAULT_VISIBLE, ...parsed };
  } catch {
    return DEFAULT_VISIBLE;
  }
}

function cellValue(
  row: TravelBookingReportRow,
  key: ColKey,
  onOpen: (id: number) => void,
): React.ReactNode {
  switch (key) {
    case "requestNo":
      return row.requestNo ? (
        <button
          type="button"
          onClick={() => onOpen(row.id)}
          title="ดูรายละเอียดคำขอ"
          className="font-bold underline-offset-2 hover:underline cursor-pointer border-none bg-transparent p-0 text-left text-[12px]"
          style={{ color: "var(--nav-active-text)" }}
        >
          {row.requestNo}
        </button>
      ) : (
        "—"
      );
    // A pill, like AP-1's queue shows it — a bare code beside long Thai names
    // reads as noise, and this column is scanned rather than read.
    case "brandCode":
      return row.brandCode ? (
        <span
          className="inline-block px-1.5 py-0.5 rounded text-[11px] font-bold"
          style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
        >
          {row.brandCode}
        </span>
      ) : (
        "—"
      );
    case "staffId": return row.staffId ?? "—";
    case "fullName": return row.fullName ?? "—";
    case "position": return row.position ?? "—";
    case "departmentName": return row.departmentName ?? "—";
    case "reasonName": return row.reasonName ?? "—";
    case "workDetail": return row.workDetail ?? "—";
    case "departDate": return row.departDate ? fmtYmdDisplay(row.departDate) : "—";
    case "returnDate": return row.returnDate ? fmtYmdDisplay(row.returnDate) : "—";
    case "provinceName": return row.provinceName ?? "—";
    case "accommodationName": return row.accommodationName ?? "—";
    case "workLocationsCsv": return row.workLocationsCsv ?? "—";
    case "approvedDate": return row.approvedDate ? fmtYmdDisplay(row.approvedDate) : "—";
    case "status": return <TravelBookingStatusBadge status={row.status} />;
    case "perDiemRate": return row.perDiemRate ?? "—";
    case "perDiemDays": return row.perDiemDays;
    case "perDiemTotal": return fmtBaht(row.perDiemTotal);
    case "paymentDate": return row.paymentDate ? fmtYmdDisplay(row.paymentDate) : "—";
    case "rateChangeNote":
      return row.rateChangeNote ? (
        <span style={{ color: "var(--color-warning)" }}>{row.rateChangeNote}</span>
      ) : (
        "—"
      );
    default: return "—";
  }
}

function buildServerQuery(f: ServerFilters): string {
  const qs = new URLSearchParams();
  qs.set("dateBasis", f.dateBasis);
  if (f.from) qs.set("from", f.from);
  if (f.to) qs.set("to", f.to);
  // Repeated params (not comma-joined) so values containing commas stay intact — the route
  // reads them with searchParams.getAll() and turns each list into an IN (...) predicate.
  for (const v of f.provinceIds) qs.append("provinceId", v);
  for (const v of f.reasonIds) qs.append("reasonId", v);
  for (const v of f.statuses) qs.append("status", v);
  return qs.toString();
}

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-[10px] font-semibold mb-1" style={{ color: "var(--text-muted)" }}>
      {children}
    </span>
  );
}

const selectCls = "w-full text-[12px] px-2.5 py-2 rounded-lg outline-none";
const selectStyle: React.CSSProperties = {
  background: "var(--bg-input)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-input)",
};

/**
 * AP-17 HR report (spec §9) — filters (date-basis/province/reason/status/staff/department),
 * column-visibility toggle (persisted to localStorage), table, Excel export.
 * Mirrors AP-1's `AccountingReport` (AP-15's report is on an unmerged branch, unavailable to copy).
 */
export function TravelBookingReport() {
  const [rows, setRows] = useState<TravelBookingReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const [serverFilters, setServerFilters] = useState<ServerFilters>(defaultServerFilters);
  const [staffId, setStaffId] = useState("");
  const [departmentNames, setDepartmentNames] = useState<string[]>([]);

  const [provinces, setProvinces] = useState<ProvinceOption[]>([]);
  const [reasons, setReasons] = useState<TravelReasonOption[]>([]);

  const [visible, setVisible] = useState<Record<ColKey, boolean>>(DEFAULT_VISIBLE);

  /* Detail drawer — click a เลขที่คำขอ to inspect the request without leaving the report. */
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detail, setDetail] = useState<TravelBookingRequest | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const openDetail = useCallback((id: number) => {
    setDetailId(id);
    setDetail(null);
    setDetailLoading(true);
    fetch(`/api/request/travel-booking/requests/${id}`)
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: TravelBookingRequest }) => {
        setDetail(json.ok ? (json.data ?? null) : null);
      })
      .catch(() => setDetail(null))
      .finally(() => setDetailLoading(false));
  }, []);

  useEffect(() => {
    setVisible(loadStoredVisibility());
  }, []);

  const handleVisibleChange = useCallback((next: Record<ColKey, boolean>) => {
    setVisible(next);
    try {
      window.localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // best-effort — ignore storage failures (private mode / quota)
    }
  }, []);

  useEffect(() => {
    fetch("/api/request/travel-booking/options/provinces")
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: ProvinceOption[] }) => {
        if (json.ok && json.data) setProvinces(json.data);
      })
      .catch(() => {});
    fetch("/api/request/travel-booking/options/settings")
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: { reasons?: TravelReasonOption[] } }) => {
        if (json.ok && json.data?.reasons) setReasons(json.data.reasons);
      })
      .catch(() => {});
  }, []);

  const fetchReport = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    fetch(`/api/request/travel-booking/report?${buildServerQuery(serverFilters)}`)
      .then(async (res) => {
        if (res.status === 403) {
          setLoadError("ไม่มีสิทธิ์เข้าถึงรายงานนี้");
          setRows([]);
          return;
        }
        const json: { ok: boolean; data?: TravelBookingReportRow[]; error?: string } = await res.json();
        if (!res.ok || !json.ok) {
          setLoadError(json.error ?? "โหลดรายงานไม่สำเร็จ");
          setRows([]);
          return;
        }
        setRows(json.data ?? []);
      })
      .catch(() => {
        setLoadError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ — ลองโหลดใหม่อีกครั้ง");
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, [serverFilters]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const provinceOptions = useMemo(
    () => provinces.map((p) => ({ value: String(p.id), label: p.nameTh })),
    [provinces],
  );
  const reasonOptions = useMemo(
    () => reasons.map((r) => ({ value: String(r.id), label: r.name })),
    [reasons],
  );
  const statusOptions = useMemo(
    () =>
      TRAVEL_BOOKING_STATUSES.filter((s) => s !== "Draft").map((s: TravelBookingStatus) => ({
        value: s,
        label: STATUS_LABEL_TH[s],
      })),
    [],
  );

  /** Departments present in the loaded rows — this filter stays client-side. */
  const departmentOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.departmentName) set.add(r.departmentName);
    return Array.from(set).sort().map((d) => ({ value: d, label: d }));
  }, [rows]);

  const filteredRows = useMemo(() => {
    let list = rows;
    if (staffId.trim()) {
      const sid = Number(staffId.trim());
      if (!isNaN(sid)) list = list.filter((r) => r.staffId === sid);
    }
    if (departmentNames.length > 0) {
      list = list.filter((r) => !!r.departmentName && departmentNames.indexOf(r.departmentName) !== -1);
    }
    return list;
  }, [rows, staffId, departmentNames]);

  const totalPerDiem = useMemo(
    () => filteredRows.reduce((sum, r) => sum + r.perDiemTotal, 0),
    [filteredRows],
  );

  const visibleColumns = useMemo(() => ALL_COLUMNS.filter((c) => visible[c.key] ?? true), [visible]);

  const resetFilters = useCallback(() => {
    setServerFilters(defaultServerFilters());
    setStaffId("");
    setDepartmentNames([]);
  }, []);

  // "ล้างตัวกรอง" only shows once something differs from the opening state (this month).
  const defaults = useMemo(defaultServerFilters, []);
  const hasActiveFilters =
    serverFilters.dateBasis !== defaults.dateBasis ||
    serverFilters.from !== defaults.from ||
    serverFilters.to !== defaults.to ||
    serverFilters.provinceIds.length > 0 ||
    serverFilters.reasonIds.length > 0 ||
    serverFilters.statuses.length > 0 ||
    !!staffId.trim() ||
    departmentNames.length > 0;

  const handleExport = useCallback(async () => {
    if (filteredRows.length === 0) {
      toast.error("ไม่มีข้อมูลสำหรับส่งออก");
      return;
    }
    setExporting(true);
    try {
      const qs = new URLSearchParams(buildServerQuery(serverFilters));
      if (staffId.trim()) qs.set("staffId", staffId.trim());
      for (const d of departmentNames) qs.append("departmentName", d);
      const summaryParts: string[] = [];
      if (serverFilters.from || serverFilters.to) {
        const basisLabel = DATE_BASIS_OPTIONS.find((o) => o.id === serverFilters.dateBasis)?.label ?? "";
        summaryParts.push(`${basisLabel}: ${serverFilters.from || "—"} – ${serverFilters.to || "—"}`);
      }
      if (staffId.trim()) summaryParts.push(`รหัสพนักงาน: ${staffId.trim()}`);
      if (departmentNames.length) summaryParts.push(`แผนก: ${departmentNames.join(", ")}`);
      if (summaryParts.length > 0) qs.set("summary", summaryParts.join(" | "));

      const res = await fetch(`/api/request/travel-booking/report/export?${qs.toString()}`);
      if (res.status === 403) {
        toast.error("ไม่มีสิทธิ์ส่งออกข้อมูล");
        return;
      }
      if (!res.ok) {
        toast.error("ส่งออก Excel ไม่สำเร็จ");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "travel-booking-report.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("ดาวน์โหลด Excel สำเร็จ");
    } catch {
      toast.error("เกิดข้อผิดพลาดในการส่งออก");
    } finally {
      setExporting(false);
    }
  }, [filteredRows.length, serverFilters, staffId, departmentNames]);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
        <div className="px-4 py-3 flex flex-col gap-3">
          <div className="rounded-lg p-3" style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-light)" }}>
            <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-4 items-end">
              <div className="min-w-0">
                <FilterLabel>ประเภทวันที่</FilterLabel>
                <div className="inline-flex rounded-lg overflow-hidden text-[11px] font-semibold" style={{ border: "1px solid var(--border-card)" }}>
                  {DATE_BASIS_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setServerFilters((prev) => ({ ...prev, dateBasis: opt.id }))}
                      className="px-3 py-2 cursor-pointer border-none whitespace-nowrap"
                      style={{
                        background: serverFilters.dateBasis === opt.id ? "var(--nav-active-bg)" : "var(--bg-card)",
                        color: serverFilters.dateBasis === opt.id ? "var(--nav-active-text)" : "var(--text-secondary)",
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="min-w-0 lg:border-l lg:pl-4" style={{ borderColor: "var(--border-light)" }}>
                <FilterDateRangePicker
                  label="ช่วงวันที่"
                  from={serverFilters.from}
                  to={serverFilters.to}
                  onChange={(from, to) => setServerFilters((prev) => ({ ...prev, from, to }))}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="min-w-0">
              <FilterLabel>จังหวัด</FilterLabel>
              <MultiSelectFilter
                options={provinceOptions}
                selected={serverFilters.provinceIds}
                onChange={(next) => setServerFilters((prev) => ({ ...prev, provinceIds: next }))}
              />
            </div>
            <div className="min-w-0">
              <FilterLabel>เหตุผลการเดินทาง</FilterLabel>
              <MultiSelectFilter
                options={reasonOptions}
                selected={serverFilters.reasonIds}
                onChange={(next) => setServerFilters((prev) => ({ ...prev, reasonIds: next }))}
              />
            </div>
            <div className="min-w-0">
              <FilterLabel>สถานะ</FilterLabel>
              <MultiSelectFilter
                options={statusOptions}
                selected={serverFilters.statuses}
                onChange={(next) => setServerFilters((prev) => ({ ...prev, statuses: next }))}
              />
            </div>
            <div className="min-w-0">
              <FilterLabel>รหัสพนักงาน</FilterLabel>
              <input
                type="number"
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
                placeholder="เช่น 1234"
                className={selectCls}
                style={selectStyle}
              />
            </div>
            <div className="min-w-0 sm:col-span-2 lg:col-span-2">
              <FilterLabel>แผนก</FilterLabel>
              <MultiSelectFilter
                options={departmentOptions}
                selected={departmentNames}
                onChange={setDepartmentNames}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap justify-between pt-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                {filteredRows.length} รายการ · เบี้ยเลี้ยงรวม {fmtBaht(totalPerDiem)} บาท
              </span>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="text-[11px] font-semibold cursor-pointer border-none bg-transparent underline-offset-2 hover:underline"
                  style={{ color: "var(--nav-active-text)" }}
                >
                  ล้างตัวกรอง
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <ColumnToggleMenu columns={ALL_COLUMNS} visible={visible} onChange={handleVisibleChange} />
              <Button
                variant="secondary"
                size="sm"
                icon={exporting ? undefined : <Download size={14} />}
                loading={exporting}
                disabled={exporting || filteredRows.length === 0}
                onClick={() => void handleExport()}
              >
                ดาวน์โหลด Excel
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-card)" }}>
        {loading ? (
          <div className="flex items-center justify-center py-16" style={{ background: "var(--bg-card)" }}>
            <Loader2 size={24} className="animate-spin" style={{ color: "var(--text-muted)" }} />
          </div>
        ) : loadError ? (
          <div
            className="rounded-xl p-8 flex flex-col items-center gap-4 text-center"
            style={{ background: "var(--bg-card)" }}
          >
            <AlertCircle size={32} style={{ color: "var(--color-warning)" }} />
            <p className="text-[13px] m-0" style={{ color: "var(--text-muted)" }}>{loadError}</p>
            <Button variant="secondary" size="sm" icon={<RefreshCw size={14} />} onClick={() => void fetchReport()}>
              โหลดใหม่
            </Button>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center" style={{ background: "var(--bg-card)" }}>
            <FileX size={32} style={{ color: "var(--text-muted)" }} />
            <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
              {rows.length === 0 ? "ยังไม่มีข้อมูลรายงาน" : "ไม่พบข้อมูลตามเงื่อนไขที่ระบุ"}
            </p>
          </div>
        ) : (
          <div
            className="overflow-x-auto no-scrollbar max-h-[min(70vh,720px)] overflow-y-auto"
            style={{ background: "var(--bg-card)" }}
          >
            <table className="w-full text-[12px] border-collapse min-w-[900px]">
              <thead className="sticky top-0 z-10" style={{ background: "var(--bg-card-alt)", boxShadow: "0 1px 0 var(--border-light)" }}>
                <tr style={{ borderBottom: "1px solid var(--border-light)" }}>
                  {visibleColumns.map((col) => (
                    <th
                      key={col.key}
                      className={`px-3 py-2.5 font-semibold whitespace-nowrap text-${col.align === "right" ? "right" : "left"}`}
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, idx) => {
                  const rowBg = idx % 2 === 0 ? "transparent" : "color-mix(in srgb, var(--bg-card) 50%, var(--bg-main))";
                  return (
                    <tr key={row.id} style={{ background: rowBg, borderBottom: "1px solid var(--border-light)" }}>
                      {visibleColumns.map((col) => (
                        <td
                          key={col.key}
                          className={`px-3 py-2 ${col.align === "right" ? "text-right tabular-nums" : ""}`}
                          style={{ color: "var(--text-primary)", maxWidth: 260 }}
                        >
                          {cellValue(row, col.key, openDetail)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  {/* sticky + background live on the CELL: a background painted on a stuck <tr>
                      or <tfoot> isn't rendered, which let rows show through the total bar. */}
                  <td
                    colSpan={visibleColumns.length}
                    className="sticky bottom-0 z-10 px-3 py-2.5 font-bold"
                    style={{
                      color: "var(--text-heading)",
                      background: "var(--bg-card-alt)",
                      borderTop: "2px solid var(--border-card)",
                      boxShadow: "0 -1px 0 var(--border-light)",
                    }}
                  >
                    รวมทั้งหมด ({filteredRows.length} รายการ) — เบี้ยเลี้ยงรวม {fmtBaht(totalPerDiem)} บาท
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <SidePanel open={detailId != null} onClose={() => setDetailId(null)} width="min(720px, 100vw)" zIndex={50}>
        <div
          className="flex items-center justify-between px-4 py-3 shrink-0"
          style={{ borderBottom: "1px solid var(--border-light)" }}
        >
          <div className="min-w-0">
            <p className="text-[14px] font-bold truncate m-0" style={{ color: "var(--text-heading)" }}>
              {detail?.requestNo ?? "รายละเอียดคำขอ"}
            </p>
            <p className="text-[11px] m-0 mt-0.5" style={{ color: "var(--text-muted)" }}>
              ตรวจสอบรายละเอียดและเอกสารแนบ
            </p>
          </div>
          <SidePanelClose onClick={() => setDetailId(null)} />
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-4 acc-theme">
          {detailLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin" style={{ color: "var(--text-muted)" }} />
            </div>
          ) : detail ? (
            /* Read-only: the report is for looking things up — Admin work happens in the queue. */
            <TravelBookingDetail request={detail} readOnlyBooking />
          ) : (
            <p className="text-[13px] py-16 text-center" style={{ color: "var(--text-muted)" }}>
              โหลดรายละเอียดไม่สำเร็จ
            </p>
          )}
        </div>
      </SidePanel>
    </div>
  );
}
