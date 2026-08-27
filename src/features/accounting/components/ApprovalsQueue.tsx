"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import {
  Inbox,
  AlertCircle,
  Loader2,
  Check,
  ThumbsDown,
  Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { SidePanel, SidePanelClose } from "@/components/ui/SidePanel";
import { RequestDetail } from "@/features/accounting/components/RequestDetail";
import { PaymentDatePicker } from "@/features/accounting/components/PaymentDatePicker";
import { TravelExpenseLoadingPopup } from "@/features/accounting/components/TravelExpenseLoadingPopup";
import {
  ApprovalQueueFilters,
  QueueToolbar,
  applyQueueFilters,
  CellTruncate,
  EMPTY_QUEUE_FILTERS,
  fmtDateOnly,
  fmtMoney,
  hasQueueFilters,
  type QueueFilters,
} from "@/features/accounting/components/ApprovalQueueFilters";
import { fmtReportTravelDate, fmtYmdDisplay } from "@/features/accounting/lib/format-travel-dates";
import { fmtReportVehicleNames, reportVehicleNames } from "@/features/accounting/lib/travel-sections";
import type { ReportRow, ReportTravelDayLine, ReportTravelVehicleLine } from "@/lib/acc/report-service";
import type { AccRequest } from "@/features/accounting/types";
import { ErpInterfaceBrandTabs } from "@/features/accounting/components/ErpInterfaceBrandTabs";
import type { ErpJournalBuildContext } from "@/lib/acc/erp-journal-builder";
import {
  countRowsByInterfaceTarget,
  filterRowsByInterfaceTarget,
} from "@/features/accounting/lib/erp-interface-target";

/* ── Helpers ── */

function fmtDayVehicleLabel(names: string[]): string {
  if (names.length === 0) return "—";
  return names.join(", ");
}

interface ApprovalDisplayRow {
  key: string;
  row: ReportRow;
  dayLine: ReportTravelDayLine | null;
  vehicleLine: ReportTravelVehicleLine | null;
}

interface GroupedApprovalRow extends ApprovalDisplayRow {
  requestGroupSize: number;
  requestGroupIndex: number;
  dayGroupSize: number;
  dayGroupIndex: number;
}

function vehiclesForDayLine(dayLine: ReportTravelDayLine): ReportTravelVehicleLine[] {
  if (dayLine.vehicles.length > 0) return dayLine.vehicles;
  if (dayLine.vehicleNames.length === 0) return [];
  return dayLine.vehicleNames.map((name) => ({
    vehicleName: name,
    amount: dayLine.vehicleNames.length === 1 ? dayLine.totalAmount : 0,
  }));
}

/** One table row per vehicle within each travel day. */
function expandApprovalRows(rows: ReportRow[]): ApprovalDisplayRow[] {
  const out: ApprovalDisplayRow[] = [];
  for (const row of rows) {
    const lines = row.travelDayLines;
    if (lines && lines.length > 0) {
      for (const line of lines) {
        const vehicles = vehiclesForDayLine(line);
        if (vehicles.length === 0) {
          out.push({ key: `${row.id}-${line.travelDate}`, row, dayLine: line, vehicleLine: null });
          continue;
        }
        for (let vi = 0; vi < vehicles.length; vi++) {
          const vehicleLine = vehicles[vi];
          out.push({
            key: `${row.id}-${line.travelDate}-${vi}-${vehicleLine.vehicleName}`,
            row,
            dayLine: line,
            vehicleLine,
          });
        }
      }
    } else {
      out.push({ key: String(row.id), row, dayLine: null, vehicleLine: null });
    }
  }
  return out;
}

function withRequestGroupMeta(rows: ApprovalDisplayRow[]): GroupedApprovalRow[] {
  const out: GroupedApprovalRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const requestId = rows[i].row.id;
    let reqEnd = i + 1;
    while (reqEnd < rows.length && rows[reqEnd].row.id === requestId) reqEnd += 1;
    const requestGroupSize = reqEnd - i;

    let j = i;
    while (j < reqEnd) {
      const travelDate = rows[j].dayLine?.travelDate ?? "";
      let dayEnd = j + 1;
      while (dayEnd < reqEnd && (rows[dayEnd].dayLine?.travelDate ?? "") === travelDate) dayEnd += 1;
      const dayGroupSize = dayEnd - j;

      for (let k = j; k < dayEnd; k++) {
        out.push({
          ...rows[k],
          requestGroupSize,
          requestGroupIndex: k - i,
          dayGroupSize,
          dayGroupIndex: k - j,
        });
      }
      j = dayEnd;
    }
    i = reqEnd;
  }
  return out;
}

function displayTravelDate(row: ReportRow, dayLine: ReportTravelDayLine | null): string {
  if (dayLine) return fmtYmdDisplay(dayLine.travelDate);
  return fmtReportTravelDate(row);
}

