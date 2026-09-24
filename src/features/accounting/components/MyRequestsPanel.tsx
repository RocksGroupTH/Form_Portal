"use client";
import { formatEnDate, formatEnDateTime } from "@/features/accounting/lib/thai-calendar";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Avatar } from "@/components/ui/Avatar";
import { hrPhotoUrl } from "@/lib/hr/photo-url";
import {
  Search,
  Inbox,
  Loader2,
  ChevronRight,
  ChevronDown,
  Check,
  Send,
  ClipboardCheck,
  List,
  Table as TableIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import type { ReportRow } from "@/lib/acc/report-service";
import { MyRequestsTable } from "@/features/accounting/components/MyRequestsTable";
import { formFilterLabel } from "@/lib/acc/form-names";
import { MyRequestStatusChip } from "@/features/accounting/components/MyRequestStatusChip";
import {
  DEFAULT_PAGE_SIZE,
  MY_REQUEST_PAGE_SIZES,
  clampPage,
  pageCount,
  pageSlice,
  pageWindow,
  statusDisplay,
  statusDisplayForBucket,
} from "@/lib/acc/my-request-view";
import type { AccRequest } from "@/features/accounting/types";
import { formatNextApprovalDetail, getMyWorkStatusBucket, type MyWorkStatusBucket, type MyWorkViewerContext } from "@/lib/acc/approval-display";
import { REQUEST_CARDS } from "@/lib/constants";
import { compareFormCodes } from "@/lib/form-code-order";
import { StatIcon, type StatIconName } from "@/components/ui/StatIcon";
import {
  defaultStatusFilter,
  isSummaryBoxActive,
  statusFilterKey,
  statusFilterOptions,
  statusSummaryBoxes,
  sumTotalAmount,
} from "@/features/accounting/lib/request-status-filter";
import { MultiSelectFilter, inDateRange, isMultiSelectActive, matchesMultiSelectValue } from "@/features/accounting/components/ApprovalQueueFilters";
import { FilterDateRangePicker } from "@/features/accounting/components/FilterDateRangePicker";
import { SidePanel, SidePanelClose, SidePanelExpand } from "@/components/ui/SidePanel";
import { RequestDetail } from "@/features/accounting/components/RequestDetail";
import { TravelBookingDetail } from "@/features/travel-booking/components/TravelBookingDetail";
import type { TravelBookingRequest } from "@/features/travel-booking/types";
import { ReimburseDetail } from "@/features/reimburse/components/ReimburseDetail";
import { ClearAdvanceDetail } from "@/features/clear-advance/components/ClearAdvanceDetail";
import type { ClearAdvanceRequest } from "@/features/clear-advance/types";
import type { ReimburseDetail as ReimburseDetailData } from "@/features/reimburse/types";
import { AdvanceDetailPanel } from "@/features/advance/components/AdvanceDetailPanel";
import { useFormEnvironments } from "@/lib/hooks/useFormEnvironments";
import {
  fmtAmountWithCurrency,
  referenceRateNote,
  showsForeignCurrency,
} from "@/lib/acc/currency-display";
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
// The shared English formatter — see thai-calendar.ts. Was a local dd/mm/yyyy,
// one of about twenty identical copies across this app.
const fmtDate = (raw: string | null | undefined) => formatEnDate(raw);

/**
 * One pager button.
 *
 * `aria-label` on every one of them, because the row is otherwise a line of
 * bare digits and two chevrons — readable on screen and meaningless to a screen
 * reader. `aria-current` marks the page in view, which colour alone does not.
 */
function PagerButton({
  children,
  label,
  onClick,
  disabled,
  active,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className="min-w-[26px] h-[26px] px-1.5 rounded-lg text-[11px] font-semibold border-none transition-colors"
      style={{
        background: active ? "var(--color-action)" : "var(--bg-badge)",
        color: active ? "#fff" : "var(--text-secondary)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {children}
    </button>
  );
}

/** The four summary tones, as the three CSS values each needs. */
const SUMMARY_TONES: Record<
  "neutral" | "pending" | "ok" | "warning" | "danger" | "muted",
  { bg: string; fg: string; border: string }
> = {
  neutral: { bg: "var(--bg-card-alt)", fg: "var(--text-heading)", border: "var(--border-card)" },
  pending: {
    bg: "var(--bg-info-yellow)",
    fg: "var(--text-info-yellow)",
    border: "var(--border-info-yellow)",
  },
  ok: { bg: "var(--bg-info-green)", fg: "var(--text-info-green)", border: "var(--border-info-green)" },
  /* ส่งกลับแก้ไข is the warning token, not the danger one: the requester has
     something to do and nothing has been refused. Same distinction
     `myWorkStatusStyle` already draws between Returned and Rejected. */
  warning: {
    bg: "color-mix(in srgb, var(--color-warning) 14%, transparent)",
    fg: "var(--color-warning)",
    border: "color-mix(in srgb, var(--color-warning) 35%, transparent)",
  },
  danger: {
    bg: "color-mix(in srgb, var(--color-danger) 10%, transparent)",
    fg: "var(--color-danger)",
    border: "color-mix(in srgb, var(--color-danger) 30%, transparent)",
  },
  /* ยกเลิก is withdrawn work, not failed work — it earns no colour at all. */
  muted: { bg: "var(--bg-badge)", fg: "var(--text-muted)", border: "var(--border-light)" },
};

/**
 * One summary box — and, since 2026-09-24, the status filter itself.
 *
 * Pressing it selects that box's statuses; the chip row underneath is gone.
 * **The highlight is a ring and a heavier border, not a colour change**: each
 * box already carries its own tone, so recolouring the selected one would
 * either lose the tone that says what it is or produce four different
 * selected looks. `aria-pressed` carries the same fact to a screen reader,
 * which a ring does not.
 */
function SummaryStat({
  label,
  value,
  tone,
  icon,
  active,
  onClick,
}: {
  label: string;
  value: string | number;
  tone: keyof typeof SUMMARY_TONES;
  icon?: StatIconName;
  active?: boolean;
  onClick?: () => void;
}) {
  const t = SUMMARY_TONES[tone];
  const style = {
    background: t.bg,
    border: `1px solid ${active ? t.fg : t.border}`,
    boxShadow: active ? `0 0 0 2px color-mix(in srgb, ${t.fg} 35%, transparent)` : undefined,
    textAlign: "left" as const,
  };
  /* The icon sits to the RIGHT of the figure rather than above the label:
     these boxes are two lines tall and a third row would push the number
     out of a glance. Held back in the tile's own colour — it is a signpost
     for the eye scanning six boxes, never a thing to read. */
  const body = (
    <div className="flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <div className="text-[20px] font-bold leading-none tabular-nums" style={{ color: t.fg }}>
          {value}
        </div>
        <div className="text-[10px] font-medium mt-1 truncate" style={{ color: t.fg, opacity: 0.85 }}>
          {label}
        </div>
      </div>
      {icon && <StatIcon name={icon} color={t.fg} />}
    </div>
  );
  if (!onClick) {
    return (
      <div className="rounded-xl px-3 py-2" style={style}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!!active}
      className="rounded-xl px-3 py-2 cursor-pointer transition-shadow"
      style={style}
    >
      {body}
    </button>
  );
}

/**
 * One vocabulary across both views (the user, 2026-09-24: "ใช้ชุดเดียวกัน").
 *
 * The QUESTION each page asks is unchanged and still differs — งานของฉัน
 * labels a row by what it means to the viewer, คำขอของฉัน by the request's own
 * status — but the words and the colours are now the table's, so toggling the
 * view never changes the word on a row.
 *
 * `myWorkStatusLabel` / `myWorkStatusStyle` / `statusStyle` /
 * `statusLabelDisplay` are no longer read here. The first two have no other
 * caller and stay in `approval-display.ts` beside the bucket logic that is
 * still very much in use; the last two are `RequestStatusBadge`'s vocabulary,
 * which six other surfaces render and which this change deliberately left
 * alone.
 */
function StatusBadge({ status, workBucket }: { status: string; workBucket?: MyWorkStatusBucket }) {
  return (
    <MyRequestStatusChip
      display={workBucket ? statusDisplayForBucket(workBucket) : statusDisplay(status)}
    />
  );
}

/* The status vocabulary these filters offer, the sets the summary boxes stand
   for and the row-to-option mapping all live in
   `@/features/accounting/lib/request-status-filter` — one module, because the
   boxes and the dropdown are two controls over one value and the highlight
   lies the moment they disagree.

   The default is now **no filter at all**, where it used to be รออนุมัติ. A
   page that silently hides your finished requests is a page whose totals
   nobody can reconcile, and the ยอดรวม box added beside these makes that
   worse rather than better: a sum over a filter nobody chose. */

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
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewerReady, setViewerReady] = useState(kind !== "work");
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [drawerDetail, setDrawerDetail] = useState<AccRequest | null>(null);
  const [tbDetail, setTbDetail] = useState<TravelBookingRequest | null>(null);
  const [rbDetail, setRbDetail] = useState<ReimburseDetailData | null>(null);

  /**
   * How wide the detail drawer opens.
   *
   * 720px fits a summary and not much else, and AP-4's รายการค่าใช้จ่ายจริง is a
   * fourteen-column table laid out to match the AP-4.1 sheet — inside that width
   * it is almost entirely horizontal scrolling.
   *
   * Widening this panel rather than opening the detail in a Dialog is deliberate:
   * a Dialog would mount a SECOND copy of the detail beside the one already in
   * the drawer — two `approval-context` fetches, two `people` fetches, and two
   * sets of local state that then disagree about which one the approve button
   * belongs to. One panel that changes width has none of that.
   *
   * **It is the shared drawer, so this widens AP-1's and AP-17's too.** AP-2 and
   * AP-3 each have a drawer of their own and are excluded from this one, so they
   * are unaffected — the branch this landed on said AP-3 widened with the rest,
   * which was true until AP-3 got its own panel on master.
   *
   * A viewer's own preference: it changes no data, and it is not reset on close,
   * because somebody who wants the wide view usually wants it for the next row too.
   */
  const [drawerWide, setDrawerWide] = useState(false);
  const [caDetail, setCaDetail] = useState<ClearAdvanceRequest | null>(null);
  const [drawerFormCode, setDrawerFormCode] = useState<string | null>(null);
  const [loadingDrawer, setLoadingDrawer] = useState(false);
  /**
   * list or table, remembered per page.
   *
   * **The table is the default** (the user's call, 2026-09-24 — reversing their
   * own earlier choice of list once they had seen it). A stored preference
   * still wins: this is what somebody who has never touched the switch gets,
   * not what everybody gets.
   *
   * Read after mount rather than seeded into `useState`, for the reason every
   * localStorage read in this app is: it does not exist on the server, so
   * seeding from it makes the first client render disagree with the server's
   * and hydrate wrong. The cost is that a reader who chose `list` sees one
   * frame of table first — the same trade the theme's no-flash script exists
   * to avoid and which is not worth a cookie here.
   */
  const [view, setView] = useState<"list" | "table">("table");
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(`form-portal-myreq-view-${kind}`);
      if (raw === "table" || raw === "list") setView(raw);
    } catch {
      // Private window or blocked storage: the default stands.
    }
  }, [kind]);
  const chooseView = useCallback(
    (next: "list" | "table") => {
      setView(next);
      try {
        window.localStorage.setItem(`form-portal-myreq-view-${kind}`, next);
      } catch {
        // Losing the preference costs one click, so it is not worth reporting.
      }
    },
    [kind],
  );

  /* Paging is applied to `filtered` BEFORE either renderer sees it, so the
     list and the table show the same page — a page size that changed meaning
     when you pressed the view switch would be its own small lie. */
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);

  /* Home's stat tiles open this page with the filter they counted already
     applied — `?status=Rejected` from ไม่อนุมัติ, `?status=all&from=…&to=…`
     from คำขอเดือนนี้ — so the number on the tile and the list it opens are
     the same set of rows.

     **Seed only, never a controlled value.** The filter chips below are the
     authority once the page is up; re-reading the URL on every render would
     snap a chip the user just pressed back to whatever Home linked to. `?date`
     matches on `submittedAt`, which is what `countHomeStats` measured. */
  const searchParams = useSearchParams();
  const initialStatus = useMemo(() => {
    const raw = searchParams.get("status");
    /* No link, no filter named: the page opens on the box somebody came to
       work from — รออนุมัติจากคุณ on My Work, กำลังดำเนินการ on My Requests
       (the user, 2026-09-24). `all` is an explicit ask for everything and
       must not be read as an absent parameter. */
    if (!raw) return defaultStatusFilter(kind);
    if (raw === "all") return [];
    const known = statusFilterOptions(kind).map((o) => o.id);
    /* Home links with a single coarse id. `pending` is the one that is not an
       option id of its own — it spans both approval steps on My Requests, which
       is exactly what `isPendingApprovalStatus` counted on the tile — so it is
       translated rather than dropped. */
    if (raw === "pending") {
      return kind === "work" ? ["pending"] : ["Submitted", "ManagerApproved"];
    }
    // A comma list is accepted so a link can name the exact selection; an id
    // this page does not know is dropped rather than filtering every row out,
    // which would read as an empty list rather than as a bad link.
    const wanted = raw.split(",").filter((id) => known.includes(id));
    return wanted;
    // Deliberately keyed on nothing: the seed is read once, at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const initialDates = useMemo(() => {
    const isYmd = (v: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    return { from: isYmd(from) ? from! : "", to: isYmd(to) ? to! : "" };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [q, setQ] = useState("");
  /* A multi-select now, not one id: the summary boxes above and the สถานะ
     dropdown below are two controls over this one value (the user,
     2026-09-24), and a box lights when the selection is exactly its set. `[]`
     is every row — `MultiSelectFilter`'s own convention, so no translation
     sits between the two controls. See `request-status-filter.ts`. */
  const [statusFilter, setStatusFilter] = useState<string[]>(initialStatus);
  const [brandFilter, setBrandFilter] = useState<string[]>([]);
  const [payFrom, setPayFrom] = useState("");
  const [payTo, setPayTo] = useState("");
  const [formFilter, setFormFilter] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState(initialDates.from);
  const [dateTo, setDateTo] = useState(initialDates.to);
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
  // Each form's detail lives in its own tables behind its own API, and its own
  // URL prefix is what routes the read to that form's database
  // (`ROUTE_RULES`). Opening an AP-4 or AP-17 row over AP-1's URL would read the
  // wrong shape and, on the action routes, run the wrong workflow.
  const loadDrawer = useCallback((id: number, formCode: string | null) => {
    let cancelled = false;
    setLoadingDrawer(true);
    const url =
      formCode === "AP-17"
        ? `/api/request/travel-booking/requests/${id}`
        : formCode === "AP-4"
          ? `/api/request/reimburse/requests/${id}`
          : formCode === "AP-3"
            ? `/api/request/clear-advance/requests/${id}`
            : `/api/request/accounting/requests/${id}`;
    fetch(url)
      .then((r) => readApiJson<{ ok: boolean; data?: AccRequest | TravelBookingRequest | ReimburseDetailData; error?: string }>(r))
      .then((json) => {
        if (cancelled) return;
        if (json.ok && json.data) {
          if (formCode === "AP-17") setTbDetail(json.data as TravelBookingRequest);
          else if (formCode === "AP-4") setRbDetail(json.data as ReimburseDetailData);
          else if (formCode === "AP-3") setCaDetail(json.data as unknown as ClearAdvanceRequest);
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
      setRbDetail(null);
      return;
    }
    setDrawerDetail(null);
    setTbDetail(null);
    setRbDetail(null);
    // AP-2 (advance) has its own table + API; it renders via AdvanceDetailPanel,
    // which fetches its own data. Routing it through the accounting API 404s.
    if (drawerFormCode === "AP-2") return;
    return loadDrawer(drawerId, drawerFormCode);
  }, [drawerId, drawerFormCode, loadDrawer]);

  const handleDrawerChanged = useCallback(() => {
    void loadRows();
    if (drawerId != null) loadDrawer(drawerId, drawerFormCode);
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
        setViewerReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setWorkViewer({ staffId: null, email: null, isAccountApprover: false });
          setViewerReady(true);
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

  /* Which option id a row belongs to — the request's own status on คำขอของฉัน,
     the viewer-relative bucket on งานของฉัน. One function so the dropdown, the
     summary boxes and the row filter cannot disagree about where a row sits. */
  const statusKeyOf = useCallback(
    (r: ReportRow) =>
      statusFilterKey(kind, kind === "work" ? rowWorkBucket(r) : r.status),
    [kind, rowWorkBucket],
  );

  /* Every option, not only the ones present today. A status filter that
     appears and disappears as rows arrive cannot be linked to or explained,
     and the count beside each summary box already says which are empty. */
  const statusOptions = useMemo(() => statusFilterOptions(kind), [kind]);
  const statusLabelById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const o of statusOptions) map[o.id] = o.label;
    return map;
  }, [statusOptions]);

  /* The boxes count EVERY row, never the filtered ones. A count that shrank to
     zero the moment you pressed another box would make the strip useless as a
     way of moving between statuses — which is what it now is. */
  const boxes = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of rows) {
      const key = statusKeyOf(r);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return statusSummaryBoxes(kind).map((b) => ({
      ...b,
      count: b.ids.length === 0 ? rows.length : b.ids.reduce((n, id) => n + (counts[id] ?? 0), 0),
    }));
  }, [rows, kind, statusKeyOf]);

  const formOptions = useMemo(() => {
    // Seeded from available forms only — a form the viewer cannot use right
    // now (e.g. a UAT-only form while not in UAT mode) shouldn't offer itself
    // as a filter, though a row already on screen for it still counts below.
    const fromCards = REQUEST_CARDS.filter((c) => !c.soon && c.badge && isFormAvailable(c.badge))
      .map((c) => c.badge as string);
    const fromRows = rows.map((r) => r.formCode).filter(Boolean);
    /* `compareFormCodes`, not `.sort()` (the user, 2026-09-24: "ถึงจะไม่มีเลข
       ก็ต้องเรียงข้อมูลตามลำดับ"). A plain string sort orders these AP-1 ·
       AP-17 · AP-2 · AP-3 · AP-4, comparing "17" against "2" one character at
       a time — the same defect Home and the Request hub were fixed for on
       2026-08-22, which is why the comparator already exists. The list shows
       no code since the label became ชื่อไทย (English), so the order is now
       the ONLY thing carrying it, which is what made a wrong one visible
       here and not before. */
    return Array.from(new Set([...fromCards, ...fromRows])).sort(compareFormCodes);
  }, [rows, isFormAvailable]);

  /* From the rows alone, unlike `formOptions`, which seeds itself from the
     forms this viewer could file. There is no equivalent seed for a brand:
     `BRANDS` in @/lib/brand is the four this app draws logos for, and AP-4
     ships claimable under `ROCKS`, which is not one of them — offering a fixed
     list would both omit a brand in use and offer three nobody has filed
     under. */
  const brandOptions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.brandCode).filter(Boolean) as string[])).sort(),
    [rows],
  );

  const formLabelByCode = useMemo(() => {
    const map: Record<string, string> = {};
    /* A form the viewer could file but has not: its name cannot come from a
       row, because there is no row. It used to fall through to the bare code,
       so AP-2 and AP-3 sat unnamed beside four named entries — `form-names.ts`
       is the fallback, and AccFormMaster's own name still wins below wherever
       a row supplies one. */
    for (const c of REQUEST_CARDS) {
      if (c.badge && isFormAvailable(c.badge)) map[c.badge] = formFilterLabel(c.badge);
    }
    for (const r of rows) {
      if (!r.formCode) continue;
      map[r.formCode] = formFilterLabel(r.formCode, r.formName);
    }
    return map;
  }, [rows, isFormAvailable]);

  const hasExtraFilters =
    isMultiSelectActive(formFilter) ||
    isMultiSelectActive(brandFilter) ||
    !!dateFrom ||
    !!dateTo ||
    !!payFrom ||
    !!payTo;

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (!matchesMultiSelectValue(statusKeyOf(r), statusFilter)) return false;
      if (!matchesMultiSelectValue(r.formCode, formFilter)) return false;
      if (!matchesMultiSelectValue(r.brandCode, brandFilter)) return false;
      if (!inDateRange(r.submittedAt, dateFrom, dateTo)) return false;
      /* A request with no payment date yet is OUT once a payment range is set,
         which `inDateRange` already answers — its `!from && !to` arm keeps such
         a row while the range is empty and drops it once one is given. Asking
         for a pay window is asking for rows that have one. */
      if (!inDateRange(r.paymentDate, payFrom, payTo)) return false;
      if (!term) return true;
      return (
        (r.requestNo ?? "").toLowerCase().includes(term) ||
        (r.requesterFullName ?? "").toLowerCase().includes(term) ||
        (r.brandCode ?? "").toLowerCase().includes(term)
      );
    });
  }, [rows, q, statusFilter, formFilter, brandFilter, dateFrom, dateTo, payFrom, payTo, statusKeyOf]);

  /* The page is clamped rather than reset, so narrowing a filter while deep in
     the pages lands on the LAST page instead of an empty one — which reads as
     "no results" over a filter that matched plenty. Derived rather than stored:
     a `page` that only a `useEffect` corrects renders the empty slice once
     first. */
  const pages = pageCount(filtered.length, pageSize);
  const currentPage = clampPage(page, filtered.length, pageSize);
  const paged = useMemo(
    () => pageSlice(filtered, currentPage, pageSize),
    [filtered, currentPage, pageSize],
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Summary totals — and the status filter (the user, 2026-09-24). */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {boxes.map((b) => (
          <SummaryStat
            key={b.id}
            label={b.label}
            value={b.count}
            tone={b.tone}
            icon={b.icon}
            active={isSummaryBoxActive(statusFilter, b)}
            onClick={() => setStatusFilter([...b.ids])}
          />
        ))}
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
        {/* Both views read the same filtered rows and open the same drawer, so
            this switches the shape and nothing else. `aria-pressed` carries
            which one is live to a screen reader, which the fill alone does
            not — the same segmented control Brand Configuration uses. */}
        <div
          className="inline-flex gap-1 p-1 rounded-xl shrink-0"
          style={{ background: "var(--bg-badge)" }}
          role="group"
          aria-label="รูปแบบการแสดงผล"
        >
          {([
            { value: "list", label: "รายการ", Icon: List },
            { value: "table", label: "ตาราง", Icon: TableIcon },
          ] as const).map((v) => {
            const active = view === v.value;
            return (
              <button
                key={v.value}
                type="button"
                aria-pressed={active}
                aria-label={v.label}
                title={v.label}
                onClick={() => chooseView(v.value)}
                className="px-2 py-1 rounded-lg border-none cursor-pointer transition-colors inline-flex items-center"
                style={{
                  background: active ? "var(--color-action)" : "transparent",
                  color: active ? "#fff" : "var(--text-muted)",
                }}
              >
                <v.Icon size={14} />
              </button>
            );
          })}
        </div>
      </div>

      {/* The two date ranges FIRST, then status / form / brand (the user,
          2026-09-24: "กล่อง filter ให้กล่องวันที่ขึ้นก่อน"). It read the other
          way round until then.

          It is only an order, and the order is the whole of it: every one of
          these five narrows the same `filtered` list through the same pass, so
          nothing about what they do changes. Worth knowing why it is worth
          doing at all — สถานะ is already answered by the box strip above,
          which is where that filter is actually set, so the first control a
          reader meets under it should be one the strip cannot express. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
        {/* Accounting sets this when it approves, so a request still in the
            chain has none — and asking for a pay window is asking for the rows
            that have one, which is what `inDateRange` already answers. */}
        <FilterDateRangePicker
          label="วันที่จ่าย"
          /* **The one filter here whose dates are mostly in the future.**
             `FilterDateRangePicker` refuses tomorrow by default, which is
             right for วันที่ส่ง beside it — nothing is submitted in the
             future — and wrong here: accounting sets `PaymentDate` to a round
             that has not happened yet, so the default left this control
             unable to select the very rows it exists to find. */
          allowFuture
          from={payFrom}
          to={payTo}
          onChange={(from, to) => {
            setPayFrom(from);
            setPayTo(to);
          }}
          placeholder="เลือกช่วงวันที่จ่าย..."
        />
      </div>

      {/* สถานะ is a multi-select over the SAME words the chip in each row
          shows — Submitted / Pending / Complete / Rejected / Revise /
          Cancelled — because you filter by what you can see. It replaces the
          chip row that used to sit under these, which grouped Submitted and
          Pending together and could not tell them apart at all. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <MultiSelectFilter
          label="สถานะ"
          options={statusOptions.map((o) => o.id)}
          selected={statusFilter}
          onChange={setStatusFilter}
          formatLabel={(id) => statusLabelById[id] ?? id}
        />
        <MultiSelectFilter
          label="ฟอร์ม"
          options={formOptions}
          selected={formFilter}
          onChange={setFormFilter}
          formatLabel={(code) => formLabelByCode[code] ?? code}
        />
        <MultiSelectFilter
          label="แบรนด์"
          options={brandOptions}
          selected={brandFilter}
          onChange={setBrandFilter}
        />
      </div>

      {(hasExtraFilters || isMultiSelectActive(statusFilter)) && (
        <button
          type="button"
          onClick={() => {
            setStatusFilter([]);
            setFormFilter([]);
            setBrandFilter([]);
            setDateFrom("");
            setDateTo("");
            setPayFrom("");
            setPayTo("");
          }}
          className="self-start text-[11px] font-semibold px-2.5 py-1 rounded-lg cursor-pointer"
          style={{
            color: "var(--text-muted)",
            background: "var(--bg-card-alt)",
            border: "1px solid var(--border-card)",
          }}
        >
          ล้างตัวกรองทั้งหมด
        </button>
      )}

      {/* List */}
      {(loading || !viewerReady) ? (
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
      ) : view === "table" ? (
        /* Same rows, same filters, same drawer — only the shape differs. The
           columns and every cell's text live in `@/lib/acc/my-request-view`,
           which is pure and tested; this passes rows and a click target. */
        <MyRequestsTable
          rows={paged}
          exportRows={filtered}
          kind={kind}
          onOpen={(row) => {
            setDrawerId(row.id);
            setDrawerFormCode(row.formCode ?? null);
          }}
          statusFor={
            kind === "work"
              ? (row) => statusDisplayForBucket(rowWorkBucket(row))
              : undefined
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {paged.map((row) => {
            const nextApproval = formatNextApprovalDetail(row);
            const workBucket = kind === "work" ? rowWorkBucket(row) : undefined;
            return (
            <button
              key={row.id}
              type="button"
              onClick={() => { setDrawerId(row.id); setDrawerFormCode(row.formCode ?? null); }}
              className="w-full text-left rounded-xl p-3 flex items-center gap-3 cursor-pointer transition-colors"
              style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
            >
              {/* Whose request this is, on the same flag that decides whether to
                  name them: in คำขอของฉัน every row is the reader's own, which
                  is why the name is hidden there, and a wall of one's own face
                  would say even less. In งานของฉัน the requester is the thing
                  being scanned for — a queue of 78 is five people. The photos
                  are one cached URL each, so a long list asks for as many
                  images as it has distinct people, not rows. */}
              {showRequester && (
                <Avatar
                  name={row.requesterFullName || "?"}
                  size={36}
                  photo={hrPhotoUrl(row.staffId)}
                  color="var(--nav-active-text)"
                />
              )}
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
                  {/* Both lists span every form, but the query behind them is
                      AP-1-shaped: it joins AccTravelExpense, so a travel date
                      exists only on a travel claim. Printing "เดินทาง" on an
                      AP-2 or AP-3 row labelled an empty dash as a journey that
                      never happened. It appears only where there is one. */}
                  {row.travelDate ? `เดินทาง ${fmtDate(row.travelDate)} · ` : ""}
                  ส่ง {fmtDate(row.submittedAt)}
                </p>
                {nextApproval && (
                  <p className="text-[10px] truncate mt-0.5 m-0" style={{ color: "var(--text-muted)" }}>
                    {nextApproval}
                  </p>
                )}
              </div>
              {/* `฿` is correct on every row — `totalAmount` is baht in both
                  views. What a foreign claim needs beside it is the figure its
                  owner actually spent, which is the number they are checking
                  this list against. Nothing renders on a baht claim. */}
              <span className="text-[13px] font-bold tabular-nums shrink-0 text-right" style={{ color: "var(--color-action)" }}>
                {fmtMoney(row.totalAmount)} ฿
                {showsForeignCurrency(row.currency) && row.foreignAmount != null && (
                  <span
                    className="text-[10px] font-semibold block"
                    style={{ color: "var(--text-muted)" }}
                    title={
                      row.exchangeRate != null
                        ? referenceRateNote(row.currency, row.exchangeRate, row.rateAsOf)
                        : undefined
                    }
                  >
                    {fmtAmountWithCurrency(row.foreignAmount, row.currency)}
                  </span>
                )}
              </span>
              <ChevronRight size={15} className="shrink-0" style={{ color: "var(--text-faint)" }} />
            </button>
            );
          })}
        </div>
      )}

      {/* The filtered total, under the table where a total belongs (the user,
          2026-09-24 — it was a fifth summary box for one commit).

          It sums EVERY filtered row, not the page on screen: a total that
          changed when you turned the page would answer no question anybody
          asks. Baht whatever currency a claim was entered in, which is why
          these figures can be added at all — see `sumTotalAmount`. */}
      {!loading && viewerReady && filtered.length > 0 && (
        <div className="flex items-center justify-end gap-2 pt-1">
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            ยอดรวมที่กรอง ({filtered.length} รายการ)
          </span>
          <span
            className="text-[15px] font-bold tabular-nums"
            style={{ color: "var(--text-heading)" }}
          >
            {fmtMoney(sumTotalAmount(filtered))}
          </span>
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            บาท
          </span>
        </div>
      )}

      {/* The pager sits BELOW both views and outside the empty/loading arms, so
          it is absent exactly when there is nothing to page — a "1 / 1" under
          an empty list is a control that cannot do anything. */}
      {!loading && viewerReady && filtered.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          {/* A native <select> paints its own panel from the OS — a white
              sheet with a blue highlight that belongs to neither theme, and
              which no CSS here can reach. This is the app's own
              `DropdownMenu`: Radix, themed from the same tokens as everything
              around it, and PORTALLED, so it cannot be clipped by an ancestor
              the way the คอลัมน์ menu was.

              It had no callers at all before this — a leftover from the Rocks
              Fast clone. Reviving it beat writing a third dropdown pattern
              beside `ColumnToggleMenu` and `SearchableSelect`. */}
          <div className="flex items-center gap-1.5 text-[11px]" style={{ color: "var(--text-muted)" }}>
            <span>แสดง</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`จำนวนรายการต่อหน้า — ขณะนี้ ${pageSize}`}
                  className="inline-flex items-center gap-1 rounded-lg pl-2.5 pr-1.5 py-1 text-[11px] font-semibold cursor-pointer transition-colors"
                  style={{
                    background: "var(--bg-input)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border-input)",
                  }}
                >
                  {pageSize}
                  <ChevronDown size={13} style={{ color: "var(--text-muted)" }} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[88px]">
                {MY_REQUEST_PAGE_SIZES.map((n) => (
                  <DropdownMenuItem
                    key={n}
                    onSelect={() => {
                      setPageSize(n);
                      /* Back to the first page. Keeping the number would land
                         a reader on page 6 of 2 after switching 10 -> 100, and
                         the clamp would then move them somewhere they never
                         asked to go. Page 1 is the one answer that is never a
                         surprise. */
                      setPage(1);
                    }}
                    className="justify-between rounded-md mx-1 text-[12px] data-[highlighted]:bg-[var(--bg-card-alt)]"
                  >
                    <span style={{ fontWeight: n === pageSize ? 700 : 400 }}>{n}</span>
                    {/* The tick rather than a filled row: this menu opens over
                        the table, and a solid highlight reads as a hover
                        somebody is about to click. */}
                    {n === pageSize && <Check size={13} style={{ color: "var(--color-action)" }} />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <span>รายการ · ทั้งหมด {filtered.length}</span>
          </div>

          {pages > 1 && (
            <div className="flex items-center gap-1">
              <PagerButton
                label="ก่อนหน้า"
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
              >
                ‹
              </PagerButton>
              {pageWindow(currentPage, pages).map((p, i) =>
                p === "gap" ? (
                  <span
                    key={`gap-${i}`}
                    className="px-1 text-[11px] select-none"
                    style={{ color: "var(--text-faint)" }}
                  >
                    …
                  </span>
                ) : (
                  <PagerButton
                    key={p}
                    label={`หน้า ${p}`}
                    active={p === currentPage}
                    onClick={() => setPage(p)}
                  >
                    {p}
                  </PagerButton>
                ),
              )}
              <PagerButton
                label="ถัดไป"
                disabled={currentPage >= pages}
                onClick={() => setPage(currentPage + 1)}
              >
                ›
              </PagerButton>
            </div>
          )}
        </div>
      )}

      {/* AP-2 (advance) — self-contained drawer with its own fetch + vendor/approve */}
      {drawerFormCode === "AP-2" && drawerId != null && (
        <AdvanceDetailPanel
          requestId={drawerId}
          onClose={() => setDrawerId(null)}
          onChanged={() => void loadRows()}
        />
      )}

      {/* AP-3 (clear advance) — the same document its own page shows, in a drawer.
          Its detail component takes the request as a prop rather than fetching,
          so loadDrawer reads it from AP-3's own API: the generic path below is
          AP-1's, and an AP-3 id is not in AP-1's tables, which answered 404. */}
      <SidePanel
        open={drawerFormCode === "AP-3" && drawerId != null}
        onClose={() => { setDrawerId(null); setCaDetail(null); }}
        width="min(980px, 100vw)"
        zIndex={50}
      >
        <div className="flex items-center justify-between px-4 py-3 shrink-0"
          style={{ borderBottom: "1px solid var(--border-light)" }}>
          <div className="min-w-0">
            <p className="text-[14px] font-bold truncate m-0" style={{ color: "var(--text-heading)" }}>
              {caDetail?.requestNo ?? "เคลียร์คืนเงินทดรองจ่าย"}
            </p>
            <p className="text-[11px] m-0 mt-0.5" style={{ color: "var(--text-muted)" }}>
              แบบฟอร์มเคลียร์คืนเงินทดรองจ่าย (AP-3)
            </p>
          </div>
          <SidePanelClose onClick={() => { setDrawerId(null); setCaDetail(null); }} />
        </div>
        <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-4 acc-theme">
          {loadingDrawer || !caDetail ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-muted)" }} />
            </div>
          ) : (
            <ClearAdvanceDetail
              request={caDetail}
              onChanged={() => { void loadRows(); if (drawerId != null) loadDrawer(drawerId, "AP-3"); }}
            />
          )}
        </div>
      </SidePanel>

      {/* Detail drawer — same day-selector view as the report / approval queue */}
{/* AP-2 and AP-3 have their own drawers above. */}
      <SidePanel
        open={drawerId != null && drawerFormCode !== "AP-2" && drawerFormCode !== "AP-3"}
        onClose={() => setDrawerId(null)}
        /* Expanded is 85% of the viewport, not all of it (user, 2026-09-15).
           "min(1680px, 100vw)" reached the full width on any ordinary laptop,
           so the button read as a full-screen toggle and the list behind it
           disappeared — the point of a side panel is that the row it came from
           stays in view. The cap survives for a very wide monitor, where 85%
           of 3440px is already more than the content needs. */
        width={drawerWide ? "min(1680px, 85vw)" : "min(720px, 100vw)"}
        zIndex={50}
      >
        <div
          className="flex items-center justify-between px-4 py-3 shrink-0"
          style={{ borderBottom: "1px solid var(--border-light)" }}
        >
          <div className="min-w-0">
            <p className="text-[14px] font-bold truncate m-0" style={{ color: "var(--text-heading)" }}>
              {drawerDetail?.requestNo ?? tbDetail?.requestNo ?? rbDetail?.requestNo ?? "รายละเอียดคำขอ"}
            </p>
            <p className="text-[11px] m-0 mt-0.5" style={{ color: "var(--text-muted)" }}>
              ตรวจสอบรายละเอียดและเอกสารแนบ
            </p>
          </div>
          {/* Beside Close, because both act on the panel rather than on the
              request inside it. Shared with AP-4's queue drawer since 2026-09-10
              — the labels are the half that drifts when this is duplicated. */}
          <div className="flex items-center gap-1 shrink-0">
            <SidePanelExpand wide={drawerWide} onToggle={() => setDrawerWide((v) => !v)} />
            <SidePanelClose onClick={() => setDrawerId(null)} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-4 acc-theme">
          {loadingDrawer ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin" style={{ color: "var(--text-muted)" }} />
            </div>
          ) : drawerFormCode === "AP-17" && tbDetail ? (
            <TravelBookingDetail request={tbDetail} onChanged={handleDrawerChanged} readOnlyBooking />
          ) : drawerFormCode === "AP-4" && rbDetail ? (
            <ReimburseDetail request={rbDetail} onChanged={handleDrawerChanged} />
          ) : drawerFormCode !== "AP-4" && drawerDetail ? (
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
      /* **No `overflow-hidden`**, and that is load-bearing rather than a
         tidy-up. The คอลัมน์ menu is an absolutely-positioned panel with its
         own scroll (`ColumnToggleMenu`, max-h-[360px]); clipped to this card
         it was cut off at the card's own bottom edge, so on a page with one
         or two rows the list of columns was mostly invisible — which is
         exactly when somebody opens it.

         The rounding it protected belongs to the header, which now rounds its
         own top corners. Both live callers pass `header={false}` anyway, so
         nothing inside paints to the edge at all. */
      className="acc-theme rounded-2xl"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
    >
      {header && (
        <div
          className="flex items-center gap-2.5 px-5 py-3 rounded-t-2xl"
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
