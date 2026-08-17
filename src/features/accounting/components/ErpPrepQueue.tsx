"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";
import {
  Inbox,
  AlertCircle,
  Loader2,
  AlertTriangle,
  FileText,
  Table2,
} from "lucide-react";
import { SidePanel, SidePanelClose } from "@/components/ui/SidePanel";
import { RequestDetail } from "@/features/accounting/components/RequestDetail";
import {
  ApprovalQueueFilters,
  QueueToolbar,
  MultiSelectFilter,
  applyQueueFilters,
  CellTruncate,
  EMPTY_QUEUE_FILTERS,
  fmtDateOnly,
  fmtMoney,
  hasQueueFilters,
  isMultiSelectActive,
  isMultiSelectNone,
  sentMonthKey,
  type QueueFilters,
} from "@/features/accounting/components/ApprovalQueueFilters";
import { FilterMonthPicker } from "@/features/accounting/components/FilterMonthPicker";
import { FilterDateRangePicker } from "@/features/accounting/components/FilterDateRangePicker";
import {
  ERP_PREP_LABEL_TH,
  ERP_PREP_STATUSES,
  ERP_INTERFACE_LABEL_TH,
  type ErpPrepStatus,
} from "@/features/accounting/constants";
import type { ErpPrepRow } from "@/lib/acc/erp-prep-service";
import type { AccRequest } from "@/features/accounting/types";
import type { ErpJournalBuildContext } from "@/lib/acc/erp-journal-builder";
import { ErpJournalPreview } from "@/features/accounting/components/ErpJournalPreview";
import { ErpInterfaceBrandTabs } from "@/features/accounting/components/ErpInterfaceBrandTabs";
import { buildErpJournalSections, type ErpJournalBuildResult } from "@/lib/acc/erp-journal-builder";
import {
  countRowsByInterfaceTarget,
  filterRowsByInterfaceTarget,
  ERP_INTERFACE_UNASSIGNED,
} from "@/features/accounting/lib/erp-interface-target";
import { ErpPrepIssueLink } from "@/features/accounting/components/ErpPrepIssueLink";
import type { ErpPrepIssueLinkContext } from "@/features/accounting/lib/erp-prep-issue-links";
import {
  ErpInterfaceSendDialog,
  type ErpInterfaceSendTarget,
} from "@/features/accounting/components/ErpInterfaceSendDialog";
import {
  displayDayAmountCell,
  displayDayWorkDetailCell,
  displayRowVehicleCell,
  displayTravelDateCell,
  expandTravelDisplayRows,
  withTravelGroupMeta,
} from "@/features/accounting/lib/expand-travel-table-rows";

type ErpViewMode = "journal" | "documents";

function prepStatusStyle(status: ErpPrepStatus): React.CSSProperties {
  if (status === "ready") {
    return {
      background: "var(--bg-info-green)",
      color: "var(--text-info-green)",
      border: "1px solid var(--border-info-green)",
    };
  }
  return {
    background: "color-mix(in srgb, var(--color-warning) 14%, transparent)",
    color: "var(--color-warning)",
    border: "1px solid color-mix(in srgb, var(--color-warning) 35%, transparent)",
  };
}