function displayDayAmount(
  row: ReportRow,
  dayLine: ReportTravelDayLine | null,
  vehicleLine: ReportTravelVehicleLine | null,
): number | null {
  if (vehicleLine) return vehicleLine.amount;
  if (dayLine) return dayLine.totalAmount;
  return row.totalAmount;
}

function displayRowVehicle(
  row: ReportRow,
  dayLine: ReportTravelDayLine | null,
  vehicleLine: ReportTravelVehicleLine | null,
): string {
  if (vehicleLine?.vehicleName) return vehicleLine.vehicleName;
  if (dayLine?.vehicleNames?.length) return fmtDayVehicleLabel(dayLine.vehicleNames);
  return fmtReportVehicleNames(row);
}

function displayDayWorkDetail(row: ReportRow, dayLine: ReportTravelDayLine | null): string | null {
  if (dayLine?.workDetail?.trim()) return dayLine.workDetail.trim();
  return row.workDetail?.trim() || null;
}

function fmtPaymentLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return ymd;
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

interface PaymentDatesResponse {
  ok: boolean;
  data?: { dates: string[]; default: string | null };
}

interface BatchResult {
  ok: number[];
  fail: { id: number; requestNo: string | null; error: string }[];
}

/** Styled row-selection checkbox (matches acc-theme). */
function QueueCheckbox({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className="w-[18px] h-[18px] rounded-[6px] flex items-center justify-center shrink-0 cursor-pointer transition-all border-none p-0"
      style={{
        background: checked ? "var(--text-info-green)" : "var(--bg-card)",
        boxShadow: checked
          ? "0 0 0 2px color-mix(in srgb, var(--text-info-green) 28%, transparent)"
          : "inset 0 0 0 1.5px var(--border-card)",
      }}
    >
      {checked && <Check size={11} strokeWidth={3} style={{ color: "var(--bg-card)" }} />}
    </button>
  );
}

/* ── ApprovalsQueue ── */

/**
 * Was the manager's approval before noon, Bangkok?
 *
 * Read back through the Bangkok timezone rather than through the browser's: a
 * laptop set to another zone would otherwise flip the label right on the
 * boundary, which is the one place it matters.
 */
function managerApprovedBeforeNoon(iso: string): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Bangkok",
      hour: "2-digit",
      hour12: false,
    }).format(new Date(iso)),
  );
  return hour < 12;
}

/** `dd/MM HH:mm` — the year is noise in a queue of this month's work. */
function fmtDateTimeShort(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/**
 * The payment round on a queue row: a pill that opens the calendar.
 *
 * A `<select>` of ISO dates was the first cut and is worse than it looks — the
 * rounds are a fortnight apart and a flat list of them tells you nothing about
 * which month you are in, or that the 25th is the 4th Friday. The calendar shows
 * the shape; this only shows the answer.
 */
function PaymentDatePill({
  value,
  onEdit,
  saving,
}: {
  value: string | null;
  onEdit: () => void;
  saving: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onEdit}
      disabled={saving}
      title="คลิกเพื่อเลือกวันจ่าย"
      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11.5px] font-semibold cursor-pointer border-none disabled:opacity-60"
      style={
        value
          ? { background: "var(--status-ok-bg)", color: "var(--status-ok-text)" }
          : { background: "var(--bg-badge)", color: "var(--text-faint)" }
      }
    >
      {saving ? "..." : value ? fmtPaymentLabel(value) : "— เลือก —"}
      <Pencil size={11} />
    </button>
  );
}

