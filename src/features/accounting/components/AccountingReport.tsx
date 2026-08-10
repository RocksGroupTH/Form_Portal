"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { toast } from "sonner";
import { Download, Loader2, AlertCircle, FileX, RefreshCw, ChevronDown, ChevronUp, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SidePanel, SidePanelClose } from "@/components/ui/SidePanel";
import {
  ApprovalQueueFilters,
  QueueToolbar,
  MultiSelectFilter,
  applyQueueFilters,
  EMPTY_QUEUE_FILTERS,
  fmtDateOnly,
  fmtMoney,
  hasQueueFilters,
  isMultiSelectActive,
  isMultiSelectNone,
  filterInputCls,
  filterInputStyle,
  type QueueFilters,
} from "@/features/accounting/components/ApprovalQueueFilters";
import { FilterDateRangePicker } from "@/features/accounting/components/FilterDateRangePicker";
import { RequestDetail } from "@/features/accounting/components/RequestDetail";
import { ErpInterfaceBrandTabs } from "@/features/accounting/components/ErpInterfaceBrandTabs";
import type { AccRequest } from "@/features/accounting/types";
import {
  REPORT_STATUS_FILTER_GROUPS,
  reportStatusFilterLabel,
  rowMatchesReportStatusFilter,
} from "@/features/accounting/constants";
import { RequestStatusBadge, reportStatusFilterStyle } from "@/features/accounting/components/RequestStatusBadge";
import type { ReportRow } from "@/lib/acc/report-service";
import {
  displayDayAmountCell,
  displayRowVehicleCell,
  displayTravelDateCell,
  expandTravelDisplayRows,
  withTravelGroupMeta,
} from "@/features/accounting/lib/expand-travel-table-rows";
import { reportVehicleNames } from "@/features/accounting/lib/travel-sections";
import {
  countRowsByInterfaceTarget,
  filterRowsByInterfaceTarget,
  ERP_INTERFACE_UNASSIGNED,
  parseInterfaceTargetForAccess,
} from "@/features/accounting/lib/erp-interface-target";
import { useApproverInterfaceAccess } from "@/features/accounting/hooks/useApproverInterfaceAccess";
import { filterInterfaceBrandCodes } from "@/lib/acc/approver-interface-access-shared";
import { ERP_INTERFACE_BRANDS } from "@/lib/acc/erp-interface-brands";
import { computeReportKpi } from "@/features/accounting/lib/report-kpi";

type DateBasis = "travel" | "submit" | "payment";

interface ReportKpiItem {
  label: string;
  value: string;
  color?: string;
  accent?: string;
}