function erpRowStatusDisplay(row: ErpPrepRow): { label: string; style: React.CSSProperties; title?: string } {
  const iface = row.erpInterfaceStatus;
  if (iface === "Sent") {
    return {
      label: ERP_INTERFACE_LABEL_TH.Sent,
      style: {
        background: "var(--bg-info-green)",
        color: "var(--text-info-green)",
        border: "1px solid var(--border-info-green)",
      },
    };
  }
  if (iface === "Failed") {
    return {
      label: ERP_INTERFACE_LABEL_TH.Failed,
      style: {
        background: "color-mix(in srgb, var(--color-danger) 12%, transparent)",
        color: "var(--color-danger)",
        border: "1px solid color-mix(in srgb, var(--color-danger) 30%, transparent)",
      },
      title: row.erpInterfaceError ?? undefined,
    };
  }
  if (iface === "Pending") {
    return {
      label: ERP_INTERFACE_LABEL_TH.Pending,
      style: {
        background: "var(--bg-card-alt)",
        color: "var(--text-muted)",
        border: "1px solid var(--border-light)",
      },
    };
  }
  if (row.prepStatus === "ready") {
    return {
      label: "พร้อมส่ง",
      style: {
        background: "color-mix(in srgb, var(--nav-active-text) 10%, var(--bg-card))",
        color: "var(--nav-active-text)",
        border: "1px solid color-mix(in srgb, var(--nav-active-text) 28%, transparent)",
      },
      title: row.prepIssues.length > 0 ? row.prepIssues.join(" · ") : undefined,
    };
  }
  return {
    label: ERP_PREP_LABEL_TH[row.prepStatus],
    style: prepStatusStyle(row.prepStatus),
    title: row.prepIssues.length > 0 ? row.prepIssues.join(" · ") : undefined,
  };
}

interface InterfaceFilters extends QueueFilters {
  prepStatuses: ErpPrepStatus[];
  paymentFrom: string;
  paymentTo: string;
  sentMonth: string;
}

const EMPTY_INTERFACE_FILTERS: InterfaceFilters = {
  ...EMPTY_QUEUE_FILTERS,
  prepStatuses: [],
  paymentFrom: "",
  paymentTo: "",
  sentMonth: "",
};

function hasInterfaceFilters(f: InterfaceFilters): boolean {
  return (
    hasQueueFilters(f) ||
    isMultiSelectActive(f.prepStatuses) ||
    !!f.paymentFrom ||
    !!f.paymentTo
  );
}

