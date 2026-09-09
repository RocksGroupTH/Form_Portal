"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  Clock,
  Inbox,
  Info,
  ListChecks,
  Loader2,
  Lock,
  RotateCcw,
  ThumbsUp,
} from "lucide-react";
import { fmtBaht } from "@/features/travel-booking/components/shared";
import { ExpenseAccountPicker } from "@/features/reimburse/components/ExpenseAccountPicker";
// Type-only, and deliberately from the pure module rather than `./queue-service`
// — that file imports `getAccPool`, which reaches `@/lib/db/mssql` and `@/env`
// at module scope. A type-only import is erased at build time regardless of
// where it is written, but pointing at the import-free home keeps that true by
// construction rather than by relying on erasure to save a mistake later.
import type { ReimburseQueueRow } from "@/lib/acc/reimburse/queue-policy";
// Both type-only for the same reason: `.../types` is import-free, but
// `expense-account-service.ts` is not — it opens `getErpDataPool()` at module
// scope. Only the shape is needed here; `ExpenseAccountPicker` above already
// proves that pattern is safe (it does the same import).
import type { ReimburseDetail as ReimburseDetailData, ReimburseItem } from "@/features/reimburse/types";
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

/** The full claim — reused from the by-id detail route, not a new endpoint. `ReimburseQueueRow` carries no line items on purpose (the queue list query only needs a count), so expanding a row asks for exactly what the detail page already asks for. */
async function detailFetcher(url: string): Promise<ReimburseDetailData> {
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  if (!json?.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : "โหลดรายการไม่สำเร็จ");
  }
  return json.data as ReimburseDetailData;
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
}: {
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
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
 * One row's expense lines, expanded in place, each with the G/L account
 * picker on it — surfacing machinery that already existed and was unreachable
 * from any screen: the document reader already proposes an account per line
 * (`receipt-item/route.ts`), and the picker component already renders one
 * (`ExpenseAccountPicker.tsx`, historically unused — see its own header for
 * why a value that is not in the list must still show the raw text rather
 * than blank). This component is the first place either is reachable from a
 * screen.
 *
 * **What the save route does NOT do is check the account against Business
 * Central.** `setReimburseItemAccounts` writes the trimmed string; the only
 * gate is `parseItemAccountEdits`' `CATEGORY_MAX_LEN` bound
 * (`item-account-edits.ts`), which is the `NVARCHAR(50)` column width and
 * nothing more. Neither this route nor `persistReimburseItems` compares
 * `AccReimburseItem.Category` to `ErpAccounts`. That check belongs to the
 * stage that posts (spec §5.2), where a bad account is a rejected journal
 * rather than a typo in a column — and it has to land on BOTH write paths,
 * not just this one. **This paragraph replaces a sentence that claimed the
 * validation already existed**; it did not, and a reader in stage 3 would
 * have concluded the work was done.
 *
 * Edits are local until "บันทึก" — nothing here autosaves a line while an
 * accountant is still choosing between two close matches, and only the lines
 * actually changed are sent, so a save cannot accidentally re-stamp every
 * other row's untouched value.
 */
function ExpenseAccountsPanel({
  requestId,
  brandCode,
}: {
  requestId: number;
  brandCode: string;
}) {
  const { data, error, isLoading, mutate } = useSWR(
    `/api/request/reimburse/requests/${requestId}`,
    detailFetcher,
  );
  const { data: accounts, isLoading: accountsLoading } = useSWR(
    brandCode
      ? `/api/request/reimburse/options/expense-accounts?brand=${encodeURIComponent(brandCode)}`
      : null,
    accountsFetcher,
  );

  // Item id -> the value picked in this panel, overriding the loaded row.
  // Starts empty — a picker with no entry here falls through to `it.category`
  // below, so there is nothing to seed. It is never reset by an SWR
  // revalidation either (the list revalidates on window focus, and clobbering
  // it on every one of those would silently discard whatever the accountant
  // was mid-choosing); the only reset is unmounting, which collapsing the row
  // does, so re-expanding always starts from what is actually saved.
  const [edits, setEdits] = useState<Map<number, string | null>>(new Map());
  const [saving, setSaving] = useState(false);

  // Rows with no persisted id cannot be a save target — every row this route
  // ever reads back from `getReimburseRequest` has one, but the type is
  // optional (a not-yet-saved draft row can lack it), so this is a type guard
  // rather than a filter expected to remove anything in practice.
  const items = (data?.items ?? []).filter(
    (it): it is ReimburseItem & { id: number } => it.id != null,
  );

  const dirty = Array.from(edits.entries()).filter(([id, value]) => {
    const original = items.find((it) => it.id === id)?.category ?? null;
    return value !== original;
  });

  async function save() {
    if (dirty.length === 0 || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/request/reimburse/requests/${requestId}/items`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: dirty.map(([id, category]) => ({ id, category })),
        }),
      });
      const json = await res.json().catch(() => null);
      if (json?.ok) {
        toast.success("บันทึกบัญชีแล้ว");
        setEdits(new Map());
      } else {
        // A 409 here means the claim moved out of accounting's hands between
        // load and save (approved, returned, or edited by someone else) —
        // refetch so the panel stops offering a save that can only fail again,
        // exactly the reasoning `approveSelected` above already applies.
        toast.error(json?.error ?? "บันทึกไม่สำเร็จ");
      }
    } catch {
      toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
    } finally {
      setSaving(false);
      void mutate();
    }
  }

  if (isLoading) {
    return (
      <p className="text-[12px] py-3 text-center m-0" style={{ color: "var(--text-muted)" }}>
        กำลังโหลดรายการ...
      </p>
    );
  }
  if (error || !data) {
    return (
      <p className="text-[12px] py-3 text-center m-0" style={{ color: "var(--color-danger)" }}>
        {error instanceof Error ? error.message : "โหลดรายการไม่สำเร็จ"}
      </p>
    );
  }

  return (
    <div
      className="flex flex-col gap-2.5 mt-2 rounded-xl p-3"
      style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-light)" }}
    >
      {items.length === 0 ? (
        <p className="text-[12px] m-0" style={{ color: "var(--text-faint)" }}>
          — ไม่มีรายการ —
        </p>
      ) : (
        items.map((it) => (
          <div key={it.id} className="flex items-center gap-2.5">
            <div className="flex-1 min-w-0">
              <p
                className="text-[12.5px] m-0 truncate"
                style={{ color: "var(--text-primary)" }}
                title={it.description || undefined}
              >
                {it.description || "—"}
              </p>
              <p className="text-[11px] m-0 tabular-nums" style={{ color: "var(--text-muted)" }}>
                ฿{fmtBaht(it.amount)}
              </p>
            </div>
            <div className="w-[210px] shrink-0">
              <ExpenseAccountPicker
                value={edits.has(it.id) ? (edits.get(it.id) ?? null) : (it.category ?? null)}
                onChange={(next) => {
                  setEdits((prev) => {
                    const m = new Map(prev);
                    m.set(it.id, next);
                    return m;
                  });
                }}
                accounts={accounts ?? []}
                loading={accountsLoading}
                brandChosen={!!brandCode}
                ariaLabel={`เลือกบัญชีสำหรับ ${it.description || "รายการ"}`}
              />
            </div>
          </div>
        ))
      )}
      {items.length > 0 && (
        <div className="flex justify-end pt-0.5">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || dirty.length === 0}
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg cursor-pointer disabled:cursor-not-allowed disabled:opacity-55"
            style={{ background: "var(--color-action)", color: "#fff", border: "none" }}
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            บันทึกบัญชี{dirty.length > 0 ? ` (${dirty.length})` : ""}
          </button>
        </div>
      )}
    </div>
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
  const [returnRowId, setReturnRowId] = useState<number | null>(null);
  const [returnComment, setReturnComment] = useState("");
  const [returnBusy, setReturnBusy] = useState(false);
  // Which rows show their expense lines. A `Set` rather than one id: nothing
  // stops an accountant comparing two claims' line items side by side.
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());

  const rows = data?.rows ?? [];

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
  function toggleExpanded(id: number) {
    setExpandedIds((prev) => {
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
    if (!effectiveDate) {
      toast.error("กรุณาเลือกวันที่จ่าย");
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
          body: JSON.stringify({ step: "ACCOUNT", paymentDate: effectiveDate }),
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

  function openReturn(id: number) {
    setReturnRowId(id);
    setReturnComment("");
  }
  function closeReturn() {
    setReturnRowId(null);
    setReturnComment("");
  }

  /** `returnCommentOrError` on the server refuses a blank comment too; this is the courtesy, not the control. */
  async function submitReturn(id: number) {
    const comment = returnComment.trim();
    if (!comment) {
      toast.error("กรุณาระบุสิ่งที่ต้องแก้ไข");
      return;
    }
    setReturnBusy(true);
    try {
      const res = await fetch(`/api/request/reimburse/requests/${id}/return`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "ACCOUNT", comment }),
      });
      const json = await res.json().catch(() => null);
      if (json?.ok) {
        toast.success("ส่งกลับให้ผู้ขอแก้ไขแล้ว");
      } else if (res.status === 409) {
        toast.error("รายการนี้มีการเปลี่ยนแปลงจากผู้อื่นแล้ว — โหลดรายการใหม่แล้ว");
      } else {
        toast.error(json?.error ?? "ส่งกลับไม่สำเร็จ");
      }
    } catch {
      toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
    } finally {
      setReturnBusy(false);
      closeReturn();
      // Same rule as the approve loop: success, conflict or plain failure all
      // refetch. A row this action failed to move is exactly the row whose
      // on-screen state is most likely stale.
      void mutate();
    }
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
        ) : rows.length === 0 ? (
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
            <div
              className="flex items-center gap-3 px-5 py-3"
              style={{ borderBottom: "1px solid var(--border-light)", background: "var(--bg-card-alt)" }}
            >
              <QueueCheckbox checked={allSelected} onChange={toggleAll} ariaLabel="เลือกทั้งหมด" />
              <span className="text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
                เลือกทั้งหมด ({rows.length} รายการ)
              </span>
            </div>

            <div className="flex flex-col">
              {rows.map((item) => {
                const isSelected = selectedIds.has(item.id);
                const isReturning = returnRowId === item.id;
                return (
                  <div
                    key={item.id}
                    className="flex items-start gap-3 px-5 py-4"
                    style={{ borderBottom: "1px solid var(--border-light)" }}
                  >
                    <div className="pt-1">
                      <QueueCheckbox
                        checked={isSelected}
                        onChange={() => toggleOne(item.id)}
                        ariaLabel={`เลือก ${item.requestNo}`}
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>
                          {item.requestNo || "-"}
                        </span>
                        {item.brandCode && (
                          <span
                            className="px-1.5 py-0.5 rounded text-[10.5px] font-bold"
                            style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
                          >
                            {item.brandCode}
                          </span>
                        )}
                        <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
                          {item.requesterName || "-"}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap text-[11.5px] mb-2" style={{ color: "var(--text-muted)" }}>
                        <span>ส่งเมื่อ {fmtDateTime(item.submittedAt)}</span>
                        <span>· {item.itemCount} รายการ</span>
                        <span>· {fmtBaht(item.totalAmount)} บาท</span>
                        {item.paymentDate && <span>· กำหนดจ่าย {fmtYmd(item.paymentDate)}</span>}
                      </div>

                      {/* Expand the claim's expense lines and their G/L accounts in place
                          — see `ExpenseAccountsPanel`'s own header for why this reuses the
                          by-id detail read rather than a new list endpoint. */}
                      <button
                        type="button"
                        onClick={() => toggleExpanded(item.id)}
                        className="inline-flex items-center gap-1 text-[11.5px] font-medium mb-2 cursor-pointer border-none bg-transparent p-0"
                        style={{ color: "var(--nav-active-text)" }}
                      >
                        <ListChecks size={12} />
                        {expandedIds.has(item.id) ? "ซ่อนรายการค่าใช้จ่าย" : "ดูรายการ / เลือกบัญชี"}
                        <ChevronDown
                          size={12}
                          style={{
                            transform: expandedIds.has(item.id) ? "rotate(180deg)" : undefined,
                            transition: "transform 0.15s",
                          }}
                        />
                      </button>
                      {expandedIds.has(item.id) && (
                        <ExpenseAccountsPanel requestId={item.id} brandCode={item.brandCode} />
                      )}

                      {isReturning ? (
                        <div className="flex flex-col gap-2 mt-1">
                          <textarea
                            value={returnComment}
                            onChange={(e) => setReturnComment(e.target.value)}
                            rows={2}
                            placeholder="ระบุสิ่งที่ต้องแก้ไข"
                            autoFocus
                            className="w-full text-[13px] px-3 py-2 rounded-lg resize-y"
                            style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-card)" }}
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={returnBusy || returnComment.trim() === ""}
                              onClick={() => void submitReturn(item.id)}
                              className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-lg cursor-pointer disabled:cursor-not-allowed disabled:opacity-55"
                              style={{ background: "var(--color-action)", color: "#fff", border: "none" }}
                            >
                              {returnBusy ? <Loader2 size={13} className="animate-spin" /> : null}
                              ยืนยันส่งกลับ
                            </button>
                            <button
                              type="button"
                              disabled={returnBusy}
                              onClick={closeReturn}
                              className="text-[12.5px] font-medium px-3 py-1.5 rounded-lg cursor-pointer"
                              style={{ background: "var(--bg-card-alt)", color: "var(--text-secondary)", border: "1px solid var(--border-card)" }}
                            >
                              ยกเลิก
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openReturn(item.id)}
                          className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-lg cursor-pointer"
                          style={{
                            background: "var(--bg-info-yellow)",
                            color: "var(--text-info-yellow)",
                            border: "1px solid var(--border-info-yellow)",
                          }}
                        >
                          <RotateCcw size={13} /> ส่งกลับแก้ไข
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
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
            <label className="text-[12px] font-medium shrink-0" style={{ color: "var(--text-muted)" }}>
              วันที่จ่าย
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
    </>
  );
}