export function ApprovalsQueue({
  interfaceTarget,
  onInterfaceTargetChange,
  visibleInterfaceCodes = null,
  showUnassignedTab = true,
}: {
  interfaceTarget: string;
  onInterfaceTargetChange: (code: string) => void;
  visibleInterfaceCodes?: string[] | null;
  showUnassignedTab?: boolean;
}) {
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [interfaceByClaim, setInterfaceByClaim] = useState<Record<string, string>>({});
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  const [filters, setFilters] = useState<QueueFilters>(EMPTY_QUEUE_FILTERS);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [drawerDetail, setDrawerDetail] = useState<AccRequest | null>(null);
  const [loadingDrawer, setLoadingDrawer] = useState(false);

  const [paymentDates, setPaymentDates] = useState<string[]>([]);
  /**
   * Rows whose payment date was edited in place, by request id.
   *
   * Held here rather than refetching the whole queue: the edit is one field and
   * a refetch would rebuild every row, losing the selection the accountant is
   * part-way through making.
   */
  const [rowPaymentDates, setRowPaymentDates] = useState<Record<number, string>>({});
  const [editingPaymentId, setEditingPaymentId] = useState<number | null>(null);
  const [savingPaymentId, setSavingPaymentId] = useState<number | null>(null);
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentDatesLoading, setPaymentDatesLoading] = useState(true);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0 });
  const [batchResult, setBatchResult] = useState<BatchResult | null>(null);

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState<number | null>(null);
  const [rejectComment, setRejectComment] = useState("");
  const [rejecting, setRejecting] = useState(false);

  const [calendarOpen, setCalendarOpen] = useState(false);

  const fetchQueue = useCallback(() => {
    setLoadingQueue(true);
    Promise.all([
      fetch("/api/request/accounting/report?status=ManagerApproved"),
      fetch("/api/request/accounting/erp-prep/journal-context"),
    ])
      .then(async ([listRes, ctxRes]) => {
        if (listRes.status === 403) {
          setForbidden(true);
          return;
        }
        const listJson: { ok: boolean; data?: ReportRow[]; error?: string } = await listRes.json();
        const ctxJson: { ok: boolean; data?: ErpJournalBuildContext; error?: string } = await ctxRes.json();
        if (listJson.ok && listJson.data) {
          setRows(listJson.data);
        } else {
          toast.error(listJson.error ?? "โหลดข้อมูลไม่สำเร็จ");
        }
        if (ctxJson.ok && ctxJson.data) {
          setInterfaceByClaim(ctxJson.data.interfaceByClaim ?? {});
        }
      })
      .catch(() => toast.error("เกิดข้อผิดพลาดในการโหลดรายการ"))
      .finally(() => setLoadingQueue(false));
  }, []);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  useEffect(() => {
    setPaymentDatesLoading(true);
    fetch("/api/request/accounting/payment-dates")
      .then((r) => r.json())
      .then((json: PaymentDatesResponse) => {
        if (json.ok && json.data) {
          setPaymentDates(json.data.dates);
          setPaymentDate(json.data.default ?? json.data.dates[0] ?? "");
        }
      })
      .catch(() => {})
      .finally(() => setPaymentDatesLoading(false));
  }, []);

  useEffect(() => {
    if (drawerId == null) {
      setDrawerDetail(null);
      return;
    }

    let cancelled = false;
    setLoadingDrawer(true);
    setDrawerDetail(null);

    fetch(`/api/request/accounting/requests/${drawerId}`)
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: AccRequest; error?: string }) => {
        if (cancelled) return;
        if (json.ok && json.data) setDrawerDetail(json.data);
        else toast.error(json.error ?? "โหลดรายละเอียดไม่สำเร็จ");
      })
      .catch(() => {
        if (!cancelled) toast.error("เกิดข้อผิดพลาดในการโหลดรายละเอียด");
      })
      .finally(() => {
        if (!cancelled) setLoadingDrawer(false);
      });

    return () => { cancelled = true; };
  }, [drawerId]);

  const brandOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.brandCode) set.add(r.brandCode);
    }
    return Array.from(set).sort();
  }, [rows]);

  const departmentOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.requesterDepartmentName) set.add(r.requesterDepartmentName);
    }
    return Array.from(set).sort();
  }, [rows]);

  const vehicleOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      for (const name of reportVehicleNames(r)) set.add(name);
    }
    return Array.from(set).sort();
  }, [rows]);

  const hasActiveFilters = useMemo(() => hasQueueFilters(filters), [filters]);

  const filteredRows = useMemo(
    () => applyQueueFilters(rows, filters),
    [rows, filters],
  );

  const ifaceCounts = useMemo(
    () => countRowsByInterfaceTarget(rows, interfaceByClaim),
    [rows, interfaceByClaim],
  );

  const ifaceFilteredRows = useMemo(
    () => filterRowsByInterfaceTarget(filteredRows, interfaceByClaim, interfaceTarget),
    [filteredRows, interfaceByClaim, interfaceTarget],
  );

  const displayRows = useMemo(
    () => expandApprovalRows(ifaceFilteredRows),
    [ifaceFilteredRows],
  );

  const groupedDisplayRows = useMemo(
    () => withRequestGroupMeta(displayRows),
    [displayRows],
  );

  const editingRow = useMemo(
    () => (editingPaymentId == null ? null : displayRows.find((d) => d.row.id === editingPaymentId)?.row ?? null),
    [editingPaymentId, displayRows],
  );

  /**
   * Save one row's round.
   *
   * Optimistic only in the sense that the pill re-reads from `rowPaymentDates`
   * — the value is written there **after** the server has answered, so a
   * refused date leaves the old one on screen rather than a figure the database
   * never took.
   */
  const savePaymentDate = useCallback(async (id: number, date: string) => {
    if (!date) return;
    setSavingPaymentId(id);
    try {
      const res = await fetch(`/api/request/accounting/requests/${id}/payment-date`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentDate: date }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        // The server's own reason — "not a payment round", "already approved".
        toast.error(json?.error ?? "บันทึกวันจ่ายไม่สำเร็จ");
        return;
      }
      setRowPaymentDates((prev) => ({ ...prev, [id]: date }));
      toast.success(`วันจ่าย ${fmtPaymentLabel(date)}`);
      setEditingPaymentId(null);
    } catch {
      toast.error("บันทึกวันจ่ายไม่สำเร็จ");
    } finally {
      setSavingPaymentId(null);
    }
  }, []);

  const selectedRows = useMemo(
    () => ifaceFilteredRows.filter((r) => selectedIds.has(r.id)),
    [ifaceFilteredRows, selectedIds],
  );

  const selectedTotal = useMemo(
    () => selectedRows.reduce((s, r) => s + (r.totalAmount ?? 0), 0),
    [selectedRows],
  );

  const allFilteredSelected =
    ifaceFilteredRows.length > 0 && ifaceFilteredRows.every((r) => selectedIds.has(r.id));

  const canBatchApprove =
    selectedRows.length > 0 && !!paymentDate && !batchRunning;

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const r of ifaceFilteredRows) next.delete(r.id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const r of ifaceFilteredRows) next.add(r.id);
        return next;
      });
    }
  }

  function removeFromQueue(ids: number[]) {
    const idSet = new Set(ids);
    setRows((prev) => prev.filter((r) => !idSet.has(r.id)));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
    if (drawerId != null && idSet.has(drawerId)) {
      setDrawerId(null);
      setDrawerDetail(null);
    }
  }

  async function runBatchApprove(ids: number[]) {
    setBatchRunning(true);
    setBatchProgress({ done: 0, total: ids.length });
    const result: BatchResult = { ok: [], fail: [] };

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const row = rows.find((r) => r.id === id);
      try {
        const res = await fetch(`/api/request/accounting/requests/${id}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentDate, isChecked: true }),
        });
        const json: { ok: boolean; error?: string } = await res.json();
        if (json.ok) result.ok.push(id);
        else {
          result.fail.push({
            id,
            requestNo: row?.requestNo ?? null,
            error: json.error ?? "อนุมัติไม่สำเร็จ",
          });
        }
      } catch {
        result.fail.push({
          id,
          requestNo: row?.requestNo ?? null,
          error: "เกิดข้อผิดพลาด",
        });
      }
      setBatchProgress({ done: i + 1, total: ids.length });
    }

    setBatchResult(result);
    setBatchRunning(false);

    if (result.ok.length > 0) {
      removeFromQueue(result.ok);
      toast.success(`อนุมัติแล้ว ${result.ok.length} รายการ`);
    }
    if (result.fail.length > 0) {
      toast.error(`อนุมัติไม่สำเร็จ ${result.fail.length} รายการ`);
    }
  }

  function handleConfirmBatch() {
    if (!canBatchApprove) return;
    const ids = selectedRows.map((r) => r.id);
    setConfirmOpen(false);
    void runBatchApprove(ids);
  }

  async function handleRejectConfirm() {
    if (!rejectTargetId || !rejectComment.trim()) return;
    setRejecting(true);
    try {
      const res = await fetch(`/api/request/accounting/requests/${rejectTargetId}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: rejectComment.trim() }),
      });
      const json: { ok: boolean; error?: string } = await res.json();
      if (json.ok) {
        toast.success("ไม่อนุมัติแล้ว");
        removeFromQueue([rejectTargetId]);
        setRejectOpen(false);
        setRejectComment("");
        setRejectTargetId(null);
      } else {
        toast.error(json.error ?? "ดำเนินการไม่สำเร็จ");
      }
    } catch {
      toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
    } finally {
      setRejecting(false);
    }
  }

  function openReject(id: number) {
    setRejectTargetId(id);
    setRejectComment("");
    setRejectOpen(true);
  }

  if (forbidden) {
    return (
      <div
        className="rounded-xl p-8 flex flex-col items-center gap-3 text-center"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
      >
        <AlertCircle size={32} style={{ color: "var(--text-muted)" }} />
        <p className="text-[14px] font-medium" style={{ color: "var(--text-heading)" }}>
          ไม่มีสิทธิ์เข้าถึง
        </p>
        <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
          หน้านี้สำหรับผู้อนุมัติฝ่ายบัญชีเท่านั้น
        </p>
      </div>
    );
  }

  if (loadingQueue) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="animate-spin" style={{ color: "var(--text-muted)" }} />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div
        className="rounded-xl p-10 flex flex-col items-center gap-3 text-center"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
      >
        <Inbox size={32} style={{ color: "var(--text-muted)" }} />
        <p className="text-[14px] font-medium" style={{ color: "var(--text-heading)" }}>
          ไม่มีคำขอที่รออนุมัติ
        </p>
        <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
          คำขอที่ผ่านการอนุมัติจากผู้จัดการแล้วจะแสดงที่นี่
        </p>
      </div>
    );
  }

  return (
    <div className={selectedRows.length > 0 ? "pb-28" : ""}>
      <ErpInterfaceBrandTabs
        activeCode={interfaceTarget}
        onChange={onInterfaceTargetChange}
        counts={ifaceCounts}
        visibleCodes={visibleInterfaceCodes}
        showUnassigned={showUnassignedTab}
        className="mb-4"
      />

      {ifaceFilteredRows.length === 0 ? (
        <div
          className="rounded-xl p-10 flex flex-col items-center gap-3 text-center"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
        >
          <Inbox size={32} style={{ color: "var(--text-muted)" }} />
          <p className="text-[14px] font-medium" style={{ color: "var(--text-heading)" }}>
            ไม่มีรายการในกลุ่มนี้
          </p>
          <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
            ลองเลือกกลุ่ม Interface อื่น หรือปรับตัวกรอง
          </p>
        </div>
      ) : (
        <>
      <div className="rounded-xl px-4 py-3 mb-4 flex flex-col gap-4" style={{ border: "1px solid var(--border-light)" }}>
        <QueueToolbar
          countLabel="รออนุมัติ"
          filteredCount={ifaceFilteredRows.length}
          totalCount={rows.length}
          hasActiveFilters={hasActiveFilters}
          onClearFilters={() => setFilters(EMPTY_QUEUE_FILTERS)}
          extra={
            selectedRows.length > 0 ? (
              <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
                เลือก {selectedRows.length} · รวม <strong>{fmtMoney(selectedTotal)}</strong> บาท
              </span>
            ) : undefined
          }
        />

        <ApprovalQueueFilters
          filters={filters}
          onChange={setFilters}
          brandOptions={brandOptions}
          departmentOptions={departmentOptions}
          vehicleOptions={vehicleOptions}
        />
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-light)" }}>
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full text-[12px] min-w-[1100px]">
            <thead>
              <tr style={{ background: "var(--bg-card-header)", borderBottom: "1px solid var(--border-light)" }}>
                <th className="w-11 px-3 py-2.5">
                  <QueueCheckbox
                    checked={allFilteredSelected}
                    onChange={toggleSelectAll}
                    ariaLabel="เลือกทั้งหมด"
                  />
                </th>
                <th className="text-left px-3 py-2.5 font-semibold whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>เลขที่</th>
                <th className="text-left px-3 py-2.5 font-semibold whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>วันที่ส่ง</th>
                <th className="text-center px-3 py-2.5 font-semibold whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>ผจก. อนุมัติ</th>
                <th className="text-center px-3 py-2.5 font-semibold whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>วันจ่าย</th>
                <th className="text-left px-3 py-2.5 font-semibold" style={{ color: "var(--text-secondary)" }}>ผู้ขอ</th>
                <th className="text-left px-3 py-2.5 font-semibold hidden lg:table-cell" style={{ color: "var(--text-secondary)" }}>แผนก</th>
                <th className="text-center px-3 py-2.5 font-semibold whitespace-nowrap hidden lg:table-cell" style={{ color: "var(--text-secondary)" }}>Dept</th>
                <th className="text-left px-3 py-2.5 font-semibold whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>แบรนด์</th>
                <th className="text-left px-3 py-2.5 font-semibold whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>เดินทาง</th>
                <th className="text-left px-3 py-2.5 font-semibold hidden md:table-cell" style={{ color: "var(--text-secondary)" }}>ยานพาหนะ</th>
                <th className="text-left px-3 py-2.5 font-semibold hidden xl:table-cell" style={{ color: "var(--text-secondary)" }}>รายละเอียดงาน</th>
                <th className="text-right px-3 py-2.5 font-semibold whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>ยอด</th>
              </tr>
            </thead>
            <tbody>
              {groupedDisplayRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={13}
                    className="px-4 py-10 text-center text-[13px]"
                    style={{ color: "var(--text-muted)" }}
                  >
                    ไม่พบรายการที่ตรงกับตัวกรอง
                  </td>
                </tr>
              ) : groupedDisplayRows.map(({
                key,
                row,
                dayLine,
                vehicleLine,
                requestGroupSize,
                requestGroupIndex,
                dayGroupSize,
                dayGroupIndex,
              }) => {
                const isSelected = selectedIds.has(row.id);
                const dayAmount = displayDayAmount(row, dayLine, vehicleLine);
                const isRequestGroupStart = requestGroupIndex === 0;
                const isDayGroupStart = dayGroupIndex === 0;
                const travelDayCount = row.dayCount ?? row.travelDayLines?.length ?? 0;
                const selectedBg = isSelected
                  ? "color-mix(in srgb, var(--bg-info-green) 65%, transparent)"
                  : undefined;
                const sharedCellStyle: React.CSSProperties = {
                  verticalAlign: "top",
                  background: selectedBg,
                };
                return (
                  <tr
                    key={key}
                    className="transition-colors"
                    style={{
                      borderBottom: "1px solid var(--border-light)",
                      background: selectedBg,
                    }}
                  >
                    {isRequestGroupStart ? (
                      <>
                        <td className="px-3 py-2.5" rowSpan={requestGroupSize} style={sharedCellStyle}>
                          <QueueCheckbox
                            checked={isSelected}
                            onChange={() => toggleSelect(row.id)}
                            ariaLabel={`เลือกและตรวจ ${row.requestNo ?? row.id}`}
                          />
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap" rowSpan={requestGroupSize} style={sharedCellStyle}>
                          <button
                            type="button"
                            onClick={() => setDrawerId(row.id)}
                            className="font-semibold cursor-pointer border-none bg-transparent p-0 text-left underline-offset-2 hover:underline"
                            style={{ color: "var(--nav-active-text)" }}
                            title="ดูรายละเอียด"
                          >
                            {row.requestNo ?? "—"}
                          </button>
                          {travelDayCount > 1 ? (
                            <p className="text-[10px] m-0 mt-1 tabular-nums" style={{ color: "var(--text-faint)" }}>
                              {travelDayCount} วัน
                            </p>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap" rowSpan={requestGroupSize} style={{ ...sharedCellStyle, color: "var(--text-muted)" }}>
                          {fmtDateOnly(row.submittedAt)}
                        </td>
                        {/* ผจก. อนุมัติ — with the noon label beneath it. The
                            cut-off is the company's payment process, not a rule
                            either app enforces: getDefaultPaymentDate takes the
                            next round regardless, here and in ACC Portal. This
                            tells the accountant which round the claim is *meant*
                            for; วันจ่าย beside it is where they act on that. */}
                        <td className="px-3 py-2.5 whitespace-nowrap text-center" rowSpan={requestGroupSize} style={sharedCellStyle}>
                          {row.managerApprovedAt ? (
                            <>
                              <p className="m-0 text-[11.5px]" style={{ color: "var(--text-secondary)" }}>
                                {fmtDateTimeShort(row.managerApprovedAt)}
                              </p>
                              <p
                                className="m-0 text-[10px]"
                                style={{
                                  color: managerApprovedBeforeNoon(row.managerApprovedAt)
                                    ? "var(--color-success)"
                                    : "var(--color-warning)",
                                }}
                              >
                                {managerApprovedBeforeNoon(row.managerApprovedAt) ? "ก่อนเที่ยง" : "หลังเที่ยง"}
                              </p>
                            </>
                          ) : (
                            <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-center" rowSpan={requestGroupSize} style={sharedCellStyle}>
                          <PaymentDatePill
                            value={rowPaymentDates[row.id] ?? row.paymentDate ?? null}
                            onEdit={() => setEditingPaymentId(row.id)}
                            saving={savingPaymentId === row.id}
                          />
                        </td>
                        <td className="px-3 py-2.5" rowSpan={requestGroupSize} style={sharedCellStyle}>
                          <CellTruncate text={row.requesterFullName} maxWidth={130} style={{ color: "var(--text-primary)" }} />
                        </td>
                        <td className="px-3 py-2.5 hidden lg:table-cell" rowSpan={requestGroupSize} style={sharedCellStyle}>
                          <CellTruncate text={row.requesterDepartmentName} maxWidth={110} />
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-center hidden lg:table-cell" rowSpan={requestGroupSize} style={sharedCellStyle}>
                          {row.requesterDepartmentCode ? (
                            <span
                              className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                              style={{ background: "var(--bg-badge)", color: "var(--text-muted)", border: "1px solid var(--border-light)" }}
                            >
                              {row.requesterDepartmentCode}
                            </span>
                          ) : (
                            <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap" rowSpan={requestGroupSize} style={sharedCellStyle}>
                          {row.brandCode ? (
                            <span
                              className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                              style={{ background: "var(--bg-badge)", color: "var(--text-muted)", border: "1px solid var(--border-light)" }}
                            >
                              {row.brandCode}
                            </span>
                          ) : (
                            <span style={{ color: "var(--text-faint)" }}>—</span>
                          )}
                        </td>
                      </>
                    ) : null}
                    {isDayGroupStart ? (
                      <td
                        className="px-3 py-2.5 whitespace-nowrap tabular-nums"
                        rowSpan={dayGroupSize}
                        style={{ color: "var(--text-muted)", background: selectedBg, verticalAlign: "top" }}
                      >
                        {displayTravelDate(row, dayLine)}
                      </td>
                    ) : null}
                    <td className="px-3 py-2.5 hidden md:table-cell" style={{ background: selectedBg }}>
                      <span className="text-[12px] leading-tight" style={{ color: "var(--text-secondary)" }}>
                        {displayRowVehicle(row, dayLine, vehicleLine)}
                      </span>
                    </td>
                    {isDayGroupStart ? (
                      <td
                        className="px-3 py-2.5 hidden xl:table-cell"
                        rowSpan={dayGroupSize}
                        style={{ background: selectedBg, verticalAlign: "top" }}
                      >
                        <CellTruncate text={displayDayWorkDetail(row, dayLine)} maxWidth={200} />
                      </td>
                    ) : null}
                    <td className="px-3 py-2.5 text-right" style={{ background: selectedBg }}>
                      <span className="tabular-nums font-bold whitespace-nowrap" style={{ color: "var(--color-action)" }}>
                        {fmtMoney(dayAmount)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

        </>
      )}

      {/* Sticky batch bar */}
      {selectedRows.length > 0 && (
        <div
          className="fixed bottom-0 left-0 right-0 z-30 px-4 py-3"
          style={{
            background: "var(--bg-card)",
            borderTop: "1px solid var(--border-card)",
            boxShadow: "0 -4px 24px rgba(0,0,0,0.08)",
          }}
        >
          <div className="max-w-5xl mx-auto flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>
                เลือก {selectedRows.length} รายการ · รวม {fmtMoney(selectedTotal)} บาท
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                {paymentDate ? "เลือกวันจ่ายแล้ว — กดอนุมัติได้" : "เลือกวันจ่ายก่อนอนุมัติ"}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setCalendarOpen(true)}
                disabled={paymentDatesLoading}
                className="text-[12px] font-medium px-3 py-2 rounded-xl cursor-pointer"
                style={{
                  background: "var(--bg-card-alt)",
                  color: paymentDate ? "var(--text-primary)" : "var(--text-muted)",
                  border: "1px solid var(--border-card)",
                }}
              >
                วันจ่าย: {paymentDate ? fmtPaymentLabel(paymentDate) : "เลือก..."}
              </button>

              <Button
                type="button"
                variant="primary"
                size="md"
                disabled={!canBatchApprove}
                loading={batchRunning}
                onClick={() => setConfirmOpen(true)}
              >
                อนุมัติที่เลือก ({selectedRows.length})
              </Button>
            </div>
          </div>
        </div>
      )}

      {batchRunning ? (
        <TravelExpenseLoadingPopup
          label="กำลังอนุมัติ..."
          subtitle="กรุณารอสักครู่ อย่าปิดหรือรีเฟรชหน้านี้"
          progress={batchProgress}
        />
      ) : null}

      {/* Payment round — one request at a time, saved on change.

          A calendar rather than a list: the rounds are a fortnight apart, and
          seeing that the 25th is the 4th Friday of the month is most of what
          makes a date the right one. */}
      <Dialog
        open={editingPaymentId != null}
        onOpenChange={(open) => { if (!open && savingPaymentId == null) setEditingPaymentId(null); }}
        title={editingRow ? `วันที่จ่าย · ${editingRow.requestNo ?? ""}` : "เลือกวันที่จ่าย"}
      >
        {/* Why this claim lands where it does. The rule turns on the manager's
            clock, which is not visible from a calendar, so the calendar has to
            say it. */}
        {editingRow?.managerApprovedAt && (
          <p className="text-[11px] mb-2 px-1 leading-relaxed" style={{ color: "var(--text-muted)" }}>
            ผจก. อนุมัติ {fmtDateTimeShort(editingRow.managerApprovedAt)} —{" "}
            <strong>
              {managerApprovedBeforeNoon(editingRow.managerApprovedAt) ? "ก่อนเที่ยง" : "หลังเที่ยง"}
            </strong>
            {editingRow.suggestedPaymentDate ? ` จึงเข้ารอบ ${fmtPaymentLabel(editingRow.suggestedPaymentDate)}` : ""}
            <br />
            ก่อนเที่ยงเข้ารอบจ่ายถัดไป · ตั้งแต่เที่ยงข้ามไปอีกหนึ่งรอบ
          </p>
        )}
        <PaymentDatePicker
          dates={paymentDates}
          value={
            editingRow
              ? rowPaymentDates[editingRow.id] ?? editingRow.paymentDate ?? ""
              : ""
          }
          onChange={(d) => { if (editingPaymentId != null) void savePaymentDate(editingPaymentId, d); }}
          loading={paymentDatesLoading || savingPaymentId != null}
        />
        <p className="text-[10.5px] m-0 pt-2 px-1" style={{ color: "var(--text-faint)" }}>
          วันจ่าย: ศุกร์ที่ 2 และ 4 ของเดือน (เลื่อนกลับ 1 วันถ้าตรงวันหยุด)
        </p>
      </Dialog>

      {/* Batch result dialog */}
      <Dialog
        open={batchResult != null && !batchRunning}
        onOpenChange={(open) => { if (!open) setBatchResult(null); }}
        title="ผลการอนุมัติ"
        uniformSurface
      >
        {batchResult && (
          <div className="flex flex-col gap-3">
            {batchResult.ok.length > 0 && (
              <p className="text-[13px]" style={{ color: "var(--text-info-green)" }}>
                สำเร็จ {batchResult.ok.length} รายการ
              </p>
            )}
            {batchResult.fail.length > 0 && (
              <div>
                <p className="text-[13px] font-semibold mb-2" style={{ color: "var(--color-danger)" }}>
                  ไม่สำเร็จ {batchResult.fail.length} รายการ
                </p>
                <ul className="space-y-1 max-h-40 overflow-y-auto">
                  {batchResult.fail.map((f) => (
                    <li key={f.id} className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
                      {f.requestNo ?? `#${f.id}`}: {f.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end pt-2">
              <Button variant="secondary" onClick={() => setBatchResult(null)}>ปิด</Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Confirm batch */}
      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => { if (!batchRunning) setConfirmOpen(open); }}
        title="ยืนยันอนุมัติหลายรายการ"
        uniformSurface
      >
        <div className="flex flex-col gap-3">
          <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
            อนุมัติ <strong>{selectedRows.length}</strong> รายการ ยอดรวม{" "}
            <strong>{fmtMoney(selectedTotal)}</strong> บาท
          </p>
          <p className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
            วันที่จ่าย: <strong>{paymentDate ? fmtPaymentLabel(paymentDate) : "—"}</strong>
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setConfirmOpen(false)}>ยกเลิก</Button>
            <Button variant="primary" onClick={handleConfirmBatch}>ยืนยันอนุมัติ</Button>
          </div>
        </div>
      </Dialog>

      {/* Payment date calendar */}
      <Dialog
        open={calendarOpen}
        onOpenChange={setCalendarOpen}
        title="เลือกวันที่จ่าย"
        uniformSurface
        contentClassName="max-w-[360px]"
      >
        <PaymentDatePicker
          dates={paymentDates}
          value={paymentDate}
          onChange={(d) => { setPaymentDate(d); setCalendarOpen(false); }}
          loading={paymentDatesLoading}
        />
      </Dialog>

      {/* Reject */}
      <Dialog
        open={rejectOpen}
        onOpenChange={(open) => { if (!rejecting) setRejectOpen(open); }}
        title="ระบุเหตุผลที่ไม่อนุมัติ"
        uniformSurface
      >
        <textarea
          value={rejectComment}
          onChange={(e) => setRejectComment(e.target.value)}
          rows={4}
          placeholder="กรุณาระบุเหตุผล..."
          className="w-full text-[13px] px-3 py-2 rounded-lg resize-none outline-none mb-4"
          style={{
            background: "var(--bg-input)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-input)",
          }}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={rejecting} onClick={() => setRejectOpen(false)}>ยกเลิก</Button>
          <Button
            variant="danger"
            disabled={!rejectComment.trim() || rejecting}
            loading={rejecting}
            onClick={handleRejectConfirm}
          >
            ยืนยัน ไม่อนุมัติ
          </Button>
        </div>
      </Dialog>

      {/* Detail drawer */}
      <SidePanel open={drawerId != null} onClose={() => setDrawerId(null)} width="min(720px, 100vw)" zIndex={50}>
        <div
          className="flex items-center justify-between px-4 py-3 shrink-0"
          style={{ borderBottom: "1px solid var(--border-light)" }}
        >
          <div className="min-w-0">
            <p className="text-[14px] font-bold truncate m-0" style={{ color: "var(--text-heading)" }}>
              {drawerDetail?.requestNo ?? "รายละเอียดคำขอ"}
            </p>
            <p className="text-[11px] m-0 mt-0.5" style={{ color: "var(--text-muted)" }}>
              ตรวจสอบรายละเอียดและเอกสารแนบ
            </p>
          </div>
          <SidePanelClose onClick={() => setDrawerId(null)} />
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-4 acc-theme">
          {loadingDrawer ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin" style={{ color: "var(--text-muted)" }} />
            </div>
          ) : drawerDetail ? (
            <RequestDetail request={drawerDetail} hideCancel />
          ) : null}
        </div>

        {drawerDetail && drawerId != null && (
          <div
            className="shrink-0 px-4 py-3.5 flex flex-wrap gap-3 justify-between items-center"
            style={{
              borderTop: "1px solid var(--border-light)",
              background: "var(--bg-card-alt)",
            }}
          >
            <label className="inline-flex items-center gap-2.5 text-[12px] font-medium cursor-pointer min-h-[36px]">
              <QueueCheckbox
                checked={selectedIds.has(drawerId)}
                onChange={() => toggleSelect(drawerId)}
                ariaLabel={`เลือกและตรวจ ${drawerDetail.requestNo ?? drawerId}`}
              />
              <span style={{ color: selectedIds.has(drawerId) ? "var(--text-info-green)" : "var(--text-secondary)" }}>
                {selectedIds.has(drawerId) ? "เลือกแล้ว — พร้อมอนุมัติ" : "เลือกเพื่ออนุมัติ"}
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => openReject(drawerId)}
                className="inline-flex items-center gap-2 text-[12px] font-semibold px-3.5 py-2 rounded-xl transition-opacity cursor-pointer hover:opacity-85"
                style={{
                  color: "var(--color-danger)",
                  border: "1px solid color-mix(in srgb, var(--color-danger) 28%, var(--border-card))",
                  background: "color-mix(in srgb, var(--color-danger) 7%, var(--bg-card))",
                }}
              >
                <ThumbsDown size={14} strokeWidth={2.25} />
                ไม่อนุมัติ
              </button>
            </div>
          </div>
        )}
      </SidePanel>
    </div>
  );
}