function toYmd(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function inPaymentRange(value: string | null | undefined, from: string, to: string): boolean {
  const ymd = toYmd(value);
  if (!ymd) return !from && !to;
  if (from && ymd < from) return false;
  if (to && ymd > to) return false;
  return true;
}

/** TOFyy-##### — descending by year then sequence. */
function compareRequestNoDesc(a: string | null, b: string | null): number {
  const parse = (no: string | null) => {
    if (!no) return { prefix: "", year: 0, seq: 0, raw: "" };
    const trimmed = no.trim();
    const m = /^([A-Za-z]*)(\d{2})-(\d+)$/.exec(trimmed);
    if (!m) return { prefix: trimmed, year: 0, seq: 0, raw: trimmed };
    return {
      prefix: m[1].toUpperCase(),
      year: Number(m[2]),
      seq: Number(m[3]),
      raw: trimmed,
    };
  };
  const pa = parse(a);
  const pb = parse(b);
  if (pa.year !== pb.year) return pb.year - pa.year;
  if (pa.seq !== pb.seq) return pb.seq - pa.seq;
  if (pa.prefix !== pb.prefix) return pb.prefix.localeCompare(pa.prefix);
  return pb.raw.localeCompare(pa.raw);
}


function ErpPrepIssuesAlert({
  issues,
  issueLinkContext,
}: {
  issues: string[];
  issueLinkContext?: ErpPrepIssueLinkContext;
}) {
  if (issues.length === 0) return null;

  return (
    <div
      className="rounded-lg px-3 py-2.5 flex gap-2 mb-4"
      style={{
        background: "color-mix(in srgb, var(--color-warning) 10%, transparent)",
        border: "1px solid color-mix(in srgb, var(--color-warning) 30%, transparent)",
      }}
    >
      <AlertTriangle size={16} className="shrink-0 mt-0.5" style={{ color: "var(--color-warning)" }} />
      <div>
        <p className="text-[12px] font-semibold m-0" style={{ color: "var(--color-warning)" }}>
          ข้อมูลยังไม่ครบสำหรับส่ง ERP — คลิกรายการเพื่อไปตั้งค่า
        </p>
        <ul className="mt-1 space-y-1 m-0 pl-4 list-disc">
          {issues.map((issue, i) => (
            <li key={`${issue}-${i}`}>
              <ErpPrepIssueLink issue={issue} context={issueLinkContext} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function ErpPrepQueue({
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
  const [rows, setRows] = useState<ErpPrepRow[]>([]);
  const [journalContext, setJournalContext] = useState<ErpJournalBuildContext | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [contextLoading, setContextLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [filters, setFilters] = useState<InterfaceFilters>(EMPTY_INTERFACE_FILTERS);
  const [viewMode, setViewMode] = useState<ErpViewMode>("journal");

  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [drawerDetail, setDrawerDetail] = useState<AccRequest | null>(null);
  const [loadingDrawer, setLoadingDrawer] = useState(false);
  const [sendTarget, setSendTarget] = useState<ErpInterfaceSendTarget | null>(null);

  const applyJournalContext = useCallback((data: ErpJournalBuildContext) => {
    setJournalContext({
      descriptionTemplate: data.descriptionTemplate,
      brandAccounts: data.brandAccounts,
      interfaceByClaim: data.interfaceByClaim ?? {},
      targetMeta: data.targetMeta ?? [],
      erpDeptCodesByTarget: data.erpDeptCodesByTarget ?? {},
      deptGlOverridesByTarget: data.deptGlOverridesByTarget ?? {},
      erpEnvironment: data.erpEnvironment ?? "Production",
    });
  }, []);

  const fetchJournalContext = useCallback(() => {
    setContextLoading(true);
    fetch("/api/request/accounting/erp-prep/journal-context")
      .then(async (ctxRes) => {
        if (ctxRes.status === 403) {
          setForbidden(true);
          return;
        }
        const ctxJson: {
          ok: boolean;
          data?: ErpJournalBuildContext;
          error?: string;
        } = await ctxRes.json();
        if (ctxJson.ok && ctxJson.data) applyJournalContext(ctxJson.data);
      })
      .catch(() => toast.error("เกิดข้อผิดพลาดในการโหลดบริบท journal"))
      .finally(() => setContextLoading(false));
  }, [applyJournalContext]);

  const fetchList = useCallback((options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) setListLoading(true);
    setForbidden(false);

    fetch("/api/request/accounting/erp-prep")
      .then(async (listRes) => {
        if (listRes.status === 403) {
          setForbidden(true);
          return;
        }
        const listJson: { ok: boolean; data?: ErpPrepRow[]; error?: string } = await listRes.json();
        if (listJson.ok && listJson.data) setRows(listJson.data);
        else toast.error(listJson.error ?? "โหลดข้อมูลไม่สำเร็จ");
      })
      .catch(() => toast.error("เกิดข้อผิดพลาดในการโหลดรายการ"))
      .finally(() => {
        if (!silent) setListLoading(false);
      });

    fetchJournalContext();
  }, [fetchJournalContext]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") fetchJournalContext();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [fetchJournalContext]);

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
      if (r.vehicleName) set.add(r.vehicleName);
    }
    return Array.from(set).sort();
  }, [rows]);

  const paymentDateOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.paymentDate) set.add(r.paymentDate);
    }
    return Array.from(set).sort();
  }, [rows]);

  const hasActiveFilters = useMemo(() => hasInterfaceFilters(filters), [filters]);

  const filteredRows = useMemo(() => {
    let list = applyQueueFilters(rows, filters);
    if (isMultiSelectActive(filters.prepStatuses)) {
      if (isMultiSelectNone(filters.prepStatuses)) {
        list = [];
      } else {
        list = list.filter((r) => filters.prepStatuses.includes(r.prepStatus));
      }
    }
    if (filters.paymentFrom || filters.paymentTo) {
      list = list.filter((r) => inPaymentRange(r.paymentDate, filters.paymentFrom, filters.paymentTo));
    }
    return list;
  }, [rows, filters]);

  const interfaceByClaim = journalContext?.interfaceByClaim ?? {};

  const ifaceCounts = useMemo(
    () => countRowsByInterfaceTarget(rows, interfaceByClaim),
    [rows, interfaceByClaim],
  );

  const ifaceFilteredRows = useMemo(() => {
    let list = filterRowsByInterfaceTarget(filteredRows, interfaceByClaim, interfaceTarget);
    return list;
  }, [filteredRows, interfaceByClaim, interfaceTarget]);

  const sentMonthOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of ifaceFilteredRows) {
      if (r.erpInterfaceStatus !== "Sent") continue;
      const key = sentMonthKey(r.erpInterfaceSentAt);
      if (key) set.add(key);
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [ifaceFilteredRows]);

  const interfaceTargetRef = useRef(interfaceTarget);

  useEffect(() => {
    if (interfaceTargetRef.current !== interfaceTarget) {
      interfaceTargetRef.current = interfaceTarget;
      setFilters((prev) => ({
        ...prev,
        sentMonth: sentMonthOptions.length > 0 ? sentMonthOptions[0] : "",
      }));
    }
  }, [interfaceTarget, sentMonthOptions]);

  useEffect(() => {
    if (sentMonthOptions.length === 0) {
      setFilters((prev) => (prev.sentMonth === "" ? prev : { ...prev, sentMonth: "" }));
      return;
    }
    setFilters((prev) => {
      if (prev.sentMonth) return prev;
      return { ...prev, sentMonth: sentMonthOptions[0] };
    });
  }, [sentMonthOptions]);

  const displayIfaceRows = useMemo(() => {
    if (!filters.sentMonth) return ifaceFilteredRows;
    return ifaceFilteredRows.filter((r) => {
      if (r.erpInterfaceStatus !== "Sent") return true;
      return sentMonthKey(r.erpInterfaceSentAt) === filters.sentMonth;
    });
  }, [ifaceFilteredRows, filters.sentMonth]);

  const sortedTableRows = useMemo(() => {
    return Array.from(displayIfaceRows).sort((a, b) => {
      const cmp = compareRequestNoDesc(a.requestNo, b.requestNo);
      if (cmp !== 0) return cmp;
      return b.id - a.id;
    });
  }, [displayIfaceRows]);

  const groupedDisplayRows = useMemo(
    () => withTravelGroupMeta(expandTravelDisplayRows(sortedTableRows)),
    [sortedTableRows],
  );

  const tableTotal = useMemo(
    () =>
      groupedDisplayRows.reduce(
        (s, r) => s + (displayDayAmountCell(r.row, r.dayLine, r.vehicleLine) ?? 0),
        0,
      ),
    [groupedDisplayRows],
  );

  const summary = useMemo(() => {
    let ready = 0;
    let incomplete = 0;
    for (const r of ifaceFilteredRows) {
      if (r.prepStatus === "ready") ready++;
      else incomplete++;
    }
    return { ready, incomplete };
  }, [ifaceFilteredRows]);

  const journalBuilt = useMemo((): ErpJournalBuildResult | null => {
    if (!journalContext) return null;
    return buildErpJournalSections(displayIfaceRows, journalContext);
  }, [displayIfaceRows, journalContext]);

  const journalSummary = journalBuilt?.summary ?? null;

  const incompleteIssues = useMemo(() => {
    const set = new Set<string>();
    for (const r of ifaceFilteredRows) {
      if (r.prepStatus !== "incomplete") continue;
      for (const issue of r.prepIssues) set.add(issue);
    }
    if (journalBuilt) {
      const target = interfaceTarget.trim().toUpperCase();
      const personGroups = target === ERP_INTERFACE_UNASSIGNED
        ? journalBuilt.unassigned.personGroups
        : journalBuilt.sections.find((s) => s.targetBrandCode === target)?.personGroups ?? [];
      for (const group of personGroups) {
        for (const batch of group.paymentBatches) {
          if (batch.lines.length === 0) {
            for (const issue of batch.prepIssues) set.add(issue);
          }
        }
      }
    }
    return Array.from(set);
  }, [ifaceFilteredRows, journalBuilt, interfaceTarget]);

  const issueLinkContext = useMemo<ErpPrepIssueLinkContext>(
    () => ({
      interfaceTarget,
      interfaceByClaim: journalContext?.interfaceByClaim,
    }),
    [interfaceTarget, journalContext?.interfaceByClaim],
  );

  if (forbidden) {
    return (
      <div className="rounded-xl p-8 flex flex-col items-center gap-3 text-center">
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

  return (
    <div>
      {listLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin" style={{ color: "var(--text-muted)" }} />
        </div>
      ) : (
      <>
      <ErpInterfaceBrandTabs
        activeCode={interfaceTarget}
        onChange={onInterfaceTargetChange}
        counts={ifaceCounts}
        visibleCodes={visibleInterfaceCodes}
        showUnassigned={showUnassignedTab}
        className="mb-4"
      />

      {rows.length === 0 ? (
        <div className="rounded-xl p-10 flex flex-col items-center gap-3 text-center">
          <Inbox size={32} style={{ color: "var(--text-muted)" }} />
          <p className="text-[14px] font-medium" style={{ color: "var(--text-heading)" }}>
            ไม่มีรายการที่อนุมัติแล้ว
          </p>
          <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
            คำขอที่บัญชีอนุมัติแล้วจะแสดงที่นี่เพื่อเตรียมส่ง ERP
          </p>
        </div>
      ) : ifaceFilteredRows.length === 0 ? (
        <div className="rounded-xl p-10 flex flex-col items-center gap-3 text-center" style={{ border: "1px solid var(--border-light)" }}>
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
          countLabel="อนุมัติแล้ว"
          filteredCount={displayIfaceRows.length}
          totalCount={rows.length}
          hasActiveFilters={hasActiveFilters}
          onClearFilters={() => setFilters(EMPTY_INTERFACE_FILTERS)}
          extra={
            <>
              {viewMode === "journal" && journalSummary ? (
                <>
                  <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
                    {journalSummary.personGroupCount} กลุ่ม (คน+แผนก)
                  </span>
                  <span className="text-[11px] font-medium px-2.5 py-1 rounded-full" style={prepStatusStyle("ready")}>
                    พร้อมส่ง {journalSummary.ready}
                  </span>
                  <span className="text-[11px] font-medium px-2.5 py-1 rounded-full" style={prepStatusStyle("incomplete")}>
                    ข้อมูลไม่ครบ {journalSummary.incomplete}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-[11px] font-medium px-2.5 py-1 rounded-full" style={prepStatusStyle("ready")}>
                    พร้อมส่ง {summary.ready}
                  </span>
                  <span className="text-[11px] font-medium px-2.5 py-1 rounded-full" style={prepStatusStyle("incomplete")}>
                    ข้อมูลไม่ครบ {summary.incomplete}
                  </span>
                </>
              )}
            </>
          }
        />

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setViewMode("journal");
              fetchJournalContext();
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors"
            style={{
              background: viewMode === "journal" ? "var(--nav-active-bg)" : "var(--bg-card)",
              color: viewMode === "journal" ? "var(--nav-active-text)" : "var(--text-muted)",
              border: `1px solid ${viewMode === "journal" ? "var(--border-card)" : "var(--border-light)"}`,
            }}
          >
            <Table2 size={14} />
            Journal Preview
          </button>
          <button
            type="button"
            onClick={() => setViewMode("documents")}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-colors"
            style={{
              background: viewMode === "documents" ? "var(--nav-active-bg)" : "var(--bg-card)",
              color: viewMode === "documents" ? "var(--nav-active-text)" : "var(--text-muted)",
              border: `1px solid ${viewMode === "documents" ? "var(--border-card)" : "var(--border-light)"}`,
            }}
          >
            <FileText size={14} />
            รายละเอียดตามเอกสาร
          </button>
        </div>

        <ApprovalQueueFilters
          filters={filters}
          onChange={(next) => setFilters((prev) => ({ ...prev, ...next }))}
          brandOptions={brandOptions}
          departmentOptions={departmentOptions}
          vehicleOptions={vehicleOptions}
          trailing={
            <>
              <MultiSelectFilter
                label="สถานะ ERP"
                options={Array.from(ERP_PREP_STATUSES)}
                selected={filters.prepStatuses}
                onChange={(v) =>
                  setFilters((prev) => ({
                    ...prev,
                    prepStatuses: v as ErpPrepStatus[],
                  }))
                }
                formatLabel={(v) => ERP_PREP_LABEL_TH[v as ErpPrepStatus]}
              />
              <FilterDateRangePicker
                label="วันจ่าย"
                from={filters.paymentFrom}
                to={filters.paymentTo}
                allowedDates={paymentDateOptions}
                onChange={(from, to) =>
                  setFilters((prev) => ({ ...prev, paymentFrom: from, paymentTo: to }))
                }
              />
              {sentMonthOptions.length > 0 ? (
                <FilterMonthPicker
                  label="ส่งเมื่อ"
                  value={filters.sentMonth}
                  availableMonths={sentMonthOptions}
                  latestMonth={sentMonthOptions[0]}
                  onChange={(sentMonth) =>
                    setFilters((prev) => ({ ...prev, sentMonth }))
                  }
                />
              ) : null}
            </>
          }
        />
      </div>

      <ErpPrepIssuesAlert issues={incompleteIssues} issueLinkContext={issueLinkContext} />

      {viewMode === "journal" ? (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-light)" }}>
          <ErpJournalPreview
            rows={displayIfaceRows}
            context={journalContext}
            built={journalBuilt}
            onOpenDocument={setDrawerId}
            interfaceTargetCode={interfaceTarget}
            onRequestSend={setSendTarget}
            sentMonthFilter={filters.sentMonth || undefined}
          />
        </div>
      ) : (
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-light)" }}>
        <div className="overflow-x-auto no-scrollbar">
          <table className="w-full text-[12px] min-w-[1080px]">
            <thead>
              <tr style={{ background: "var(--bg-card-alt)", borderBottom: "1px solid var(--border-light)" }}>
                <th className="text-left px-3 py-2.5 font-semibold whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>เลขที่</th>
                <th className="text-left px-3 py-2.5 font-semibold whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>วันที่ส่ง</th>
                <th className="text-left px-3 py-2.5 font-semibold" style={{ color: "var(--text-secondary)" }}>ผู้ขอ</th>
                <th className="text-left px-3 py-2.5 font-semibold whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>แบรนด์</th>
                <th className="text-left px-3 py-2.5 font-semibold whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>เดินทาง</th>
                <th className="text-left px-3 py-2.5 font-semibold hidden md:table-cell" style={{ color: "var(--text-secondary)" }}>ยานพาหนะ</th>
                <th className="text-left px-3 py-2.5 font-semibold hidden xl:table-cell" style={{ color: "var(--text-secondary)" }}>รายละเอียดงาน</th>
                <th className="text-left px-3 py-2.5 font-semibold whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>วันจ่าย</th>
                <th className="text-left px-3 py-2.5 font-semibold whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>สถานะ ERP</th>
                <th className="text-right px-3 py-2.5 font-semibold whitespace-nowrap" style={{ color: "var(--text-secondary)" }}>ยอด</th>
              </tr>
            </thead>
            <tbody>
              {groupedDisplayRows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-[13px]" style={{ color: "var(--text-muted)" }}>
                    ไม่พบรายการที่ตรงกับตัวกรอง
                  </td>
                </tr>
              ) : (
                groupedDisplayRows.map(({
                  key,
                  row,
                  dayLine,
                  vehicleLine,
                  requestGroupSize,
                  requestGroupIndex,
                  dayGroupSize,
                  dayGroupIndex,
                }) => {
                  const dayAmount = displayDayAmountCell(row, dayLine, vehicleLine);
                  const isRequestGroupStart = requestGroupIndex === 0;
                  const isDayGroupStart = dayGroupIndex === 0;
                  const travelDayCount = row.dayCount ?? row.travelDayLines?.length ?? 0;
                  const sharedCellStyle: React.CSSProperties = { verticalAlign: "top" };
                  return (
                  <tr
                    key={key}
                    className="transition-colors"
                    style={{ borderBottom: "1px solid var(--border-light)" }}
                  >
                    {isRequestGroupStart ? (
                      <>
                    <td className="px-3 py-2.5 whitespace-nowrap" rowSpan={requestGroupSize} style={sharedCellStyle}>
                      <button
                        type="button"
                        onClick={() => setDrawerId(row.id)}
                        className="font-semibold cursor-pointer border-none bg-transparent p-0 text-left underline-offset-2 hover:underline"
                        style={{ color: "var(--nav-active-text)" }}
                        title="ดูข้อมูล ERP"
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
                    <td className="px-3 py-2.5" rowSpan={requestGroupSize} style={sharedCellStyle}>
                      <CellTruncate text={row.requesterFullName} maxWidth={130} style={{ color: "var(--text-primary)" }} />
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
                    <td className="px-3 py-2.5 whitespace-nowrap tabular-nums" rowSpan={dayGroupSize} style={{ ...sharedCellStyle, color: "var(--text-muted)" }}>
                      {displayTravelDateCell(row, dayLine)}
                    </td>
                    ) : null}
                    <td className="px-3 py-2.5 hidden md:table-cell">
                      <span className="text-[12px] leading-tight" style={{ color: "var(--text-secondary)" }}>
                        {displayRowVehicleCell(row, dayLine, vehicleLine)}
                      </span>
                    </td>
                    {isDayGroupStart ? (
                    <td className="px-3 py-2.5 hidden xl:table-cell" rowSpan={dayGroupSize} style={sharedCellStyle}>
                      <CellTruncate text={displayDayWorkDetailCell(row, dayLine)} maxWidth={200} />
                    </td>
                    ) : null}
                    {isRequestGroupStart ? (
                    <td className="px-3 py-2.5 whitespace-nowrap" rowSpan={requestGroupSize} style={{ ...sharedCellStyle, color: "var(--text-muted)" }}>
                      {fmtDateOnly(row.paymentDate)}
                    </td>
                    ) : null}
                    {isRequestGroupStart ? (
                    <td className="px-3 py-2.5 whitespace-nowrap" rowSpan={requestGroupSize} style={sharedCellStyle}>
                      {(() => {
                        const st = erpRowStatusDisplay(row);
                        return (
                          <span
                            className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                            style={st.style}
                            title={st.title}
                          >
                            {st.label}
                          </span>
                        );
                      })()}
                    </td>
                    ) : null}
                    <td className="px-3 py-2.5 text-right tabular-nums font-bold whitespace-nowrap" style={{ color: "var(--color-action)" }}>
                      {fmtMoney(dayAmount)}
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
            {groupedDisplayRows.length > 0 ? (
              <tfoot>
                <tr
                  style={{
                    borderTop: "2px solid var(--border-card)",
                    background: "color-mix(in srgb, var(--bg-card) 80%, var(--bg-main))",
                  }}
                >
                  <td
                    colSpan={9}
                    className="px-3 py-2.5 font-bold"
                    style={{ color: "var(--text-heading)" }}
                  >
                    รวมทั้งหมด ({sortedTableRows.length} รายการ)
                  </td>
                  <td
                    className="px-3 py-2.5 text-right tabular-nums font-bold whitespace-nowrap"
                    style={{ color: "var(--color-action)" }}
                  >
                    {fmtMoney(tableTotal)}
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>
      )}

        </>
      )}

      </>
      )}

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

      <ErpInterfaceSendDialog
        open={sendTarget != null}
        onOpenChange={(open) => {
          if (!open) setSendTarget(null);
        }}
        target={sendTarget}
        onSuccess={() => {
          setSendTarget(null);
          fetchList({ silent: true });
        }}
      />
    </div>
  );
}
