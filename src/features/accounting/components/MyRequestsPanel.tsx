"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Inbox, Loader2, ChevronRight, Send, ClipboardCheck } from "lucide-react";
import type { ReportRow } from "@/lib/acc/report-service";
import type { AccRequest } from "@/features/accounting/types";
import { formatNextApprovalDetail, getMyWorkStatusBucket, myWorkStatusLabel, myWorkStatusStyle, type MyWorkStatusBucket, type MyWorkViewerContext } from "@/lib/acc/approval-display";
import { REQUEST_CARDS } from "@/lib/constants";
import { isPendingApprovalStatus, statusLabelDisplay } from "@/features/accounting/constants";
import { MultiSelectFilter, inDateRange, isMultiSelectActive, matchesMultiSelectValue } from "@/features/accounting/components/ApprovalQueueFilters";
import { FilterDateRangePicker } from "@/features/accounting/components/FilterDateRangePicker";
import { SidePanel, SidePanelClose } from "@/components/ui/SidePanel";
import { RequestDetail } from "@/features/accounting/components/RequestDetail";
import { TravelBookingDetail } from "@/features/travel-booking/components/TravelBookingDetail";
import type { TravelBookingRequest } from "@/features/travel-booking/types";
import { useFormEnvironments } from "@/lib/hooks/useFormEnvironments";
import { AP11_FORM_CODE } from "@/features/reward/constants";
import { safePush } from "@/lib/safe-router";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

/* ── Helpers ── */

