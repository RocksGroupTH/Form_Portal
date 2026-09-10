"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import {
  CalendarDays,
  Check,
  Clock,
  Inbox,
  Info,
  Loader2,
  Lock,
  RotateCcw,
  ThumbsUp,
} from "lucide-react";
import { fmtBaht } from "@/features/travel-booking/components/shared";
import { ExpenseAccountPicker } from "@/features/reimburse/components/ExpenseAccountPicker";
import { VendorPicker } from "@/features/reimburse/components/VendorPicker";
import { ReimburseQueueFilterBar } from "@/features/reimburse/components/ReimburseQueueFilterBar";
import { claimReadiness } from "@/features/reimburse/lib/queue-readiness";
import { SidePanel, SidePanelClose } from "@/components/ui/SidePanel";
import { Dialog } from "@/components/ui/Dialog";
import { PaymentDatePicker } from "@/features/accounting/components/PaymentDatePicker";
import { ReimburseDetail } from "@/features/reimburse/components/ReimburseDetail";
import { ErpInterfaceBrandTabs } from "@/features/accounting/components/ErpInterfaceBrandTabs";
import { ERP_INTERFACE_UNASSIGNED } from "@/features/accounting/lib/erp-interface-target";
import {
  EMPTY_REIMBURSE_QUEUE_FILTERS,
  applyReimburseQueueFilters,
  type ReimburseQueueFilters,
} from "@/features/reimburse/lib/queue-filters";
// Type-only, and deliberately from the pure module rather than `./queue-service`
// — that file imports `getAccPool`, which reaches `@/lib/db/mssql` and `@/env`
// at module scope. A type-only import is erased at build time regardless of
// where it is written, but pointing at the import-free home keeps that true by
// construction rather than by relying on erasure to save a mistake later.
import type { ReimburseQueueItem, ReimburseQueueRow } from "@/lib/acc/reimburse/queue-policy";
// Both type-only for the same reason: `.../types` is import-free, but
// `expense-account-service.ts` is not — it opens `getErpDataPool()` at module
// scope. Only the shape is needed here; `ExpenseAccountPicker` above already
// proves that pattern is safe (it does the same import).
import type { ReimburseDetail as ReimburseDetailData, ReimburseItem } from "@/features/reimburse/types";
import type { TaxVendorCandidate } from "@/lib/clr/tax-vendor-service";
import type { ExpenseAccount } from "@/lib/acc/reimburse/expense-account-service";

/**
 * AP-4's accounting queue — every claim parked at `(ManagerApproved, ACCOUNT)`,
 * where `approveReimburseAccountCheck` (`approval-service.ts`) fixes the
 * payment date and hands the claim to the second accountant.
 *
 * **Sight of the PAGE is `approvalQueue` (`decideReimburseMenuAccess`), not
 * `AccReimburseApprover` membership — but sight of ROWS is scoped, since
 * migration 144 (2026-09-10).** These used to be the same fact; they are not
 * any more, and the distinction is what the yellow notice below and the
 * three-way empty state exist to explain:
 *
 *  - The menu grant decides whether this viewer reaches the endpoint at all.
 *    A viewer with the tick and no active `AccReimburseApprover` row still
 *    reaches it — but their own brand scope is `null` (no active roster row,
 *    `requireApproverScopeFor`'s own three-valued distinction,
 *    `approval-service.ts`), and `accumulateAccountQueueRows` answers `[]` for
 *    a `null` scope rather than falling back to "show everything". So they now
 *    see an EMPTY queue, not a full one — the sentence this docblock used to
 *    carry ("sees a full queue and gets ไม่มีสิทธิ์ from every action") is what
 *    Task 5 changed. CLAUDE.md and the design spec have since been corrected
 *    to match (Task 9, commit `b2184dd`) — see `approvals-route-authz-guard.test.ts`
 *    for the history of that correction.
 *  - A scoped approver (a real `scope: string[]`) sees only the claims whose
 *    brand resolves to one of their ticked Interface targets. Whether a given
 *    click succeeds is STILL re-decided by the approval service inside the
 *    same transaction that writes — the row filter here is sight, not the
 *    control, and a stale page or a bookmark from before a scope narrowed is
 *    still refused server-side regardless of what this page shows.
 *  - A third state — `unmappedBrandCount > 0` — is neither of the above:
 *    claims exist, pending, that NOBODY's scope can ever cover, because their
 *    own `BrandCode` resolves to no Interface target at all
 *    (`AccBrandErpInterface` has no row — `ROCKS`, migration 092's seed, is
 *    exactly this). Rendering that identically to "nothing is pending" would
 *    make a stuck claim invisible with no way for anyone to learn why.
 *
 * **One payment-date control for the whole selection, not a picker per row and
 * not a dropdown of rounds.** `paymentDateProblem` (`approval-policy.ts`,
 * 2026-09-08) replaced a membership test against the 1st/3rd-Friday rounds
 * with a one-month-back/twelve-months-forward sanity bound, specifically so
 * accounting can pick a date the generated rounds do not include. A `<select>`
 * of rounds would silently re-impose the constraint the server just gave up.
 * The suggested round is still offered, as the field's default — a suggestion,
 * not a limit.
 *
 * **Approve loops the existing per-request route, one call per selected id.**
 * Every guard on `POST .../requests/[id]/approve` — the roster check, the
 * two-person rule (irrelevant at this step, but shared code), the
 * `(Status, CurrentStepCode)` claim — is per request. A bulk endpoint would
 * have to re-implement all three and could only get them wrong; AP-17's bulk
 * payout-date control loops the same way for the same reason.
 *
 * **No Reject button.** Rejecting a claim at either accounting step is
 * refused server-side — `mayReject` (`approval-policy.ts`) answers false for
 * `ACCOUNT`/`ACCOUNT_FINAL`, and `rejectReimburse` throws before it claims or
 * writes anything when it does. `ReimburseDetail.tsx` gates its own Reject
 * button to `step === "MANAGER"` for the same reason, so this page simply
 * never renders one rather than offering a click that can only come back as
 * a 403.
 *
 * **A 409 refetches rather than offering a retry.** The queue this page reads
 * and the claim a click targets can both move between page load and click —
 * another accountant approving or returning the same row first — and retrying
 * a stale claim cannot succeed. Every action path below ends in `mutate()`
 * regardless of outcome, and a 409 specifically is named in its own toast
 * rather than folded into the generic failure count, because "try again" is
 * the wrong advice for it.
 */