function ReportKpiSection({
  title,
  items,
  highlighted = false,
}: {
  title: string;
  items: ReportKpiItem[];
  highlighted?: boolean;
}) {
  return (
    <div
      className="rounded-lg px-3 py-3 flex flex-col gap-2.5 min-w-0"
      style={{
        background: highlighted
          ? "color-mix(in srgb, var(--nav-active-bg) 22%, var(--bg-card-alt))"
          : "var(--bg-card-alt)",
        border: `1px solid ${
          highlighted
            ? "color-mix(in srgb, var(--nav-active-text) 18%, var(--border-light))"
            : "var(--border-light)"
        }`,
      }}
    >
      <p
        className="text-[11px] font-bold uppercase tracking-wide m-0"
        style={{ color: highlighted ? "var(--nav-active-text)" : "var(--text-faint)" }}
      >
        {title}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
        {items.map((item) => (
          <div
            key={item.label}
            className="rounded-md px-2.5 py-2 min-w-0"
            style={{
              background: "var(--bg-card)",
              border: "1px solid var(--border-light)",
              borderLeft: item.accent ? `3px solid ${item.accent}` : undefined,
            }}
          >
            <div
              className="text-[10px] font-medium leading-tight truncate"
              style={{ color: "var(--text-muted)" }}
            >
              {item.label}
            </div>
            <div
              className="text-[13px] sm:text-[14px] font-bold leading-snug mt-1 tabular-nums"
              style={{ color: item.color ?? "var(--text-heading)" }}
              title={item.value}
            >
              {item.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ReportFilters extends QueueFilters {
  statuses: string[];
  staffId: string;
  dateBasis: DateBasis;
  periodFrom: string;
  periodTo: string;
}

const REPORT_STATUS_OPTIONS = REPORT_STATUS_FILTER_GROUPS.map((g) => g.id);

const DATE_BASIS_OPTIONS: { id: DateBasis; label: string }[] = [
  { id: "submit", label: "วันส่งคำขอ" },
  { id: "travel", label: "วันเดินทาง" },
  { id: "payment", label: "วันจ่าย" },
];

function defaultReportPeriod(): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const mm = String(m + 1).padStart(2, "0");
  const lastDay = new Date(y, m + 1, 0).getDate();
  return {
    from: `${y}-${mm}-01`,
    to: `${y}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

function createDefaultReportFilters(): ReportFilters {
  const period = defaultReportPeriod();
  return {
    ...EMPTY_QUEUE_FILTERS,
    statuses: [],
    staffId: "",
    dateBasis: "submit",
    periodFrom: period.from,
    periodTo: period.to,
  };
}

interface AppliedServerPeriod {
  dateBasis: DateBasis;
  from: string;
  to: string;
}

function appliedPeriodFromFilters(f: ReportFilters): AppliedServerPeriod {
  return { dateBasis: f.dateBasis, from: f.periodFrom, to: f.periodTo };
}

/** Commit server reload only when range is complete, or fully cleared. */
function shouldCommitServerPeriod(next: ReportFilters): boolean {
  return (
    (!!next.periodFrom && !!next.periodTo) ||
    (!next.periodFrom && !next.periodTo)
  );
}

function isDefaultReportFilters(f: ReportFilters): boolean {
  const period = defaultReportPeriod();
  return (
    !hasQueueFilters(f) &&
    !isMultiSelectActive(f.statuses) &&
    !f.staffId.trim() &&
    f.dateBasis === "submit" &&
    f.periodFrom === period.from &&
    f.periodTo === period.to
  );
}

function hasReportFilters(f: ReportFilters): boolean {
  return !isDefaultReportFilters(f);
}

function applyReportFilters(rows: ReportRow[], f: ReportFilters): ReportRow[] {
  let list = applyQueueFilters(rows, f);
  if (isMultiSelectActive(f.statuses)) {
    if (isMultiSelectNone(f.statuses)) {
      list = [];
    } else {
      list = list.filter((r) => rowMatchesReportStatusFilter(r.status, f.statuses));
    }
  }
  if (f.staffId.trim()) {
    const sid = Number(f.staffId);
    if (!isNaN(sid)) list = list.filter((r) => r.staffId === sid);
  }
  return list;
}

function buildFilterSummary(f: ReportFilters): string {
  const parts: string[] = [];
  if (f.requestNo.trim()) parts.push(`เลขที่: ${f.requestNo.trim()}`);
  if (f.requesterFullName.trim()) parts.push(`ผู้ขอ: ${f.requesterFullName.trim()}`);
  if (isMultiSelectActive(f.departmentNames)) {
    parts.push(
      isMultiSelectNone(f.departmentNames)
        ? "แผนก: ไม่ได้เลือก"
        : `แผนก: ${f.departmentNames.join(", ")}`,
    );
  }
  if (isMultiSelectActive(f.brandCodes)) {
    parts.push(
      isMultiSelectNone(f.brandCodes)
        ? "แบรนด์: ไม่ได้เลือก"
        : `แบรนด์: ${f.brandCodes.join(", ")}`,
    );
  }
  if (isMultiSelectActive(f.vehicleNames)) {
    parts.push(
      isMultiSelectNone(f.vehicleNames)
        ? "ยานพาหนะ: ไม่ได้เลือก"
        : `ยานพาหนะ: ${f.vehicleNames.join(", ")}`,
    );
  }
  if (isMultiSelectActive(f.statuses)) {
    parts.push(
      isMultiSelectNone(f.statuses)
        ? "สถานะ: ไม่ได้เลือก"
        : `สถานะ: ${f.statuses.map((s) => reportStatusFilterLabel(s)).join(", ")}`,
    );
  }
  if (f.staffId.trim()) parts.push(`รหัสพนักงาน: ${f.staffId.trim()}`);
  if (f.periodFrom || f.periodTo) {
    const basis =
      DATE_BASIS_OPTIONS.find((o) => o.id === f.dateBasis)?.label ?? f.dateBasis;
    parts.push(`ช่วง${basis}: ${f.periodFrom || "—"} – ${f.periodTo || "—"}`);
  }
  return parts.join(" | ");
}

function buildKpiItems(kpi: ReturnType<typeof computeReportKpi>): ReportKpiItem[] {
  return [
    { label: "รายการ", value: String(kpi.rowCount) },
    {
      label: "ยอดรวม",
      value: fmtMoney(kpi.totalAmount),
      color: "var(--color-action)",
      accent: "var(--color-action)",
    },
    {
      label: "อนุมัติแล้ว",
      value: `${fmtMoney(kpi.approvedAmount)} (${kpi.approvedCount})`,
      color: "var(--text-info-green)",
      accent: "var(--border-info-green)",
    },
    {
      label: "รอดำเนินการ",
      value: `${fmtMoney(kpi.pendingAmount)} (${kpi.pendingCount})`,
      color: "var(--text-info-yellow)",
      accent: "var(--border-info-yellow)",
    },
    {
      label: "มีวันจ่าย",
      value: `${fmtMoney(kpi.paidAmount)} (${kpi.paidCount})`,
      color: "var(--nav-active-text)",
      accent: "var(--nav-active-text)",
    },
  ];
}

interface FilterChip {
  key: string;
  label: string;
  style?: React.CSSProperties;
}

function buildFilterChips(f: ReportFilters): FilterChip[] {
  const chips: FilterChip[] = [];
  if (f.requestNo.trim()) chips.push({ key: "requestNo", label: `เลขที่: ${f.requestNo.trim()}` });
  if (f.requesterFullName.trim()) chips.push({ key: "requester", label: `ผู้ขอ: ${f.requesterFullName.trim()}` });
  if (isMultiSelectActive(f.departmentNames)) {
    chips.push({
      key: "dept",
      label: isMultiSelectNone(f.departmentNames)
        ? "แผนก: ไม่ได้เลือก"
        : `แผนก: ${f.departmentNames.join(", ")}`,
    });
  }
  if (isMultiSelectActive(f.brandCodes)) {
    chips.push({
      key: "brand",
      label: isMultiSelectNone(f.brandCodes)
        ? "แบรนด์: ไม่ได้เลือก"
        : `แบรนด์: ${f.brandCodes.join(", ")}`,
    });
  }
  if (isMultiSelectActive(f.vehicleNames)) {
    chips.push({
      key: "vehicle",
      label: isMultiSelectNone(f.vehicleNames)
        ? "ยานพาหนะ: ไม่ได้เลือก"
        : `ยานพาหนะ: ${f.vehicleNames.join(", ")}`,
    });
  }
  if (isMultiSelectActive(f.statuses)) {
    if (isMultiSelectNone(f.statuses)) {
      chips.push({ key: "status-none", label: "สถานะ: ไม่ได้เลือก" });
    } else {
      for (const id of f.statuses) {
        chips.push({
          key: `status-${id}`,
          label: reportStatusFilterLabel(id),
          style: reportStatusFilterStyle(id),
        });
      }
    }
  }
  if (f.staffId.trim()) chips.push({ key: "staffId", label: `รหัสพนักงาน: ${f.staffId.trim()}` });
  if (f.periodFrom || f.periodTo) {
    const basis =
      DATE_BASIS_OPTIONS.find((o) => o.id === f.dateBasis)?.label ?? f.dateBasis;
    const isDefaultPeriod =
      f.dateBasis === "submit" &&
      f.periodFrom === defaultReportPeriod().from &&
      f.periodTo === defaultReportPeriod().to;
    if (!isDefaultPeriod) {
      chips.push({
        key: "period",
        label: `${basis}: ${f.periodFrom || "—"} – ${f.periodTo || "—"}`,
      });
    }
  }
  return chips;
}

function interfaceTargetLabel(code: string): string {
  const upper = code.trim().toUpperCase();
  if (upper === ERP_INTERFACE_UNASSIGNED) return "ยังไม่กำหนดปลายทาง";
  const brand = ERP_INTERFACE_BRANDS.find((b) => b.id === upper);
  return brand?.name ?? upper;
}

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

function formatLoadError(raw: string): string {
  if (raw === "Internal server error") {
    return "โหลดรายงานไม่สำเร็จ — อาจเป็นปัญหาการเชื่อมต่อฐานข้อมูล ลองตรวจสอบ VPN หรือกดโหลดใหม่";
  }
  return raw;
}

export function AccountingReport() {
  const { access, ready: accessReady } = useApproverInterfaceAccess();
  const visibleInterfaceCodes = useMemo(
    () => (access.allAccess ? null : filterInterfaceBrandCodes(access)),
    [access],
  );
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [view, setView] = useState<"request" | "day">("request");
  const [filters, setFilters] = useState<ReportFilters>(() => createDefaultReportFilters());
  const [appliedServerPeriod, setAppliedServerPeriod] = useState<AppliedServerPeriod>(() =>
    appliedPeriodFromFilters(createDefaultReportFilters()),
  );
  const [interfaceByClaim, setInterfaceByClaim] = useState<Record<string, string>>({});
  const [interfaceTarget, setInterfaceTarget] = useState(() => parseInterfaceTargetForAccess(null, {
    allAccess: true,
    allowedCodes: [],
  }));

  useEffect(() => {
    if (!accessReady) return;
    setInterfaceTarget((prev) => parseInterfaceTargetForAccess(prev, access));
  }, [access, accessReady]);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [drawerDetail, setDrawerDetail] = useState<AccRequest | null>(null);
  const [loadingDrawer, setLoadingDrawer] = useState(false);

  const patchFilters = useCallback((patch: Partial<ReportFilters>) => {
    setFilters((prev) => {
      const next = { ...prev, ...patch };
      if (shouldCommitServerPeriod(next)) {
        setAppliedServerPeriod(appliedPeriodFromFilters(next));
      } else if (
        patch.dateBasis != null &&
        prev.periodFrom &&
        prev.periodTo &&
        next.periodFrom === prev.periodFrom &&
        next.periodTo === prev.periodTo
      ) {
        setAppliedServerPeriod(appliedPeriodFromFilters(next));
      }
      return next;
    });
  }, []);

  const resetReportFilters = useCallback(() => {
    const next = createDefaultReportFilters();
    setFilters(next);
    setAppliedServerPeriod(appliedPeriodFromFilters(next));
  }, []);

  const fetchReport = useCallback(() => {
    setLoading(true);
    setForbidden(false);
    setLoadError(null);
    const qs = new URLSearchParams({ view });
    if (appliedServerPeriod.from || appliedServerPeriod.to) {
      qs.set("dateBasis", appliedServerPeriod.dateBasis);
      if (appliedServerPeriod.from) qs.set("from", appliedServerPeriod.from);
      if (appliedServerPeriod.to) qs.set("to", appliedServerPeriod.to);
    }
    Promise.all([
      fetch(`/api/request/accounting/report?${qs.toString()}`),
      fetch("/api/request/accounting/erp-prep/journal-context"),
    ])
      .then(async ([reportRes, ctxRes]) => {
        if (reportRes.status === 403) {
          setForbidden(true);
          setRows([]);
          return;
        }
        const json: { ok: boolean; data?: ReportRow[]; error?: string } = await reportRes.json();
        const ctxJson: { ok: boolean; data?: { interfaceByClaim?: Record<string, string> } } =
          await ctxRes.json();

        if (!reportRes.ok || !json.ok) {
          setRows([]);
          setLoadError(formatLoadError(json.error ?? "โหลดรายงานไม่สำเร็จ"));
          return;
        }

        setRows(json.data ?? []);

        if (ctxJson.ok && ctxJson.data?.interfaceByClaim) {
          setInterfaceByClaim(ctxJson.data.interfaceByClaim);
        }
      })
      .catch(() => {
        setRows([]);
        setLoadError("ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ — ลองโหลดใหม่อีกครั้ง");
      })
      .finally(() => setLoading(false));
  }, [view, appliedServerPeriod]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

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

    return () => {
      cancelled = true;
    };
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

  const hasActiveFilters = useMemo(() => hasReportFilters(filters), [filters]);

  const allFilteredRows = useMemo(
    () => applyReportFilters(rows, filters),
    [rows, filters],
  );

  const interfaceCounts = useMemo(
    () => countRowsByInterfaceTarget(allFilteredRows, interfaceByClaim),
    [allFilteredRows, interfaceByClaim],
  );

  const filteredRows = useMemo(
    () => filterRowsByInterfaceTarget(allFilteredRows, interfaceByClaim, interfaceTarget),
    [allFilteredRows, interfaceByClaim, interfaceTarget],
  );

  const groupedDisplayRows = useMemo(
    () => withTravelGroupMeta(expandTravelDisplayRows(filteredRows)),
    [filteredRows],
  );

  const overallKpi = useMemo(() => computeReportKpi(allFilteredRows), [allFilteredRows]);
  const tabKpi = useMemo(() => computeReportKpi(filteredRows), [filteredRows]);

  const overallKpiItems = useMemo(() => buildKpiItems(overallKpi), [overallKpi]);
  const tabKpiItems = useMemo(() => buildKpiItems(tabKpi), [tabKpi]);
  const showTabKpiSummary = tabKpi.rowCount !== overallKpi.rowCount
    || tabKpi.totalAmount !== overallKpi.totalAmount;

  const activeFilterChips = useMemo(() => buildFilterChips(filters), [filters]);

  const handleExport = useCallback(async () => {
    if (filteredRows.length === 0) {
      toast.error("ไม่มีข้อมูลสำหรับส่งออก");
      return;
    }
    setExporting(true);
    const ids = filteredRows.map((r) => r.id).join(",");
    const summary = buildFilterSummary(filters);
    const qs = new URLSearchParams({ ids, view });
    if (summary) qs.set("summary", summary);
    try {
      const res = await fetch(`/api/request/accounting/report/export?${qs.toString()}`);
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
      const cd = res.headers.get("content-disposition") ?? "";
      const match = cd.match(/filename[^;=\n]*=['"]?([^'"\n;]+)['"]?/);
      a.download = match?.[1] ?? "travel-expense-report.xlsx";
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
  }, [filteredRows, filters, view]);

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
          กรุณาติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 size={24} className="animate-spin" style={{ color: "var(--text-muted)" }} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div
        className="rounded-xl p-8 flex flex-col items-center gap-4 text-center"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
      >
        <AlertCircle size={36} style={{ color: "var(--color-warning)" }} />
        <div>
          <p className="text-[14px] font-medium m-0" style={{ color: "var(--text-heading)" }}>
            โหลดรายงานไม่สำเร็จ
          </p>
          <p className="text-[12px] m-0 mt-2 max-w-md" style={{ color: "var(--text-muted)" }}>
            {loadError}
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={<RefreshCw size={14} />}
          onClick={() => void fetchReport()}
        >
          โหลดใหม่
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ErpInterfaceBrandTabs
        activeCode={interfaceTarget}
        onChange={setInterfaceTarget}
        counts={interfaceCounts}
        visibleCodes={visibleInterfaceCodes}
        showUnassigned={access.allAccess}
      />

      <div
        className="rounded-xl p-3 sm:p-4"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
      >
        {showTabKpiSummary ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <ReportKpiSection title="สรุปทั้งหมด" items={overallKpiItems} />
            <ReportKpiSection
              title={`สรุปกลุ่ม ${interfaceTargetLabel(interfaceTarget)}`}
              items={tabKpiItems}
              highlighted
            />
          </div>
        ) : (
          <ReportKpiSection title="สรุปภาพรวม" items={overallKpiItems} />
        )}
      </div>

      <div
        className="rounded-xl"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
      >
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 cursor-pointer border-none text-left"
          style={{
            background: "var(--bg-card-alt)",
            borderBottom: filtersOpen ? "1px solid var(--border-light)" : undefined,
          }}
        >
          <span className="inline-flex items-center gap-2">
            <SlidersHorizontal size={15} style={{ color: "var(--text-muted)" }} />
            <span className="text-[13px] font-semibold" style={{ color: "var(--text-heading)" }}>
              ตัวกรอง
            </span>
            {hasActiveFilters && (
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{
                  background: "var(--nav-active-bg)",
                  color: "var(--nav-active-text)",
                }}
              >
                {activeFilterChips.length} เงื่อนไข
              </span>
            )}
          </span>
          {filtersOpen ? (
            <ChevronUp size={16} style={{ color: "var(--text-muted)" }} />
          ) : (
            <ChevronDown size={16} style={{ color: "var(--text-muted)" }} />
          )}
        </button>

        {filtersOpen && (
          <div className="px-4 py-3 flex flex-col gap-3">
            <QueueToolbar
              countLabel="รายการ"
              filteredCount={filteredRows.length}
              totalCount={allFilteredRows.length}
              hasActiveFilters={hasActiveFilters}
              onClearFilters={resetReportFilters}
              extra={
                <div className="flex items-center gap-2 flex-wrap justify-end ml-auto">
                  <div
                    className="flex rounded-lg overflow-hidden text-[11px] font-semibold"
                    style={{ border: "1px solid var(--border-card)" }}
                  >
                    {([
                      { id: "request" as const, label: "ต่อคำขอ" },
                      { id: "day" as const, label: "ต่อวัน" },
                    ]).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setView(opt.id)}
                        className="px-3 py-1.5 cursor-pointer border-none"
                        style={{
                          background: view === opt.id ? "var(--nav-active-bg)" : "var(--bg-card-alt)",
                          color: view === opt.id ? "var(--nav-active-text)" : "var(--text-secondary)",
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={exporting ? undefined : <Download size={14} />}
                    loading={exporting}
                    disabled={exporting || filteredRows.length === 0}
                    onClick={() => void handleExport()}
                  >
                    ส่งออก Excel
                  </Button>
                </div>
              }
            />

            <div
              className="rounded-lg p-3"
              style={{
                background: "var(--bg-card-alt)",
                border: "1px solid var(--border-light)",
              }}
            >
              <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-4 items-end">
                <div className="min-w-0">
                  <FilterLabel>ประเภทวันที่</FilterLabel>
                  <div
                    className="inline-flex rounded-lg overflow-hidden text-[11px] font-semibold"
                    style={{ border: "1px solid var(--border-card)" }}
                  >
                    {DATE_BASIS_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => patchFilters({ dateBasis: opt.id })}
                        className="px-3 py-2 cursor-pointer border-none whitespace-nowrap"
                        style={{
                          background:
                            filters.dateBasis === opt.id ? "var(--nav-active-bg)" : "var(--bg-card)",
                          color:
                            filters.dateBasis === opt.id
                              ? "var(--nav-active-text)"
                              : "var(--text-secondary)",
                        }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="min-w-0 lg:border-l lg:pl-4" style={{ borderColor: "var(--border-light)" }}>
                  <FilterDateRangePicker
                    label="ช่วงวันที่หลัก"
                    from={filters.periodFrom}
                    to={filters.periodTo}
                    onChange={(from, to) => patchFilters({ periodFrom: from, periodTo: to })}
                  />
                </div>
              </div>
            </div>

            <ApprovalQueueFilters
              filters={filters}
              onChange={(next) => setFilters((prev) => ({ ...prev, ...next }))}
              brandOptions={brandOptions}
              departmentOptions={departmentOptions}
              vehicleOptions={vehicleOptions}
              hideDateFilters
              trailing={
                <>
                  <MultiSelectFilter
                    label="สถานะ"
                    options={Array.from(REPORT_STATUS_OPTIONS)}
                    selected={filters.statuses}
                    onChange={(v) => setFilters((prev) => ({ ...prev, statuses: v }))}
                    formatLabel={(v) => reportStatusFilterLabel(v)}
                  />
                  <div className="min-w-0">
                    <FilterLabel>รหัสพนักงาน</FilterLabel>
                    <input
                      type="number"
                      value={filters.staffId}
                      onChange={(e) => setFilters((prev) => ({ ...prev, staffId: e.target.value }))}
                      placeholder="เช่น 1234"
                      className={filterInputCls}
                      style={filterInputStyle}
                    />
                  </div>
                </>
              }
            />

            {hasActiveFilters && activeFilterChips.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[10px] font-semibold shrink-0" style={{ color: "var(--text-faint)" }}>
                  กำลังกรอง:
                </span>
                {activeFilterChips.map((chip) => (
                  <span
                    key={chip.key}
                    className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={
                      chip.style ?? {
                        background: "var(--bg-badge)",
                        color: "var(--text-secondary)",
                        border: "1px solid var(--border-light)",
                      }
                    }
                  >
                    {chip.label}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div
        className="rounded-xl overflow-hidden"
        style={{ border: "1px solid var(--border-card)" }}
      >
        {filteredRows.length === 0 ? (
          <div
            className="flex flex-col items-center gap-3 py-12 text-center"
            style={{ background: "var(--bg-card)" }}
          >
            <FileX size={32} style={{ color: "var(--text-muted)" }} />
            <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
              {rows.length === 0
                ? "ยังไม่มีข้อมูลรายงาน"
                : allFilteredRows.length === 0
                  ? "ไม่พบข้อมูลตามเงื่อนไขที่ระบุ"
                  : `ไม่มีรายการในกลุ่ม ${interfaceTargetLabel(interfaceTarget)}`}
            </p>
            {hasActiveFilters && allFilteredRows.length === 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={resetReportFilters}
              >
                ล้างตัวกรอง
              </Button>
            )}
          </div>
        ) : (
          <div
            className="overflow-x-auto no-scrollbar max-h-[min(70vh,720px)] overflow-y-auto"
            style={{ background: "var(--bg-card)" }}
          >
            <table className="w-full text-[12px] border-collapse min-w-[900px]">
              <thead
                className="sticky top-0 z-10"
                style={{ background: "var(--bg-card-alt)", boxShadow: "0 1px 0 var(--border-light)" }}
              >
                <tr style={{ borderBottom: "1px solid var(--border-light)" }}>
                  {[
                    { label: "เลขที่", align: "left" },
                    { label: "รหัสพนักงาน", align: "left" },
                    { label: "ชื่อ-สกุล", align: "left" },
                    { label: "แผนก", align: "left" },
                    { label: "แบรนด์", align: "left" },
                    { label: "วันเดินทาง", align: "left" },
                    { label: "พาหนะ", align: "left" },
                    { label: "ระยะทางรวม", align: "right" },
                    { label: "ยอดรวม", align: "right" },
                    { label: "สถานะ", align: "left" },
                    { label: "วันที่จ่าย", align: "left" },
                  ].map((col) => (
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
                {groupedDisplayRows.map(({
                  key,
                  row,
                  dayLine,
                  vehicleLine,
                  requestGroupSize,
                  requestGroupIndex,
                  dayGroupSize,
                  dayGroupIndex,
                }, idx) => {
                  const dayAmount = displayDayAmountCell(row, dayLine, vehicleLine);
                  const isRequestGroupStart = requestGroupIndex === 0;
                  const isDayGroupStart = dayGroupIndex === 0;
                  const travelDayCount = row.dayCount ?? row.travelDayLines?.length ?? 0;
                  const sharedCellStyle: React.CSSProperties = { verticalAlign: "top" };
                  const rowBg =
                    idx % 2 === 0
                      ? "transparent"
                      : "color-mix(in srgb, var(--bg-card) 50%, var(--bg-main))";
                  return (
                  <tr
                    key={key}
                    className="transition-colors"
                    style={{
                      background: rowBg,
                      borderBottom: "1px solid var(--border-light)",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background =
                        "color-mix(in srgb, var(--nav-active-bg) 28%, var(--bg-card))";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = rowBg;
                    }}
                  >
                    {isRequestGroupStart ? (
                      <>
                    <td className="px-3 py-2 whitespace-nowrap" rowSpan={requestGroupSize} style={sharedCellStyle}>
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
                    <td className="px-3 py-2 whitespace-nowrap" rowSpan={requestGroupSize} style={{ ...sharedCellStyle, color: "var(--text-primary)" }}>
                      {row.staffId ?? "—"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" rowSpan={requestGroupSize} style={{ ...sharedCellStyle, color: "var(--text-primary)" }}>
                      {row.requesterFullName ?? "—"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" rowSpan={requestGroupSize} style={{ ...sharedCellStyle, color: "var(--text-secondary)" }}>
                      {row.requesterDepartmentName ?? "—"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" rowSpan={requestGroupSize} style={sharedCellStyle}>
                      {row.brandCode ? (
                        <span
                          className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                          style={{
                            background: "var(--bg-badge)",
                            color: "var(--text-muted)",
                            border: "1px solid var(--border-light)",
                          }}
                        >
                          {row.brandCode}
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>—</span>
                      )}
                    </td>
                      </>
                    ) : null}
                    {isDayGroupStart ? (
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums" rowSpan={dayGroupSize} style={{ ...sharedCellStyle, color: "var(--text-primary)" }}>
                      {displayTravelDateCell(row, dayLine)}
                    </td>
                    ) : null}
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>
                      {displayRowVehicleCell(row, dayLine, vehicleLine)}
                    </td>
                    {isRequestGroupStart ? (
                    <td
                      className="px-3 py-2 whitespace-nowrap text-right tabular-nums"
                      rowSpan={requestGroupSize}
                      style={{ ...sharedCellStyle, color: "var(--text-primary)" }}
                    >
                      {row.totalDistanceKm != null
                        ? row.totalDistanceKm.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        : "—"}
                    </td>
                    ) : null}
                    <td
                      className="px-3 py-2 whitespace-nowrap text-right tabular-nums font-medium"
                      style={{ color: "var(--color-action)" }}
                    >
                      {fmtMoney(dayAmount)}
                    </td>
                    {isRequestGroupStart ? (
                    <td className="px-3 py-2 whitespace-nowrap" rowSpan={requestGroupSize} style={sharedCellStyle}>
                      <RequestStatusBadge status={row.status} />
                    </td>
                    ) : null}
                    {isRequestGroupStart ? (
                    <td className="px-3 py-2 whitespace-nowrap" rowSpan={requestGroupSize} style={{ ...sharedCellStyle, color: "var(--text-secondary)" }}>
                      {fmtDateOnly(row.paymentDate)}
                    </td>
                    ) : null}
                  </tr>
                  );
                })}
              </tbody>
              <tfoot className="sticky bottom-0 z-10">
                <tr
                  style={{
                    borderTop: "2px solid var(--border-card)",
                    background: "color-mix(in srgb, var(--bg-card) 80%, var(--bg-main))",
                    boxShadow: "0 -1px 0 var(--border-card), 0 -8px 16px -10px rgba(0,0,0,0.25)",
                  }}
                >
                  <td
                    colSpan={8}
                    className="px-3 py-2.5 font-bold"
                    style={{ color: "var(--text-heading)" }}
                  >
                    รวมทั้งหมด ({filteredRows.length} รายการ)
                  </td>
                  <td
                    className="px-3 py-2.5 text-right tabular-nums font-bold"
                    style={{ color: "var(--color-action)" }}
                  >
                    {fmtMoney(tabKpi.totalAmount)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

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
      </SidePanel>
    </div>
  );
}