async function readApiJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) {
    throw new Error(res.ok ? "Empty response" : `HTTP ${res.status}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`HTTP ${res.status}: invalid response`);
  }
}

function formatPanelLoadError(raw: string): string {
  if (/connect|ESOCKET|ETIMEOUT|ECONNREFUSED/i.test(raw)) {
    return "โหลดรายการไม่สำเร็จ — อาจเป็นปัญหาการเชื่อมต่อฐานข้อมูล ลองตรวจสอบ VPN แล้วรีเฟรช";
  }
  if (raw === "Internal server error" || raw.startsWith("HTTP ")) {
    return "โหลดรายการไม่สำเร็จ — กรุณาลองใหม่อีกครั้ง";
  }
  return raw;
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(raw: string | null | undefined): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** Status → chip colors (tokens). */
function statusStyle(status: string): React.CSSProperties {
  switch (status) {
    case "Approved":
      return { background: "var(--bg-info-green)", color: "var(--text-info-green)", border: "1px solid var(--border-info-green)" };
    case "Submitted":
    case "ManagerApproved":
      return { background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" };
    case "Returned":
      return { background: "color-mix(in srgb, var(--color-warning) 14%, transparent)", color: "var(--color-warning)", border: "1px solid color-mix(in srgb, var(--color-warning) 35%, transparent)" };
    case "Rejected":
    case "Cancelled":
      return { background: "color-mix(in srgb, var(--color-danger) 10%, transparent)", color: "var(--color-danger)", border: "1px solid color-mix(in srgb, var(--color-danger) 30%, transparent)" };
    default:
      return { background: "var(--bg-badge)", color: "var(--text-muted)", border: "1px solid var(--border-light)" };
  }
}

function SummaryStat({
  label, value, bg, fg, border,
}: { label: string; value: number; bg: string; fg: string; border: string }) {
  return (
    <div className="rounded-xl px-3 py-2" style={{ background: bg, border: `1px solid ${border}` }}>
      <div className="text-[20px] font-bold leading-none tabular-nums" style={{ color: fg }}>
        {value}
      </div>
      <div className="text-[10px] font-medium mt-1" style={{ color: fg, opacity: 0.85 }}>
        {label}
      </div>
    </div>
  );
}

function StatusBadge({ status, workBucket }: { status: string; workBucket?: MyWorkStatusBucket }) {
  if (workBucket) {
    return (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={myWorkStatusStyle(workBucket)}>
        {myWorkStatusLabel(workBucket)}
      </span>
    );
  }
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style={statusStyle(status)}>
      {statusLabelDisplay(status)}
    </span>
  );
}

const MINE_STATUS_FILTER_GROUPS = [
  { id: "pending", label: "รออนุมัติ", match: isPendingApprovalStatus },
  { id: "Approved", label: "อนุมัติแล้ว", match: (s: string) => s === "Approved" },
  { id: "Returned", label: "ส่งกลับแก้ไข", match: (s: string) => s === "Returned" },
  { id: "Rejected", label: "ไม่อนุมัติ", match: (s: string) => s === "Rejected" },
  { id: "Cancelled", label: "ยกเลิก", match: (s: string) => s === "Cancelled" },
] as const;

const WORK_STATUS_FILTER_GROUPS = [
  { id: "pending", label: "รออนุมัติ", bucket: "pending" as const },
  { id: "Approved", label: "อนุมัติแล้ว", bucket: "Approved" as const },
  { id: "Returned", label: "ส่งกลับแก้ไข", bucket: "Returned" as const },
  { id: "Rejected", label: "ไม่อนุมัติ", bucket: "Rejected" as const },
  { id: "Cancelled", label: "ยกเลิก", bucket: "Cancelled" as const },
] as const;

const DEFAULT_MINE_STATUS_FILTER = "pending";
const DEFAULT_WORK_STATUS_FILTER = "pending";

/* ── List for one source (mine / work) ── */

function RequestRowList({
  url,
  showRequester,
  kind,
}: {
  url: string;
  showRequester: boolean;
  kind: "mine" | "work";
}) {
  const router = useRouter();
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [drawerDetail, setDrawerDetail] = useState<AccRequest | null>(null);
  const [tbDetail, setTbDetail] = useState<TravelBookingRequest | null>(null);
  const [drawerFormCode, setDrawerFormCode] = useState<string | null>(null);
  const [loadingDrawer, setLoadingDrawer] = useState(false);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>(
    () => (kind === "work" ? DEFAULT_WORK_STATUS_FILTER : DEFAULT_MINE_STATUS_FILTER),
  );
  const [formFilter, setFormFilter] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [workViewer, setWorkViewer] = useState<MyWorkViewerContext>({
    staffId: null,
    email: null,
    isAccountApprover: false,
  });
  const { data: formEnvData } = useFormEnvironments();
  const forms = formEnvData?.forms;
  // Unknown (still loading, or the payload failed to load) always counts as
  // available — a fetch failure must never hide a form filter option that
  // would otherwise show.
  const isFormAvailable = useCallback(
    (code: string) => forms?.[code]?.available ?? true,
    [forms],
  );

  const loadRows = useCallback(() => {
    setLoading(true);
    return fetch(url)
      .then((r) => readApiJson<{ ok: boolean; data?: ReportRow[]; error?: string }>(r))
      .then((json) => {
        if (!json.ok) {
          const msg = formatPanelLoadError(json.error ?? "โหลดรายการไม่สำเร็จ");
          console.error("[MyRequestsPanel] load failed:", json.error);
          toast.error(msg);
          setRows([]);
          return;
        }
        setRows(json.data ?? []);
      })
      .catch((err) => {
        const msg = formatPanelLoadError(err instanceof Error ? err.message : "โหลดรายการไม่สำเร็จ");
        console.error("[MyRequestsPanel] load error:", err);
        toast.error(msg);
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, [url]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  /* Detail drawer — open in a SidePanel (same view as the report/approval queue). */
  const loadDrawer = useCallback((id: number, ap17: boolean) => {
    let cancelled = false;
    setLoadingDrawer(true);
    // AP-17 (travel booking) detail lives in a different table + API than AP-1 travel expense.
    const url = ap17
      ? `/api/request/travel-booking/requests/${id}`
      : `/api/request/accounting/requests/${id}`;
    fetch(url)
      .then((r) => readApiJson<{ ok: boolean; data?: AccRequest | TravelBookingRequest; error?: string }>(r))
      .then((json) => {
        if (cancelled) return;
        if (json.ok && json.data) {
          if (ap17) setTbDetail(json.data as TravelBookingRequest);
          else setDrawerDetail(json.data as AccRequest);
        } else {
          toast.error(json.error ?? "โหลดรายละเอียดไม่สำเร็จ");
        }
      })
      .catch(() => {
        if (!cancelled) toast.error("เกิดข้อผิดพลาดในการโหลดรายละเอียด");
      })
      .finally(() => {
        if (!cancelled) setLoadingDrawer(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (drawerId == null) {
      setDrawerDetail(null);
      setTbDetail(null);
      return;
    }
    setDrawerDetail(null);
    setTbDetail(null);
    return loadDrawer(drawerId, drawerFormCode === "AP-17");
  }, [drawerId, drawerFormCode, loadDrawer]);

  /**
   * Open one row.
   *
   * The drawer handles AP-1 and AP-17, whose detail shapes this component
   * already carries. AP-11 has its own detail page with its own actions
   * (approve, Ready, Received), so it navigates there rather than becoming a
   * third variant threaded through the drawer's state and body — the panel is
   * built around a binary split, and a third branch would touch every part of
   * it for no gain over the page that already exists.
   */
  const openRow = useCallback(
    (id: number, formCode: string | null) => {
      if (formCode === AP11_FORM_CODE) {
        safePush(router, `/request/reward/${id}`);
        return;
      }
      setDrawerId(id);
      setDrawerFormCode(formCode);
    },
    [router],
  );

  const handleDrawerChanged = useCallback(() => {
    void loadRows();
    if (drawerId != null) loadDrawer(drawerId, drawerFormCode === "AP-17");
  }, [loadRows, drawerId, drawerFormCode, loadDrawer]);

  useEffect(() => {
    if (kind !== "work") return;
    let cancelled = false;
    Promise.all([
      fetch("/api/me/employee").then((r) => readApiJson<{ ok: boolean; data?: { email?: string | null; employee?: { staffId?: number | null } | null } }>(r)),
      fetch("/api/request/accounting/access").then((r) => readApiJson<{ ok: boolean; data?: { approver?: boolean } }>(r)),
    ])
      .then(([empJson, accessJson]) => {
        if (cancelled) return;
        const staffId = empJson?.ok ? empJson.data?.employee?.staffId ?? null : null;
        const email = empJson?.ok ? empJson.data?.email ?? null : null;
        const isAccountApprover = Boolean(accessJson?.ok && accessJson.data?.approver);
        setWorkViewer({ staffId, email, isAccountApprover });
      })
      .catch(() => {
        if (!cancelled) {
          setWorkViewer({ staffId: null, email: null, isAccountApprover: false });
        }
      });
    return () => { cancelled = true; };
  }, [kind]);

  useEffect(() => {
    if (kind !== "work") return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadRows();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [kind, loadRows]);

  const rowWorkBucket = useCallback(
    (row: ReportRow): MyWorkStatusBucket =>
      getMyWorkStatusBucket(row, workViewer),
    [workViewer],
  );

  const statusGroups = useMemo(() => {
    if (kind === "work") {
      return WORK_STATUS_FILTER_GROUPS.filter((g) =>
        rows.some((r) => rowWorkBucket(r) === g.bucket),
      );
    }
    return MINE_STATUS_FILTER_GROUPS.filter((g) => rows.some((r) => g.match(r.status)));
  }, [rows, kind, rowWorkBucket]);

  const formOptions = useMemo(() => {
    // Seeded from available forms only — a form the viewer cannot use right
    // now (e.g. a UAT-only form while not in UAT mode) shouldn't offer itself
    // as a filter, though a row already on screen for it still counts below.
    const fromCards = REQUEST_CARDS.filter((c) => !c.soon && c.badge && isFormAvailable(c.badge))
      .map((c) => c.badge as string);
    const fromRows = rows.map((r) => r.formCode).filter(Boolean);
    return Array.from(new Set([...fromCards, ...fromRows])).sort();
  }, [rows, isFormAvailable]);

  const formLabelByCode = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of REQUEST_CARDS) {
      if (c.badge && isFormAvailable(c.badge)) map[c.badge] = c.badge;
    }
    for (const r of rows) {
      if (!r.formCode) continue;
      map[r.formCode] = r.formName ? `${r.formCode} · ${r.formName}` : r.formCode;
    }
    return map;
  }, [rows, isFormAvailable]);

  const hasExtraFilters = isMultiSelectActive(formFilter) || !!dateFrom || !!dateTo;

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all") {
        if (kind === "work") {
          const group = WORK_STATUS_FILTER_GROUPS.find((g) => g.id === statusFilter);
          if (group && rowWorkBucket(r) !== group.bucket) return false;
        } else {
          const group = MINE_STATUS_FILTER_GROUPS.find((g) => g.id === statusFilter);
          if (group && !group.match(r.status)) return false;
        }
      }
      if (!matchesMultiSelectValue(r.formCode, formFilter)) return false;
      if (!inDateRange(r.submittedAt, dateFrom, dateTo)) return false;
      if (!term) return true;
      return (
        (r.requestNo ?? "").toLowerCase().includes(term) ||
        (r.requesterFullName ?? "").toLowerCase().includes(term) ||
        (r.brandCode ?? "").toLowerCase().includes(term)
      );
    });
  }, [rows, q, statusFilter, formFilter, dateFrom, dateTo, kind, rowWorkBucket]);

  const summary = useMemo(() => {
    if (kind === "work") {
      let inProcess = 0;
      let approved = 0;
      let rejected = 0;
      for (const r of rows) {
        const bucket = rowWorkBucket(r);
        if (bucket === "Approved") approved++;
        else if (bucket === "Rejected") rejected++;
        else if (bucket === "pending" || bucket === "Returned") inProcess++;
      }
      return { total: rows.length, inProcess, approved, rejected };
    }
    let inProcess = 0;
    let approved = 0;
    let rejected = 0;
    for (const r of rows) {
      if (r.status === "Approved") approved++;
      else if (r.status === "Rejected") rejected++;
      else if (r.status === "Submitted" || r.status === "ManagerApproved" || r.status === "Returned") inProcess++;
    }
    return { total: rows.length, inProcess, approved, rejected };
  }, [rows, kind, rowWorkBucket]);

  return (
    <div className="flex flex-col gap-3">
      {/* Summary totals */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <SummaryStat label="ทั้งหมด" value={summary.total}
          bg="var(--bg-card-alt)" fg="var(--text-heading)" border="var(--border-card)" />
        <SummaryStat label="กำลังดำเนินการ" value={summary.inProcess}
          bg="var(--bg-info-yellow)" fg="var(--text-info-yellow)" border="var(--border-info-yellow)" />
        <SummaryStat label="อนุมัติแล้ว" value={summary.approved}
          bg="var(--bg-info-green)" fg="var(--text-info-green)" border="var(--border-info-green)" />
        <SummaryStat label="ไม่อนุมัติ" value={summary.rejected}
          bg="color-mix(in srgb, var(--color-danger) 10%, transparent)" fg="var(--color-danger)"
          border="color-mix(in srgb, var(--color-danger) 30%, transparent)" />
      </div>

      {/* Search + count */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--text-muted)" }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหาเลขที่ / ชื่อผู้ขอ / แบรนด์..."
            className="w-full rounded-lg pl-9 pr-3 py-2 text-[13px] outline-none"
            style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
          />
        </div>
        <span className="text-[11px] shrink-0" style={{ color: "var(--text-muted)" }}>
          {filtered.length} รายการ
        </span>
      </div>

      {/* Form + submitted date range */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <MultiSelectFilter
          label="ฟอร์ม"
          options={formOptions}
          selected={formFilter}
          onChange={setFormFilter}
          formatLabel={(code) => formLabelByCode[code] ?? code}
        />
        <FilterDateRangePicker
          label="วันที่ส่ง"
          from={dateFrom}
          to={dateTo}
          onChange={(from, to) => {
            setDateFrom(from);
            setDateTo(to);
          }}
          placeholder="เลือกช่วงวันที่ส่ง..."
        />
      </div>

      {hasExtraFilters && (
        <button
          type="button"
          onClick={() => {
            setFormFilter([]);
            setDateFrom("");
            setDateTo("");
          }}
          className="self-start text-[11px] font-semibold px-2.5 py-1 rounded-lg cursor-pointer"
          style={{
            color: "var(--text-muted)",
            background: "var(--bg-card-alt)",
            border: "1px solid var(--border-card)",
          }}
        >
          ล้างตัวกรองฟอร์ม / วันที่
        </button>
      )}

      {/* Status filter chips */}
      {statusGroups.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            key="all"
            type="button"
            onClick={() => setStatusFilter("all")}
            className="text-[11px] font-semibold px-2.5 py-1 rounded-full cursor-pointer transition-colors"
            style={{
              background: statusFilter === "all" ? "var(--nav-active-bg)" : "var(--bg-card-alt)",
              color: statusFilter === "all" ? "var(--nav-active-text)" : "var(--text-muted)",
              border: `1px solid ${statusFilter === "all" ? "var(--nav-active-text)" : "var(--border-card)"}`,
            }}
          >
            ทั้งหมด
          </button>
          {statusGroups.map((g) => {
            const active = statusFilter === g.id;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setStatusFilter(g.id)}
                className="text-[11px] font-semibold px-2.5 py-1 rounded-full cursor-pointer transition-colors"
                style={{
                  background: active ? "var(--nav-active-bg)" : "var(--bg-card-alt)",
                  color: active ? "var(--nav-active-text)" : "var(--text-muted)",
                  border: `1px solid ${active ? "var(--nav-active-text)" : "var(--border-card)"}`,
                }}
              >
                {g.label}
              </button>
            );
          })}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 size={22} className="animate-spin" style={{ color: "var(--text-muted)" }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <Inbox size={26} style={{ color: "var(--text-faint)" }} />
          <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
            {rows.length === 0 ? "ยังไม่มีรายการ" : "ไม่พบรายการที่ตรงกับตัวกรอง"}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((row) => {
            const nextApproval = formatNextApprovalDetail(row);
            const workBucket = kind === "work" ? rowWorkBucket(row) : undefined;
            return (
            <button
              key={row.id}
              type="button"
              onClick={() => openRow(row.id, row.formCode ?? null)}
              className="w-full text-left rounded-xl p-3 flex items-center gap-3 cursor-pointer transition-colors"
              style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <span className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>
                    {row.requestNo ?? "—"}
                  </span>
                  {row.environment === "UAT" && (
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                      style={{ background: "var(--status-bad-bg)", color: "var(--status-bad-text)" }}
                    >
                      UAT
                    </span>
                  )}
                  <StatusBadge status={row.status} workBucket={workBucket} />
                  {row.formCode && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}>
                      {row.formCode}
                    </span>
                  )}
                  {row.brandCode && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: "var(--bg-badge)", color: "var(--text-muted)", border: "1px solid var(--border-light)" }}>
                      {row.brandCode}
                    </span>
                  )}
                </div>
                <p className="text-[11px] truncate" style={{ color: "var(--text-secondary)" }}>
                  {row.formName ? `${row.formName} · ` : ""}
                  {showRequester ? `${row.requesterFullName ?? "—"} · ` : ""}
                  เดินทาง {fmtDate(row.travelDate)} · ส่ง {fmtDate(row.submittedAt)}
                </p>
                {nextApproval && (
                  <p className="text-[10px] truncate mt-0.5 m-0" style={{ color: "var(--text-muted)" }}>
                    {nextApproval}
                  </p>
                )}
              </div>
              <span className="text-[13px] font-bold tabular-nums shrink-0" style={{ color: "var(--color-action)" }}>
                {fmtMoney(row.totalAmount)} ฿
              </span>
              <ChevronRight size={15} className="shrink-0" style={{ color: "var(--text-faint)" }} />
            </button>
            );
          })}
        </div>
      )}

      {/* Detail drawer — same day-selector view as the report / approval queue */}
      <SidePanel open={drawerId != null} onClose={() => setDrawerId(null)} width="min(720px, 100vw)" zIndex={50}>
        <div
          className="flex items-center justify-between px-4 py-3 shrink-0"
          style={{ borderBottom: "1px solid var(--border-light)" }}
        >
          <div className="min-w-0">
            <p className="text-[14px] font-bold truncate m-0" style={{ color: "var(--text-heading)" }}>
              {drawerDetail?.requestNo ?? tbDetail?.requestNo ?? "รายละเอียดคำขอ"}
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
          ) : drawerFormCode === "AP-17" && tbDetail ? (
            <TravelBookingDetail request={tbDetail} onChanged={handleDrawerChanged} readOnlyBooking />
          ) : drawerDetail ? (
            <RequestDetail
              request={drawerDetail}
              onChanged={handleDrawerChanged}
              hideCancel={kind === "work"}
            />
          ) : null}
        </div>
      </SidePanel>
    </div>
  );
}

/* ── Reusable titled card (mine = My Request, work = My Work) ── */

const SOURCES = {
  mine: {
    title: "คำขอของฉัน",
    subtitle: "คำขอที่คุณส่งและสถานะ",
    icon: Send,
    url: "/api/request/accounting/requests/mine",
    showRequester: false,
    returnPath: "/my-request",
  },
  work: {
    title: "งานของฉัน",
    subtitle: "คำขอที่รอคุณอนุมัติหรือเกี่ยวข้อง",
    icon: ClipboardCheck,
    url: "/api/request/accounting/work",
    showRequester: true,
    returnPath: "/my-work",
  },
} as const;

export function MyRequestsCard({ kind, header = true }: { kind: "mine" | "work"; header?: boolean }) {
  const s = SOURCES[kind];
  const Icon = s.icon;
  return (
    <div
      className="acc-theme rounded-2xl overflow-hidden"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
    >
      {header && (
        <div
          className="flex items-center gap-2.5 px-5 py-3"
          style={{ borderBottom: "1px solid var(--border-card)", background: "var(--bg-card-header)" }}
        >
          <span
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
          >
            <Icon size={15} />
          </span>
          <div className="min-w-0">
            <h3 className="text-[13px] font-bold leading-tight" style={{ color: "var(--text-heading)" }}>
              {s.title}
            </h3>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {s.subtitle}
            </p>
          </div>
        </div>
      )}
      <div className="p-4">
        <RequestRowList
          url={s.url}
          showRequester={s.showRequester}
          kind={kind}
        />
      </div>
    </div>
  );
}