interface QueueData {
  rows: ReimburseQueueRow[];
  paymentOptions: string[];
  suggested: string | null;
  /**
   * Roster membership on `AccReimburseApprover`, for the notice below — NOT a
   * gate. `boolean | null`: `null` while the server itself could not read the
   * roster, which must never render as "you are not on it". Lives on this
   * route rather than a separate `/access` fetch since 2026-09-09 — see the
   * route's own docblock for why splitting it out cost every `/request` hub
   * visit and every AP-4 settings-page visit an unwanted `Rocks_Portal_HR`
   * lookup.
   */
  isReimburseApprover: boolean | null;
  /**
   * This viewer's own ticked Interface targets — `null` when they hold no
   * active `AccReimburseApprover` row at all (see `isReimburseApprover`
   * above, which is the same fact from `AccReimburseApprover` alone; this is
   * the fact from the join with `AccReimburseApproverBrand`). An empty array
   * should not occur in practice — `setReimburseApproverBrands` keeps
   * `IsActive` in step with `targets.length > 0` — but is handled the same as
   * a non-empty one rather than assumed impossible.
   */
  scope: string[] | null;
  /**
   * Claims at `(ManagerApproved, ACCOUNT)` whose own `BrandCode` resolves to
   * no Interface target at all — invisible to every scope, not just this
   * viewer's. See `countUnmappedBrandRows` (`queue-policy.ts`).
   */
  unmappedBrandCount: number;
}

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function fetcher(url: string): Promise<QueueData> {
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  if (!json?.ok) {
    throw new ApiError(
      typeof json?.error === "string" ? json.error : "โหลดข้อมูลไม่สำเร็จ",
      res.status,
    );
  }
  return json.data as QueueData;
}

/** The existing options route (`expense-account-service.ts`'s `listExpenseAccounts`), unchanged — brand-keyed, so SWR's cache dedupes it across every row of the same brand. */
async function accountsFetcher(url: string): Promise<ExpenseAccount[]> {
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  if (!json?.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : "โหลดรายการบัญชีไม่สำเร็จ");
  }
  return json.data as ExpenseAccount[];
}

/** Local getters throughout — the server runs on Thai wall time, `toISOString` would shift the day. */
function fmtDateTime(raw: string | null): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`;
}

/** `raw` is already `YYYY-MM-DD` local-calendar text; parsing through `Date` would reinterpret it as UTC midnight. */
function fmtYmd(raw: string | null): string {
  if (!raw) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : raw;
}

/** Row-selection checkbox — same shape as AP-1's and AP-17's queue checkboxes. */
function QueueCheckbox({
  checked,
  onChange,
  ariaLabel,
  disabled,
  title,
}: {
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
  disabled?: boolean;
  /** Why it is disabled. A silent disabled box reads as a broken one. */
  title?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (disabled) return;
        onChange();
      }}
      className={`w-[18px] h-[18px] rounded-[6px] flex items-center justify-center shrink-0 transition-all border-none p-0 ${
        disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer"
      }`}
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


/**
 * The queue's columns, in the order the user specified.
 *
 * `claimLevel` marks the six that belong to the request rather than to the
 * line; they are rendered once per claim with `rowSpan` and tinted, so the eye
 * can tell "this is about the whole request" from "this is about this line".
 * วันจ่าย is claim-level too — `PaymentDate` is a column on `AccRequest`, one
 * per claim — even though it reads last.
 *
 * The select checkbox and the action cell are outside this list because neither
 * is data.
 */
const FLAT_COLUMNS: readonly {
  label: string;
  right?: boolean;
  width?: string;
  claimLevel?: boolean;
}[] = [
  { label: "เลขที่", width: "150px", claimLevel: true },
  { label: "วันที่ส่ง", width: "130px", claimLevel: true },
  { label: "ผจก. อนุมัติ", width: "130px", claimLevel: true },
  { label: "ผู้ขอ", width: "170px", claimLevel: true },
  { label: "Dept", width: "80px", claimLevel: true },
  { label: "แบรนด์", width: "80px", claimLevel: true },
  { label: "ลำดับที่", width: "60px" },
  { label: "วันที่", width: "95px" },
  { label: "เลขที่เอกสาร", width: "150px" },
  { label: "รายละเอียด", width: "220px" },
  { label: "สาขา", width: "110px" },
  { label: "เลขผู้เสียภาษี", width: "125px" },
  { label: "ผู้ขาย", width: "180px" },
  { label: "ก่อน VAT", right: true, width: "95px" },
  { label: "VAT", right: true, width: "85px" },
  { label: "ค่าใช้จ่ายรวม", right: true, width: "105px" },
  { label: "หัก ณ ที่จ่าย", right: true, width: "95px" },
  { label: "จ่ายสุทธิ", right: true, width: "105px" },
  { label: "G/L Account", width: "210px" },
  { label: "Vendor", width: "210px" },
  { label: "วันจ่าย", width: "160px", claimLevel: true },
];

/** One table row: a claim and one of its lines, plus where it sits in the group. */
interface FlatRow {
  key: string;
  claim: ReimburseQueueRow;
  /** Null only for a claim with no lines at all, which cannot be approved. */
  item: ReimburseQueueItem | null;
  groupIndex: number;
  groupSize: number;
}

/**
 * One row per expense line, carrying the group meta the `rowSpan` needs.
 *
 * A claim with no lines still produces one row: dropping it would hide a claim
 * that is genuinely in this queue and genuinely stuck, which is worse than a
 * row saying so. `groupSize` is 1 there, so the `rowSpan` is still correct.
 *
 * Same shape as AP-1's `expandApprovalRows` / `withRequestGroupMeta` pair,
 * collapsed into one pass because AP-4 has one level of nesting rather than two.
 */
function expandQueueRows(rows: readonly ReimburseQueueRow[]): FlatRow[] {
  const out: FlatRow[] = [];
  for (const claim of rows) {
    if (claim.items.length === 0) {
      out.push({ key: `${claim.id}-empty`, claim, item: null, groupIndex: 0, groupSize: 1 });
      continue;
    }
    claim.items.forEach((item, i) => {
      out.push({
        key: `${claim.id}-${item.id}`,
        claim,
        item,
        groupIndex: i,
        groupSize: claim.items.length,
      });
    });
  }
  return out;
}

/** Every vendor card in the claim's Company — see the route's own note on why the whole list. */
async function vendorsFetcher(url: string): Promise<TaxVendorCandidate[]> {
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  if (!json?.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : "โหลดรายชื่อ Vendor ไม่สำเร็จ");
  }
  return json.data as TaxVendorCandidate[];
}

/**
 * The two editable cells on a line: its G/L account and its BC vendor.
 *
 * A component of its own so each can call `useSWR` for the brand its claim
 * belongs to — hooks cannot be called from inside a `map`, and a queue tab can
 * hold claims from several claim brands that share one Interface target. SWR
 * dedupes by key, so N lines of the same brand still make one request each for
 * accounts and vendors.
 *
 * **It renders no save button.** Picking writes immediately; see
 * `saveItemField`. The cell shows its own in-flight and failed states, because
 * a toast that has scrolled away cannot tell you WHICH of twenty lines did not
 * save.
 */
function LineAccountCells({
  brandCode,
  item,
  category,
  vendorNo,
  busy,
  error,
  onChange,
}: {
  brandCode: string;
  requestId: number;
  item: ReimburseQueueItem;
  category: string | null;
  vendorNo: string | null;
  busy: boolean;
  error?: string;
  onChange: (patch: { category?: string | null; vendorNo?: string | null }) => void;
}) {
  const { data: accounts, isLoading: accountsLoading } = useSWR(
    brandCode
      ? `/api/request/reimburse/options/expense-accounts?brand=${encodeURIComponent(brandCode)}`
      : null,
    accountsFetcher,
  );
  const { data: vendors, isLoading: vendorsLoading } = useSWR(
    brandCode ? `/api/request/reimburse/vendors?brand=${encodeURIComponent(brandCode)}` : null,
    vendorsFetcher,
  );

  return (
    <>
      <td className="py-2 px-2 align-middle">
        <div className="flex items-center gap-1.5">
          <div className="flex-1 min-w-0">
            <ExpenseAccountPicker
              value={category}
              onChange={(next) => onChange({ category: next })}
              accounts={accounts ?? []}
              loading={accountsLoading}
              brandChosen={!!brandCode}
              ariaLabel={`เลือกบัญชีสำหรับ ${item.description || "รายการ"}`}
            />
          </div>
          {busy && <Loader2 size={12} className="animate-spin shrink-0" style={{ color: "var(--text-muted)" }} />}
        </div>
      </td>
      <td className="py-2 px-2 align-middle">
        <VendorPicker
          value={vendorNo}
          onChange={(next) => onChange({ vendorNo: next })}
          vendors={vendors ?? []}
          loading={vendorsLoading}
          brandChosen={!!brandCode}
          ariaLabel={`เลือก Vendor สำหรับ ${item.description || "รายการ"}`}
        />
        {/* Beside the control that failed, not in a toast. Twenty lines save
            independently here and a toast names none of them. */}
        {error && (
          <span className="block text-[10.5px] mt-0.5 leading-tight" style={{ color: "var(--color-danger)" }}>
            {error}
          </span>
        )}
      </td>
    </>
  );
}
export function ReimburseApprovalQueue() {
  const { data, error, isLoading, mutate } = useSWR("/api/request/reimburse/approvals", fetcher);
  // Roster membership, for the notice below — NOT a gate. Sight of this page
  // is decided by the route's own `approvalQueue` check; this only says
  // whether the actions will work. Read straight off this fetch's own
  // payload — it used to be a separate `useReimburseAccess()` call
  // (`/api/request/reimburse/access`) for one day, which meant every visit to
  // the `/request` hub and to AP-4's settings page paid a `Rocks_Portal_HR`
  // lookup neither of them needed. See the `/approvals` route's docblock.
  const isReimburseApprover = data?.isReimburseApprover ?? null;
  // I1 (2026-09-10): `scope` and `unmappedBrandCount` are what let the empty
  // state below tell "nothing pending", "everything pending is outside your
  // scope" and "some claims are stuck on an unmapped brand" apart — see
  // `ReimburseAccountQueueResult`'s own docblock (`queue-service.ts`).
  const scope = data?.scope ?? null;
  const unmappedBrandCount = data?.unmappedBrandCount ?? 0;

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDate, setBulkDate] = useState("");
  const [dateTouched, setDateTouched] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  // Which rows show their expense lines. A `Set` rather than one id: nothing
  // stops an accountant comparing two claims' line items side by side.
  /**
   * Request id -> the payment date typed on that claim's own row.
   *
   * A claim absent from this map has not been given one and falls through to
   * `effectiveDate` — the bulk field, itself seeded from the suggested round.
   * That is what makes the bulk control still work: it does not write into
   * every row, it is what a row shows when it has nothing of its own, so
   * changing it moves every claim the accountant has not overridden and leaves
   * the ones they have.
   *
   * Cleared for a claim that leaves the queue, alongside the selection below,
   * for the same reason: a stale id would re-target whatever number takes its
   * place.
   */
  const [rowDates, setRowDates] = useState<Map<number, string>>(new Map());

  const allRows: ReimburseQueueRow[] = data?.rows ?? [];

  /**
   * Which Interface group is on screen, and the filters over it.
   *
   * The tab is the outer cut and the filters the inner one, in that order:
   * "PCTH, and of those the ones from Operations" is the question an approver
   * asks, and it makes the tab counts stable while a filter is typed — counting
   * after the filters would make every tab read 0 the moment a search matched
   * nothing, which looks like the groups being empty rather than the search.
   */
  const [interfaceTarget, setInterfaceTarget] = useState("");
  const [filters, setFilters] = useState<ReimburseQueueFilters>(EMPTY_REIMBURSE_QUEUE_FILTERS);

  const codeOf = (t: string | null) => (t ?? "").trim().toUpperCase() || ERP_INTERFACE_UNASSIGNED;

  const ifaceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of allRows) {
      const c = codeOf(r.interfaceTarget);
      counts[c] = (counts[c] ?? 0) + 1;
    }
    return counts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows]);

  // The first group that actually holds something, once the queue has loaded.
  // Landing on an empty tab when a full one exists is the same failure as
  // showing an empty page: correct, and read as "there is nothing".
  useEffect(() => {
    if (interfaceTarget) return;
    const first = Object.keys(ifaceCounts).find((c) => (ifaceCounts[c] ?? 0) > 0);
    if (first) setInterfaceTarget(first);
  }, [ifaceCounts, interfaceTarget]);

  const rows = useMemo(() => {
    const inTab = interfaceTarget
      ? allRows.filter((r) => codeOf(r.interfaceTarget) === interfaceTarget)
      : allRows;
    return applyReimburseQueueFilters(inTab, filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, interfaceTarget, filters]);

  /**
   * The options each multi-select offers — from the rows in the CURRENT TAB,
   * not the whole queue and not a master list. A department with no pending
   * claim here is a filter that can only ever return nothing.
   */
  const departmentOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of allRows) {
      if (interfaceTarget && codeOf(r.interfaceTarget) !== interfaceTarget) continue;
      if (r.requesterDepartmentName) s.add(r.requesterDepartmentName);
    }
    return Array.from(s).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, interfaceTarget]);

  const brandOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of allRows) {
      if (interfaceTarget && codeOf(r.interfaceTarget) !== interfaceTarget) continue;
      if (r.brandCode) s.add(r.brandCode);
    }
    return Array.from(s).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allRows, interfaceTarget]);



  // The default follows `suggested` until the accountant edits it by hand —
  // never overwritten again after that, including across a refetch, or a
  // half-typed choice would vanish under someone mid-edit.
  useEffect(() => {
    if (!dateTouched && data?.suggested) setBulkDate(data.suggested);
  }, [data?.suggested, dateTouched]);

  // Drop any selected id the queue no longer holds — the row left because it
  // was approved or returned (by this page or another tab), and a stale id
  // left in the set would silently re-target whatever the number now belongs
  // to on the next click.
  useEffect(() => {
    if (!data) return;
    const live = new Set(rows.map((r) => r.id));
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<number>();
      prev.forEach((id) => {
        if (live.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
    setRowDates((prev) => {
      let changed = false;
      const next = new Map<number, string>();
      prev.forEach((v, id) => {
        if (live.has(id)) next.set(id, v);
        else changed = true;
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const selectedCount = selectedIds.size;
  // `bulkDate` alone once the accountant has touched the field. The
  // `|| data?.suggested` arm is only the bridge across the render before the
  // effect above has copied the suggestion into state — keeping it live after
  // that made CLEARING the field re-render the suggested date under the
  // cursor, so the control could not be emptied. Empty is a legitimate
  // intermediate state while retyping a date, and it is already covered: the
  // approve button is disabled on a falsy `effectiveDate`.
  const effectiveDate = dateTouched ? bulkDate : bulkDate || data?.suggested || "";

  /**
   * The date THIS claim is approved with — its own if one was typed on the row,
   * the shared field otherwise.
   *
   * The server has always taken a date per request: `POST .../[id]/approve`
   * carries `paymentDate` and validates it with `paymentDateProblem`. The loop
   * below was sending one value N times by choice, not by constraint, so
   * nothing server-side changed to allow this.
   */
  const dateFor = (id: number) => rowDates.get(id) ?? effectiveDate;

  /**
   * Optimistic values for a line whose save is in flight, keyed by item id.
   *
   * The picker shows what was just chosen while the PATCH runs, and the entry
   * is dropped when the queue refetches with the saved value — or, on failure,
   * dropped immediately so the cell snaps back to what the database still
   * holds. Reverting rather than leaving the choice on screen is the point:
   * a value that looks saved and is not is the failure this whole screen must
   * not produce, because approving reads the stored row, not the cell.
   */
  /**
   * The claim open in the detail drawer.
   *
   * A drawer rather than a link away: an approver deciding a vendor needs the
   * receipt and the approval history, and losing the queue -- its tab, its
   * filters, and every account picked but not yet saved -- to read them is a
   * worse trade than a panel over the top. Same SidePanel and the same
   * ReimburseDetail that /my-request opens, so the two read identically.
   */
  /** Which claim's payment date is being chosen in the calendar dialog. */
  const [editingPaymentId, setEditingPaymentId] = useState<number | null>(null);

  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [drawerDetail, setDrawerDetail] = useState<ReimburseDetailData | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

  useEffect(() => {
    if (drawerId == null) {
      setDrawerDetail(null);
      return;
    }
    let cancelled = false;
    setDrawerLoading(true);
    setDrawerDetail(null);
    fetch(`/api/request/reimburse/requests/${drawerId}`)
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: ReimburseDetailData }) => {
        if (!cancelled && json.ok && json.data) setDrawerDetail(json.data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setDrawerLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [drawerId]);

  const [optimistic, setOptimistic] = useState<
    Map<number, { category?: string | null; vendorNo?: string | null }>
  >(new Map());
  const [savingItems, setSavingItems] = useState<Set<number>>(new Set());
  const [rowErrors, setRowErrors] = useState<Map<number, string>>(new Map());

  /**
   * One save at a time per claim.
   *
   * Every PATCH claims the claim's row with a conditional UPDATE inside a
   * transaction (`setReimburseItemAccounts`), so two in flight against the same
   * claim race for it and the loser answers 409 — a conflict invented by this
   * screen rather than by another accountant. Chained per claim, they queue
   * instead; different claims still save in parallel.
   */
  const saveChains = useRef<Map<number, Promise<void>>>(new Map());

  const categoryOf = (item: ReimburseQueueItem) => {
    const o = optimistic.get(item.id);
    return o && "category" in o ? (o.category ?? null) : item.category;
  };
  const vendorOf = (item: ReimburseQueueItem) => {
    const o = optimistic.get(item.id);
    return o && "vendorNo" in o ? (o.vendorNo ?? null) : item.vendorNo;
  };

  /**
   * Write one line's G/L account or vendor immediately.
   *
   * Both fields are always sent, because `setReimburseItemAccounts` rewrites
   * `Category` from the payload unconditionally — sending only `vendorNo` would
   * clear the account. `vendorNo`'s own absent-means-leave-alone rule is for the
   * client that predates migration 147, not for this one.
   */
  async function saveItemField(
    requestId: number,
    item: ReimburseQueueItem,
    patch: { category?: string | null; vendorNo?: string | null },
  ): Promise<void> {
    setOptimistic((prev) => {
      const m = new Map(prev);
      m.set(item.id, { ...(m.get(item.id) ?? {}), ...patch });
      return m;
    });
    setRowErrors((prev) => {
      if (!prev.has(item.id)) return prev;
      const m = new Map(prev);
      m.delete(item.id);
      return m;
    });
    setSavingItems((prev) => new Set(prev).add(item.id));

    const previous = saveChains.current.get(requestId) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        // Read AFTER the queue clears, so a second pick on the same line sends
        // the first one's value too rather than reverting it.
        const body = {
          items: [
            {
              id: item.id,
              category: "category" in patch ? (patch.category ?? null) : categoryOf(item),
              vendorNo: "vendorNo" in patch ? (patch.vendorNo ?? null) : vendorOf(item),
            },
          ],
        };
        let message: string | null = null;
        try {
          const res = await fetch(`/api/request/reimburse/requests/${requestId}/items`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const json = await res.json().catch(() => null);
          if (!json?.ok) {
            message =
              typeof json?.error === "string"
                ? json.error
                : res.status === 409
                  ? "คำขอนี้ถูกดำเนินการไปแล้ว — โหลดใหม่"
                  : "บันทึกไม่สำเร็จ";
          }
        } catch {
          message = "เครือข่ายขัดข้อง — ยังไม่ได้บันทึก";
        }

        if (message) {
          // Revert: drop the optimistic entry so the cell falls back to the
          // stored value, and say so on the row itself.
          setOptimistic((prev) => {
            const m = new Map(prev);
            m.delete(item.id);
            return m;
          });
          setRowErrors((prev) => new Map(prev).set(item.id, message as string));
        }
        setSavingItems((prev) => {
          const s = new Set(prev);
          s.delete(item.id);
          return s;
        });
        // Either way: on success this brings back the saved value and drops the
        // optimistic entry; on failure it re-reads what is actually stored.
        await mutate();
      });

    saveChains.current.set(requestId, next);
    await next;
  }

  /** Readiness per claim, for the checkbox and the reason beside the number. */
  const readinessById = useMemo(() => {
    const m = new Map<number, ReturnType<typeof claimReadiness>>();
    for (const r of rows) {
      m.set(
        r.id,
        claimReadiness({
          items: r.items.map((it) => ({
            id: it.id,
            category: categoryOf(it),
            vendorNo: vendorOf(it),
          })),
          paymentDate: dateFor(r.id),
        }),
      );
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, optimistic, rowDates, effectiveDate]);

  const readyRows = useMemo(
    () => rows.filter((r) => readinessById.get(r.id)?.ready),
    [rows, readinessById],
  );
  const allReadySelected =
    readyRows.length > 0 && readyRows.every((r) => selectedIds.has(r.id));

  /** Select-all covers only the claims that can actually be approved. */
  function toggleAllReady() {
    setSelectedIds(allReadySelected ? new Set() : new Set(readyRows.map((r) => r.id)));
  }

  const displayRows = useMemo(() => expandQueueRows(rows), [rows]);

  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }
  function toggleOne(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * One request per call, exactly as `applyBulkDate` on AP-17's equivalent
   * page does — see the file header for why a bulk endpoint is not built
   * instead. A 409 is never retried: it means another accountant already
   * moved that row, so it is counted separately and the queue is reloaded
   * rather than the click repeated.
   */
  async function approveSelected() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    // Each claim's own date, because each claim is approved with its own. A
    // check on the shared field alone would pass while a row that had been
    // deliberately cleared went out with nothing.
    const missing = ids.filter((id) => !dateFor(id));
    if (missing.length > 0) {
      toast.error(
        missing.length === ids.length
          ? "กรุณาเลือกวันที่จ่าย"
          : `ยังไม่ได้เลือกวันที่จ่าย ${missing.length} รายการ`,
      );
      return;
    }
    setBatchRunning(true);
    let okCount = 0;
    let failCount = 0;
    let conflict = false;
    // The first non-409 error message, kept verbatim and shown beside the
    // count. The likeliest one here is NOT an edge case: this queue shows its
    // full contents to anyone holding the `approvalQueue` menu grant, whether
    // or not they are on `AccReimburseApprover` — see the file header — and
    // that roster was last measured empty. The very first person to try this
    // screen is expected to hit exactly this 403, and "ไม่สำเร็จ N รายการ"
    // with no reason would send them looking for a bug instead of reading the
    // sentence the server already wrote naming the remedy.
    let firstError: string | null = null;
    for (const id of ids) {
      try {
        const res = await fetch(`/api/request/reimburse/requests/${id}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ step: "ACCOUNT", paymentDate: dateFor(id) }),
        });
        const json = await res.json().catch(() => null);
        if (json?.ok) {
          okCount += 1;
        } else if (res.status === 409) {
          // Never counted as a plain failure and never carries a message here
          // — a 409 means the row already moved, and the only honest remedy is
          // the refetch below, not a reason to read.
          conflict = true;
        } else {
          failCount += 1;
          if (firstError === null && typeof json?.error === "string") firstError = json.error;
        }
      } catch {
        failCount += 1;
      }
    }
    setBatchRunning(false);
    setSelectedIds(new Set());
    if (okCount > 0) toast.success(`บันทึกวันที่จ่ายและส่งต่อแล้ว ${okCount} รายการ`);
    if (failCount > 0) {
      toast.error(firstError ? `ไม่สำเร็จ ${failCount} รายการ — ${firstError}` : `ไม่สำเร็จ ${failCount} รายการ`);
    }
    if (conflict) {
      toast.error("มีบางรายการถูกดำเนินการไปแล้วโดยผู้อื่น — โหลดรายการใหม่แล้ว");
    }
    // Always — success removes rows server-side, a conflict means this page's
    // copy is stale, and a plain failure is safest re-checked too. Never leave
    // the view claiming what the database no longer agrees with.
    void mutate();
  }

  const forbidden = error instanceof ApiError && error.status === 403;

  return (
    <>
      {/*
        A NOTICE, not a block. `isReimburseApprover === false` says this viewer
        holds the `approvalQueue` grant (or is an admin) but has no active
        `AccReimburseApprover` row.

        **Since migration 144 (2026-09-10, I1) this ALSO means their own brand
        scope is `null`, so the row filter below now answers them an EMPTY
        queue, not a full one.** The wording changed with it: it used to say
        "you can open this queue" (true when every row was shown regardless of
        roster membership) and left the empty-state placeholder to speak for
        itself with no idea why it was empty. Now this notice is the only
        place that says rows are hidden at all — the generic empty-state text
        below carries on rendering under it, honestly, since it no longer
        claims anything this notice does not already explain.

        Strict `=== false` on purpose: the flag is three-valued, and `null`
        (loading, a failed fetch, or a roster the server itself could not read)
        must render nothing rather than tell somebody they are off a list
        nobody could see.
      */}
      {isReimburseApprover === false && !forbidden && (
        <div
          className="rounded-xl px-3.5 py-3 mb-3 flex items-start gap-2.5"
          style={{
            background: "var(--bg-info-yellow)",
            border: "1px solid var(--border-info-yellow)",
          }}
        >
          <Info size={15} className="shrink-0 mt-0.5" style={{ color: "var(--text-info-yellow)" }} />
          <p className="text-[12.5px] leading-relaxed m-0" style={{ color: "var(--text-info-yellow)" }}>
            คุณเปิดหน้านี้ได้ แต่ยังไม่ได้เป็น
            <strong> ผู้อนุมัติฝ่ายบัญชี</strong> ของ AP-4 — ระบบจึงไม่แสดงรายการใด ๆ ให้
            (การอนุมัติ ส่งกลับ และแก้รหัสบัญชีก็จะถูกปฏิเสธเช่นกัน) ผู้ดูแลระบบเปิดใช้งานคุณและติ๊กแบรนด์ที่คุณอนุมัติได้
            (อย่างน้อย 1 แบรนด์) ได้ที่ ตั้งค่าขอเบิกเงินคืนพนักงาน → สิทธิ์เข้าถึง
          </p>
        </div>
      )}

      {/* No card of its own — the page's shared `rounded-2xl` card (`page.tsx`)
          supplies the border and background; only the conditional bottom
          padding for the sticky action bar stays here, since that is about
          this component's own content, not chrome. */}
      <div className={selectedCount > 0 ? "pb-24" : undefined}>
        {isLoading ? (
          <p className="text-[13px] py-10 text-center" style={{ color: "var(--text-muted)" }}>
            กำลังโหลด...
          </p>
        ) : forbidden ? (
          <div className="py-16 text-center px-4">
            <Lock size={32} style={{ color: "var(--text-faint)", margin: "0 auto 12px" }} />
            <h2 className="text-[16px] font-bold mb-1" style={{ color: "var(--text-heading)" }}>
              ไม่มีสิทธิ์เข้าถึง
            </h2>
            <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
              หน้านี้สำหรับผู้ที่ได้รับสิทธิ์ &quot;คิวอนุมัติ (บัญชี)&quot; ของ AP-4 เท่านั้น —
              ผู้ดูแลระบบเพิ่มสิทธิ์ได้ที่ ตั้งค่าขอเบิกเงินคืนพนักงาน → สิทธิ์เข้าถึง
            </p>
          </div>
        ) : error ? (
          <p className="text-[13px] py-10 text-center" style={{ color: "var(--color-danger)" }}>
            {error instanceof Error ? error.message : "โหลดข้อมูลไม่สำเร็จ"}
          </p>
        ) : (
          <>
            {/* Above the empty state, not inside the populated branch. Both are
                reasons the list can be short, so hiding them when it is empty
                takes away the two controls that explain why: an approver on a
                tab that happens to be empty, or with a filter still set from
                earlier, would read "ไม่มีรายการ" as the whole queue. */}
            <ErpInterfaceBrandTabs
              activeCode={interfaceTarget}
              onChange={(code) => {
                setInterfaceTarget(code);
                // The rows underneath just changed; carrying ticks across would
                // approve claims the approver can no longer see.
                setSelectedIds(new Set());
              }}
              counts={ifaceCounts}
              // Only the groups this approver actually covers. `scope` is their
              // ticked AccReimburseApproverBrand set; `null` means no active
              // roster row at all, and passing null through shows every tab,
              // which is the pre-scope behaviour and correct for an admin
              // looking at a queue they cannot act on. A tab for a group whose
              // claims are all filtered out by the row-level scope could only
              // ever read 0 and invite a click that shows nothing.
              visibleCodes={scope && scope.length > 0 ? scope : null}
              showUnassigned={false}
              className="mb-4"
            />

            <ReimburseQueueFilterBar
              filters={filters}
              onChange={(next) => {
                setFilters(next);
                setSelectedIds(new Set());
              }}
              departmentOptions={departmentOptions}
              brandOptions={brandOptions}
            />

            {rows.length === 0 ? (
          // I1 (2026-09-10): three genuinely different situations used to
          // render this identical sentence, which is false in at least the
          // second of them. `scope` names which brands this viewer covers
          // when they are a real approver, rather than claiming nothing at
          // all is pending anywhere; `unmappedBrandCount` — independent of
          // WHO is asking, see countUnmappedBrandRows's own docblock — names
          // the fix when the reason is a claim nobody's scope can ever cover.
          //
          // A FOURTH case was missing here (found in the final review): a real
          // roster row with zero ticks. `scope === []` is neither `null` (the
          // yellow notice above already explains that one) nor a non-empty
          // array, so it fell into the same generic "nothing pending" sentence
          // as an honestly empty queue — with `isReimburseApprover` true, no
          // notice fires either, so an admin who added someone and forgot to
          // tick a brand saw a page that looked correctly empty instead of one
          // saying why nothing showed.
          <div className="py-16 text-center px-4">
            <Inbox size={32} style={{ color: "var(--text-faint)", margin: "0 auto 12px" }} />
            <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
              {scope !== null && scope.length === 0
                ? "คุณเป็นผู้อนุมัติฝ่ายบัญชีแล้ว แต่ยังไม่ได้ติ๊กแบรนด์ใดเลย จึงไม่แสดงรายการให้ — ผู้ดูแลระบบเปิดใช้งานคุณและติ๊กแบรนด์ที่คุณอนุมัติได้ (อย่างน้อย 1 แบรนด์) ได้ที่ ตั้งค่าขอเบิกเงินคืนพนักงาน → สิทธิ์เข้าถึง"
                : scope && scope.length > 0
                  ? `ไม่มีรายการในกลุ่มที่คุณดูแล (${scope.join(", ")})`
                  : "ไม่มีรายการรอบัญชีอนุมัติ"}
            </p>
            {unmappedBrandCount > 0 && (
              <p
                className="text-[12px] mt-2 leading-relaxed max-w-[420px] mx-auto"
                style={{ color: "var(--text-faint)" }}
              >
                มี {unmappedBrandCount} รายการที่แบรนด์ยังไม่ได้ผูกกับกลุ่ม Interface ERP จึงไม่แสดงให้ใครเห็น
                — ผู้ดูแลระบบผูกแบรนด์ได้ที่ ตั้งค่าขอเบิกเงินคืนพนักงาน → Interface ERP
              </p>
            )}
              </div>
            ) : (
              <>
                {/* ONE row per expense line, with the claim's own columns
                    rowSpan-ed across its lines. The per-claim expander is gone:
                    choosing a G/L account and a vendor is the work this screen
                    exists for, and a control that has to be opened one claim at
                    a time cannot be compared across claims.

                    Twenty-three columns scroll inside this container rather than
                    widening the page. */}
                <div className="overflow-x-auto">
                  <table className="border-collapse" style={{ minWidth: 2600 }}>
                    <thead>
                      <tr
                        style={{
                          borderBottom: "1px solid var(--border-light)",
                          background: "var(--bg-card-alt)",
                        }}
                      >
                        <th className="px-3 py-3 w-9">
                          <QueueCheckbox
                            checked={allReadySelected}
                            onChange={toggleAllReady}
                            ariaLabel={`เลือกทุกใบที่ข้อมูลครบ (${readyRows.length} รายการ)`}
                            disabled={readyRows.length === 0}
                          />
                        </th>
                        {FLAT_COLUMNS.map((c) => (
                          <th
                            key={c.label}
                            className={`text-[11px] font-semibold uppercase tracking-wide py-3 px-2 whitespace-nowrap ${
                              c.right ? "text-right" : "text-left"
                            }`}
                            style={{
                              color: "var(--text-muted)",
                              width: c.width,
                              // The claim-level columns are shaded so the eye
                              // can tell "this belongs to the whole request"
                              // from "this belongs to the line".
                              background: c.claimLevel ? "var(--nav-active-bg)" : undefined,
                            }}
                          >
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {displayRows.map((d) => {
                        const item = d.item;
                        const claimCells = d.groupIndex === 0;
                        const span = d.groupSize;
                        const ready = readinessById.get(d.claim.id);
                        const isSelected = selectedIds.has(d.claim.id);
                        const err = item ? rowErrors.get(item.id) : undefined;
                        // Derived, never stored — see `ReimburseItem.amount`.
                        const beforeVat = item ? (item.amount || 0) - (item.vatAmount || 0) : 0;
                        const netPaid = item ? (item.amount || 0) - (item.whtAmount || 0) : 0;
                        return (
                          <tr
                            key={d.key}
                            style={{
                              // Only under the LAST line of a claim, so the
                              // group reads as one block rather than as N.
                              borderBottom:
                                d.groupIndex === span - 1 ? "1px solid var(--border-card)" : undefined,
                              background: isSelected ? "var(--nav-active-bg)" : undefined,
                            }}
                          >
                            {claimCells && (
                              <td rowSpan={span} className="px-3 py-3 align-top">
                                <QueueCheckbox
                                  checked={isSelected}
                                  onChange={() => toggleOne(d.claim.id)}
                                  disabled={!ready?.ready}
                                  ariaLabel={`เลือก ${d.claim.requestNo}`}
                                  title={ready?.reason ?? undefined}
                                />
                              </td>
                            )}

                            {claimCells && (
                              <>
                                <td rowSpan={span} className="py-3 px-2 align-top whitespace-nowrap">
                                  {/* Opens the claim. An approver deciding a
                                      vendor sometimes needs the receipt itself,
                                      and the number is where they look for it. */}
                                  <button
                                    type="button"
                                    onClick={() => setDrawerId(d.claim.id)}
                                    className="text-[13px] font-bold cursor-pointer border-none bg-transparent p-0 text-left hover:underline"
                                    style={{ color: "var(--nav-active-text)" }}
                                    title={`เปิดเอกสาร ${d.claim.requestNo}`}
                                  >
                                    {d.claim.requestNo || "-"}
                                  </button>
                                  {ready && !ready.ready && (
                                    <span
                                      className="block text-[10.5px] mt-0.5 leading-tight"
                                      style={{ color: "var(--text-warning)" }}
                                    >
                                      {ready.reason}
                                    </span>
                                  )}
                                </td>
                                <td
                                  rowSpan={span}
                                  className="text-[12px] py-3 px-2 align-top whitespace-nowrap"
                                  style={{ color: "var(--text-secondary)" }}
                                >
                                  {fmtDateTime(d.claim.submittedAt)}
                                </td>
                                <td
                                  rowSpan={span}
                                  className="text-[12px] py-3 px-2 align-top whitespace-nowrap"
                                  style={{ color: "var(--text-secondary)" }}
                                >
                                  {fmtDateTime(d.claim.managerApprovedAt)}
                                </td>
                                <td
                                  rowSpan={span}
                                  className="text-[12.5px] py-3 px-2 align-top"
                                  style={{ color: "var(--text-primary)" }}
                                >
                                  {d.claim.requesterName || "-"}
                                  <span
                                    className="block text-[10.5px] mt-0.5"
                                    style={{ color: "var(--text-faint)" }}
                                  >
                                    {d.claim.requesterDepartmentName || "—"}
                                  </span>
                                </td>
                                <td rowSpan={span} className="py-3 px-2 align-top whitespace-nowrap">
                                  {d.claim.requesterDepartmentCode ? (
                                    <span
                                      className="px-1.5 py-0.5 rounded text-[10.5px] font-bold"
                                      style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
                                    >
                                      {d.claim.requesterDepartmentCode}
                                    </span>
                                  ) : (
                                    <span className="text-[12px]" style={{ color: "var(--text-faint)" }}>
                                      —
                                    </span>
                                  )}
                                </td>
                                <td rowSpan={span} className="py-3 px-2 align-top whitespace-nowrap">
                                  {d.claim.brandCode && (
                                    <span
                                      className="px-1.5 py-0.5 rounded text-[10.5px] font-bold"
                                      style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
                                    >
                                      {d.claim.brandCode}
                                    </span>
                                  )}
                                </td>
                              </>
                            )}

                            {item ? (
                              <>
                                <td className="text-[12px] py-2 px-2 tabular-nums" style={{ color: "var(--text-muted)" }}>
                                  {d.groupIndex + 1}
                                </td>
                                <td className="text-[12px] py-2 px-2 whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                                  {fmtYmd(item.expenseDate)}
                                </td>
                                <td className="text-[12px] py-2 px-2 whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                                  {item.documentNo || "—"}
                                </td>
                                <td className="text-[12px] py-2 px-2 break-words" style={{ color: "var(--text-primary)" }}>
                                  {item.description || "—"}
                                </td>
                                <td className="text-[12px] py-2 px-2 break-words" style={{ color: "var(--text-secondary)" }}>
                                  {item.branchName || "—"}
                                </td>
                                <td className="text-[12px] py-2 px-2 whitespace-nowrap tabular-nums" style={{ color: "var(--text-secondary)" }}>
                                  {item.vendorTaxId || "—"}
                                </td>
                                <td className="text-[12px] py-2 px-2 break-words" style={{ color: "var(--text-primary)" }}>
                                  {item.vendorName || "—"}
                                </td>
                                <td className="text-[12px] py-2 px-2 text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>
                                  {fmtBaht(beforeVat)}
                                </td>
                                <td className="text-[12px] py-2 px-2 text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>
                                  {item.vatAmount ? fmtBaht(item.vatAmount) : "—"}
                                </td>
                                <td className="text-[12.5px] py-2 px-2 text-right tabular-nums font-semibold" style={{ color: "var(--text-primary)" }}>
                                  {fmtBaht(item.amount)}
                                </td>
                                <td className="text-[12px] py-2 px-2 text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>
                                  {item.whtAmount ? fmtBaht(item.whtAmount) : "—"}
                                </td>
                                <td className="text-[12.5px] py-2 px-2 text-right tabular-nums font-semibold" style={{ color: "var(--text-primary)" }}>
                                  {fmtBaht(netPaid)}
                                </td>
                                <LineAccountCells
                                  brandCode={d.claim.brandCode}
                                  requestId={d.claim.id}
                                  item={item}
                                  category={categoryOf(item)}
                                  vendorNo={vendorOf(item)}
                                  busy={savingItems.has(item.id)}
                                  error={err}
                                  onChange={(patch) => void saveItemField(d.claim.id, item, patch)}
                                />
                              </>
                            ) : (
                              // A claim with no lines. It cannot be approved
                              // (`claimReadiness` refuses it), and saying so in
                              // the row beats fourteen empty cells.
                              <td
                                colSpan={14}
                                className="text-[12px] py-3 px-2"
                                style={{ color: "var(--text-faint)" }}
                              >
                                — ไม่มีรายการค่าใช้จ่ายในคำขอนี้ —
                              </td>
                            )}

                            {claimCells && (
                              <>
                                <td rowSpan={span} className="py-3 px-2 align-top">
                                  {/* Per claim, not per line: PaymentDate is a
                                      column on AccRequest. Kept in the screen
                                      until approve, because AP-4 has no
                                      endpoint that sets it on its own — the
                                      approve route is the only writer. */}
                                  <div className="flex items-center gap-1.5">
                                    {/* A calendar, not a native date field: the
                                        rounds are a fortnight apart and seeing
                                        that the 25th is the 4th Friday is most
                                        of what makes a date the right one. */}
                                    <button
                                      type="button"
                                      disabled={batchRunning}
                                      onClick={() => setEditingPaymentId(d.claim.id)}
                                      aria-label={`เลือกวันที่จ่ายของ ${d.claim.requestNo}`}
                                      className="inline-flex items-center gap-1.5 text-[12px] rounded-lg px-2 py-1 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                                      style={{
                                        background: "var(--bg-input)",
                                        color: dateFor(d.claim.id) ? "var(--text-primary)" : "var(--text-muted)",
                                        border: "1px solid var(--border-input)",
                                      }}
                                    >
                                      <CalendarDays size={12} />
                                      {dateFor(d.claim.id) ? fmtYmd(dateFor(d.claim.id)) : "เลือกวันที่"}
                                    </button>
                                    {rowDates.has(d.claim.id) &&
                                      rowDates.get(d.claim.id) !== effectiveDate && (
                                        <button
                                          type="button"
                                          title="ใช้วันที่ร่วม"
                                          aria-label={`ใช้วันที่ร่วมกับ ${d.claim.requestNo}`}
                                          onClick={() =>
                                            setRowDates((prev) => {
                                              const m = new Map(prev);
                                              m.delete(d.claim.id);
                                              return m;
                                            })
                                          }
                                          className="shrink-0 cursor-pointer border-none bg-transparent p-0"
                                          style={{ color: "var(--text-muted)" }}
                                        >
                                          <RotateCcw size={12} />
                                        </button>
                                      )}
                                  </div>
                                </td>

                              </>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {selectedCount > 0 && (
        <div
          className="fixed bottom-0 left-0 right-0 px-4 py-3 flex items-center gap-x-4 gap-y-2 flex-wrap"
          style={{ background: "var(--bg-card)", borderTop: "1px solid var(--border-card)", boxShadow: "var(--shadow-card)", zIndex: 30 }}
        >
          <span className="text-[13px] font-medium shrink-0" style={{ color: "var(--text-heading)" }}>
            เลือก {selectedCount} รายการ
          </span>

          <div className="flex items-center gap-2 flex-wrap min-w-0">
            {/* Retitled: it no longer IS the date, it is the date a claim
                takes when it has none of its own. */}
            <label className="text-[12px] font-medium shrink-0" style={{ color: "var(--text-muted)" }}>
              วันที่จ่าย (ใช้ร่วม)
            </label>
            <input
              type="date"
              value={effectiveDate}
              disabled={batchRunning}
              onChange={(e) => {
                setDateTouched(true);
                setBulkDate(e.target.value);
              }}
              className="text-[12.5px] rounded-lg px-2.5 py-1.5 outline-none disabled:opacity-50"
              style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
            />
            {data?.suggested && (
              <span className="text-[11.5px] inline-flex items-center gap-1" style={{ color: "var(--text-muted)" }}>
                <Clock size={12} /> รอบที่แนะนำ {fmtYmd(data.suggested)} — แก้ไขได้
              </span>
            )}
          </div>

          <div className="shrink-0" style={{ width: 1, height: 28, background: "var(--border-card)" }} />

          <button
            type="button"
            onClick={() => void approveSelected()}
            disabled={batchRunning || !effectiveDate}
            className="inline-flex items-center gap-2 text-[13px] font-semibold px-4 py-2 rounded-lg cursor-pointer shrink-0 disabled:cursor-not-allowed disabled:opacity-55"
            style={{ background: "var(--color-action)", color: "#fff", border: "none" }}
          >
            {batchRunning ? <Loader2 size={14} className="animate-spin" /> : <ThumbsUp size={14} />}
            อนุมัติที่เลือก ({selectedCount})
          </button>
        </div>
      )}

      {/* One claim at a time. `mode="suggest"` is load-bearing: AP-4's server
          accepts any date inside a bound rather than a round, so a calendar
          that refused everything else would refuse dates the server takes —
          which is exactly the split that took AP-4's DETAIL page off this
          component. The rounds are still tinted, because they are the answer
          nearly every claim wants. */}
      <Dialog
        open={editingPaymentId != null}
        onOpenChange={(open) => {
          if (!open) setEditingPaymentId(null);
        }}
        title={`วันที่จ่าย · ${rows.find((r) => r.id === editingPaymentId)?.requestNo ?? ""}`}
      >
        {(() => {
          const claim = rows.find((r) => r.id === editingPaymentId);
          if (!claim) return null;
          return (
            <>
              {claim.managerApprovedAt && (
                <p className="text-[11px] mb-2 px-1 leading-relaxed" style={{ color: "var(--text-muted)" }}>
                  ผจก. อนุมัติ {fmtDateTime(claim.managerApprovedAt)}
                  {data?.suggested ? (
                    <>
                      {" — "}
                      <strong>รอบที่แนะนำ {fmtYmd(data.suggested)}</strong>
                    </>
                  ) : (
                    ""
                  )}
                  <br />
                  แต่ละรอบปิดรับเที่ยงวันจันทร์ของสัปดาห์นั้น · เลือกวันอื่นได้ตามจริง
                </p>
              )}
              <PaymentDatePicker
                dates={data?.paymentOptions ?? []}
                value={dateFor(claim.id)}
                mode="suggest"
                hint="วันจ่าย: ศุกร์ที่ 1 และ 3 ของเดือน (เลื่อนกลับ 1 วันถ้าตรงวันหยุด) — เลือกวันอื่นได้"
                onChange={(ymd) => {
                  setRowDates((prev) => {
                    const m = new Map(prev);
                    m.set(claim.id, ymd);
                    return m;
                  });
                  setEditingPaymentId(null);
                }}
              />
            </>
          );
        })()}
      </Dialog>

      {/* Same drawer /my-request opens, so a claim reads the same in both. */}
      <SidePanel open={drawerId != null} onClose={() => setDrawerId(null)} width="min(980px, 100vw)" zIndex={60}>
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
          {drawerLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin" style={{ color: "var(--text-muted)" }} />
            </div>
          ) : drawerDetail ? (
            <ReimburseDetail
              request={drawerDetail}
              onChanged={() => {
                // The claim may have left this queue -- returned, or approved
                // from inside the panel. Refetch both rather than trusting the
                // list still describes it.
                void mutate();
                setDrawerId(null);
              }}
            />
          ) : (
            <p className="text-[13px] py-10 text-center m-0" style={{ color: "var(--color-danger)" }}>
              โหลดรายละเอียดไม่สำเร็จ
            </p>
          )}
        </div>
      </SidePanel>
    </>
  );
}
