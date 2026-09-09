"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import {
  AlertTriangle,
  Check,
  Loader2,
  Plus,
  ShieldCheck,
  UserCheck,
  UserX,
} from "lucide-react";
import { toast } from "sonner";
import { ADSearchModal, type ADResult } from "@/components/settings/ADSearchModal";
import { GRANTABLE_REIMBURSE_TABS, REIMBURSE_MENUS } from "@/lib/acc/reimburse/settings-tabs";
import { ERP_INTERFACE_BRANDS } from "@/lib/acc/erp-interface-brands";

const ENDPOINT = "/api/request/reimburse/settings/access";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface ReimburseAccessRow {
  /**
   * `AccReimburseAccess.Id` — `null` for a row that exists ONLY as an
   * `AccReimburseApprover` orphan (see `hasAccessRow` below and the GET
   * route's own docblock). `staffId`, never this field, is what identifies a
   * row on screen: it is the one column every write on this grid resolves by,
   * and the one value guaranteed non-null on every row.
   */
  id: number | null;
  staffId: number;
  email: string;
  displayName: string;
  /** `AccReimburseAccess.IsActive` — settings-tab/menu sight. `false` and
   *  meaningless for an orphan row (`hasAccessRow === false`), which has no
   *  such row to be active or not; read `approverActive` instead for those. */
  isActive: boolean;
  settingsTabs: string[];
  /**
   * The ticked `AccReimburseApproverBrand` codes for this person's
   * `AccReimburseApprover` row — `[]` when they have never ticked one (which
   * includes never having a row at all; see the GET route's own docblock for
   * how the join is made). The tick set is what an admin edits; it is not
   * always the same thing as `approverActive` below — see that field.
   */
  brandTargets: string[];
  /**
   * The REAL `AccReimburseApprover.IsActive` flag, as read from the
   * database — not derived from `brandTargets.length > 0` here. Every row
   * this screen itself writes keeps the two in step (`setReimburseApproverBrands`
   * derives `IsActive` from the tick count), but a row created before that
   * function existed can still disagree, and `findActiveApprover` — the
   * predicate that actually decides who may act today — reads this flag
   * alone. The two commissioning banners below count THIS, not the ticks.
   */
  approverActive: boolean;
  /**
   * Whether an `AccReimburseAccess` row exists for this StaffId at all.
   * `false` marks an "orphan" — an active `AccReimburseApprover` row with no
   * matching settings-access row, unioned into the list by the GET route so
   * this screen never hides a real approval grant (review round 1, IMPORTANT
   * #1). An orphan has no สิทธิ์เข้าถึง to switch on/off, so the สถานะ column
   * reads off `approverActive` instead of `isActive` for these — see
   * `displayActiveFor` below.
   */
  hasAccessRow: boolean;
}

/**
 * What the สถานะ badge and button should treat as "on", for either shape of
 * row. A matched row (`hasAccessRow`) is about สิทธิ์เข้าถึง, so it reads
 * `isActive`; an orphan has no such row, so it reads the approver row's own
 * `approverActive` instead — never a hardcoded `false`, which would show an
 * active approver as permanently "ปิด" with no way to tell.
 */
function displayActiveFor(row: ReimburseAccessRow): boolean {
  return row.hasAccessRow ? row.isActive : row.approverActive;
}

/**
 * The confirm-dialog body for turning a row off. The PATCH behind this
 * button (`setReimburseAccessAndApprovalActive`) now stops BOTH grants a row
 * can carry, so the copy has to say what actually happens rather than the
 * fixed "จะเข้าหน้าตั้งค่า AP-4 ไม่ได้อีก" it used to always show — review
 * round 1, IMPORTANT #2: an admin offboarding a leaver read that as the whole
 * story while the person's approval authority and brand ticks stayed live.
 *
 * Three shapes, chosen by what this row actually holds:
 * - an orphan (no AccReimburseAccess row) has only approval to lose;
 * - a matched row that is currently an active approver loses both;
 * - a matched row with no approval authority loses only สิทธิ์เข้าถึง — saying
 *   "and stop approving" to somebody who cannot approve anything today would
 *   be confusing, not merely redundant.
 * Every branch also says the ticks survive and reactivating restores them —
 * `setReimburseAccessAndApprovalActive` never deletes a brand row, only the
 * derived `IsActive` flag, which is exactly why the ticks stay visible on a
 * "ปิด" row (see that function's own docblock for the mechanism).
 */
function buildDeactivateMessage(row: ReimburseAccessRow): string {
  const who = `${row.displayName} (${row.email})`;
  if (!row.hasAccessRow) {
    return `ปิดสิทธิ์อนุมัติของ ${who}? จะอนุมัติจ่ายเงินไม่ได้อีก (แบรนด์ที่ติ๊กไว้ยังอยู่ครบ ถ้าเปิดกลับจะได้สิทธิ์เท่าเดิม ตราบใดที่ยังติ๊กแบรนด์อยู่)`;
  }
  if (row.approverActive) {
    return `ปิดสิทธิ์เข้าถึงของ ${who}? จะเข้าหน้าตั้งค่า AP-4 ไม่ได้ และจะหยุดเป็นผู้อนุมัติฝ่ายบัญชีทันทีด้วย (แท็บและแบรนด์ที่ติ๊กไว้ยังอยู่ครบ ถ้าเปิดกลับจะได้สิทธิ์เท่าเดิม ตราบใดที่ยังติ๊กแบรนด์อยู่)`;
  }
  return `ปิดสิทธิ์เข้าถึงของ ${who}? จะเข้าหน้าตั้งค่า AP-4 ไม่ได้อีก (แท็บที่ติ๊กไว้ยังอยู่ ถ้าเปิดกลับจะได้เท่าเดิม)`;
}

/* ── Confirm Modal — same shape as the AP-17 and UAT Users panels' ── */
function ConfirmModal({
  title,
  message,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="app-overlay fixed inset-0 z-50 flex items-center justify-center"
     
    >
      <div
        className="rounded-2xl w-[400px] max-w-[90vw] overflow-hidden"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-card)",
          boxShadow: "var(--shadow-modal)",
        }}
      >
        <div className="px-5 py-4">
          <h3 className="text-[14px] font-bold mb-2" style={{ color: "var(--text-heading)" }}>
            {title}
          </h3>
          <p className="text-[12px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
            {message}
          </p>
        </div>
        <div
          className="flex gap-2 px-5 py-3"
          style={{ borderTop: "1px solid var(--border-card)", background: "var(--bg-card-alt)" }}
        >
          <button
            onClick={onCancel}
            className="flex-1 px-3 py-2 rounded-lg text-[12px] font-medium cursor-pointer"
            style={{ background: "var(--bg-badge)", color: "var(--text-secondary)", border: "none" }}
          >
            ยกเลิก
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-3 py-2 rounded-lg text-[12px] font-bold cursor-pointer border-none text-white"
            style={{ background: danger ? "var(--color-danger)" : "var(--color-action)" }}
          >
            ยืนยัน
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Per-tab and per-menu grants ──
 *
 * One checkbox per entry in `GRANTABLE_REIMBURSE_TABS`, which is derived from
 * the settings page's own tab order — so the columns and the tabs cannot drift.
 * `access` can never appear among them: whoever opens it could grant
 * themselves the rest — including, since 2026-09-10, the brand-approval ticks
 * rendered by `BrandTickCells` above, which are a THIRD, unrelated grant group
 * on this same grid and post to a different table entirely.
 *
 * `REIMBURSE_MENUS` renders as a second, visually distinct group of the same
 * shape — a different vocabulary of keys, stored in the same `TabKey` column,
 * granting sight of a working screen rather than a settings tab. Both post
 * into the same `settingsTabs` field on save; the server's `filterStorable-
 * ReimburseKeys` is what keeps them apart on the way in, same as
 * `settings-tabs.ts` keeps them apart on the way out.
 */
function TabGrantCheckbox({
  checked,
  saving,
  onChange,
  ariaLabel,
  accent = "var(--text-info-green)",
}: {
  checked: boolean;
  saving: boolean;
  onChange: () => void;
  ariaLabel: string;
  /** Which colour a ticked box turns. Distinguishes the two grant groups from
   * each other at a glance — see the group split below. */
  accent?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-disabled={saving}
      aria-label={ariaLabel}
      disabled={saving}
      onClick={() => {
        if (!saving) onChange();
      }}
      className="w-[18px] h-[18px] rounded-[5px] flex items-center justify-center mx-auto border-none p-0 transition-all"
      style={{
        background: checked ? accent : "var(--bg-card)",
        boxShadow: checked
          ? `0 0 0 2px color-mix(in srgb, ${accent} 28%, transparent)`
          : "inset 0 0 0 1.5px var(--border-card)",
        opacity: saving ? 0.6 : 1,
        cursor: saving ? "not-allowed" : "pointer",
      }}
    >
      {saving ? (
        <Loader2 size={10} className="animate-spin" style={{ color: "var(--text-muted)" }} />
      ) : checked ? (
        <Check size={11} strokeWidth={3} style={{ color: "var(--bg-card)" }} />
      ) : null}
    </button>
  );
}

/* The menu group's accent — `--color-action`, the app's one other semantic
 * accent besides the green tab checkboxes already use. Two colours is the
 * whole mechanism: nothing else about the checkbox differs, and a screen
 * reader still gets the truth from `ariaLabel`, which names the group. */
const MENU_ACCENT = "var(--color-action)";

/* The brand group's accent — a third semantic colour, distinct from both the
 * settings-tab group's green and the menu group's blue, because this group
 * answers a materially different question: not "may this person see a
 * screen", but "may this person approve a real payment". `--color-warning`
 * is single-valued across both themes (see globals.css), same as
 * `--color-action`, so no dark-mode branch is needed here either. */
const BRAND_ACCENT = "var(--color-warning)";

/**
 * The four brand-approval columns — `AccReimburseApproverBrand`, joined onto
 * this row by the GET route from `AccReimburseApprover`'s own table (see that
 * route's docblock for the join). Modelled on AP-1's
 * `ApproverInterfaceBrandTable` / `ApproverInterfaceCells`, but NOT its
 * emptiness semantics: AP-1 collapses "all four ticked" to `null` and "none
 * ticked" to `[]`, and both read back as unrestricted (every code allowed).
 * AP-4 must not reproduce that — see `brand-scope.ts`'s module docblock — so
 * this always posts the ticked set verbatim, never collapsed and never
 * translated into "all". Zero ticks here really does mean zero brands, which
 * `isApproverScope` (server-side) reads as "not an approver".
 */
function BrandTickCells({
  row,
  onSaved,
}: {
  row: ReimburseAccessRow;
  onSaved: () => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(row.brandTargets));
  const [saving, setSaving] = useState(false);
  // Review round 1, MINOR #6: guards the re-seed effect below while THIS
  // row's own click is in flight. Without it, an unrelated SWR revalidation
  // — another row's tick, a focus revalidation, a second render — can land
  // mid-save carrying the pre-click `brandTargets`, and the effect would
  // reset `checked` to that stale value, visibly flipping the box the admin
  // just clicked back. AP-1's `ApproverInterfaceCells` guards the same shape
  // with a `skipSaveRef`, but that component saves through a watched effect;
  // this one saves directly in the click handler, so the guard here protects
  // the RE-SEED itself rather than a second, redundant save.
  const savingRef = useRef(false);

  useEffect(() => {
    if (savingRef.current) return;
    setChecked(new Set(row.brandTargets));
    // `staffId`, not `id` — `id` is `null` for an orphan row (see the
    // interface's own comment), and `staffId` is the one column guaranteed
    // to identify this row.
  }, [row.staffId, row.brandTargets]);

  const toggle = async (code: string) => {
    const next = new Set(checked);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    setChecked(next);
    setSaving(true);
    savingRef.current = true;
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Same identity echo as `TabGrantCells` below, and for the same
          // reason: `email`/`displayName`/`isActive` are unrelated to this
          // save's own field (`brandTargets`, a different table entirely) but
          // must still be sent so the route's `AccReimburseAccess` upsert does
          // not rename or reactivate/deactivate this person as a side effect
          // of a brand tick.
          email: row.email,
          displayName: row.displayName,
          isActive: row.isActive,
          // The ticked set, sent verbatim and in a fixed order — never `null`,
          // never collapsed. See the component docblock above.
          brandTargets: ERP_INTERFACE_BRANDS.filter((b) => next.has(b.id)).map((b) => b.id),
        }),
      });
      const json = await res.json();
      if (json.ok) {
        onSaved();
      } else {
        toast.error(json.error ?? "บันทึกไม่สำเร็จ");
        setChecked(new Set(row.brandTargets));
      }
    } catch {
      toast.error("บันทึกไม่สำเร็จ");
      setChecked(new Set(row.brandTargets));
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  return (
    <>
      {ERP_INTERFACE_BRANDS.map((b) => (
        <td key={b.id} className="px-3 py-2.5 text-center">
          <TabGrantCheckbox
            checked={checked.has(b.id)}
            saving={saving}
            onChange={() => void toggle(b.id)}
            ariaLabel={`${row.displayName || row.email} — อนุมัติแบรนด์: ${b.name}`}
            accent={BRAND_ACCENT}
          />
        </td>
      ))}
    </>
  );
}

function TabGrantCells({
  row,
  onSaved,
}: {
  row: ReimburseAccessRow;
  onSaved: () => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(row.settingsTabs));
  const [saving, setSaving] = useState(false);

  // The server's answer is the truth; re-seed whenever SWR brings a new one.
  // `staffId`, not `id` — `id` is `null` for an orphan row (no
  // `AccReimburseAccess` row at all; see the interface's own comment) and
  // `staffId` is the one column guaranteed to identify this row.
  useEffect(() => {
    setChecked(new Set(row.settingsTabs));
  }, [row.staffId, row.settingsTabs]);

  const toggle = async (key: string) => {
    const next = new Set(checked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setChecked(next);
    setSaving(true);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // The roster row is keyed on StaffId, which the server resolves from
          // HR by this email — never posted from here. `displayName` and
          // `isActive` are echoed back so the upsert behind this save cannot
          // rename the person or flip their state as a side effect of a tick.
          email: row.email,
          displayName: row.displayName,
          isActive: row.isActive,
          // Posted in a fixed order — settings tabs, then menus, each in their
          // own constant's order — so what is stored never depends on the
          // order the boxes happened to be ticked. The field still carries
          // both vocabularies: `filterStorableReimburseKeys` on the server is
          // the WIDE filter that keeps a menu key from being dropped before it
          // is even written — see that route's own comment.
          settingsTabs: [
            ...GRANTABLE_REIMBURSE_TABS.filter((t) => next.has(t.key)).map((t) => t.key),
            ...REIMBURSE_MENUS.filter((m) => next.has(m.key)).map((m) => m.key),
          ],
        }),
      });
      const json = await res.json();
      if (json.ok) {
        onSaved();
      } else {
        toast.error(json.error ?? "บันทึกไม่สำเร็จ");
        setChecked(new Set(row.settingsTabs));
      }
    } catch {
      toast.error("บันทึกไม่สำเร็จ");
      setChecked(new Set(row.settingsTabs));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {GRANTABLE_REIMBURSE_TABS.map((tab, idx) => (
        <td
          key={tab.key}
          className="px-3 py-2.5 text-center"
          // Left border on the first cell only, matching the header's own
          // boundary between the brand-approval group and this one.
          style={idx === 0 ? { borderLeft: "1px solid var(--border-light)" } : undefined}
        >
          <TabGrantCheckbox
            checked={checked.has(tab.key)}
            saving={saving}
            onChange={() => void toggle(tab.key)}
            ariaLabel={`${row.displayName || row.email} — ตั้งค่า: ${tab.label}`}
          />
        </td>
      ))}
      {/* The menu group — a different vocabulary in the same TabKey column
          (see settings-tabs.ts), so it gets its own accent colour and its own
          left border rather than blending into the settings-tab checkboxes
          beside it. Ticks render on inactive rows for the same reason the tab
          group's do: hiding them would leave an admin unable to see what a
          deactivated person still holds.
          NO background override here (review round 1, MINOR #5) — an opaque
          `--bg-card-alt` painted over every menu cell blocked the `<tr>`'s own
          `--bg-row-stripe` and `:hover` beneath it, so zebra striping and
          hover would have shown in some columns and not others. The border
          alone is what marks the group boundary; the checkbox's own accent
          colour is what marks the group itself. */}
      {REIMBURSE_MENUS.map((menu, idx) => (
        <td
          key={menu.key}
          className="px-3 py-2.5 text-center"
          style={idx === 0 ? { borderLeft: "1px solid var(--border-light)" } : undefined}
        >
          <TabGrantCheckbox
            checked={checked.has(menu.key)}
            saving={saving}
            onChange={() => void toggle(menu.key)}
            ariaLabel={`${row.displayName || row.email} — หน้าใช้งาน: ${menu.label}`}
            accent={MENU_ACCENT}
          />
        </td>
      ))}
    </>
  );
}

/**
 * AP-4's สิทธิ์เข้าถึง tab — who may open which of AP-4's back-office settings,
 * AND, since 2026-09-10, who approves real reimbursement payments.
 *
 * **Two tables, still not merged — the screen is what merged.**
 * `AccReimburseApprover` decides who takes the two accounting steps on real
 * reimbursement payments; `AccReimburseAccess` decides who may edit the
 * payment-rule checklist and the brand allowlist. Migration 120 added a second
 * table rather than reusing the first precisely so one can be handed out
 * without the other, and that is still true — merging the tables would widen
 * the read ACL, `/my-work`'s pending list and the approval-notification
 * fan-out to everyone granted a settings tab, none of which is about
 * approving. What changed is that the former ผู้อนุมัติบัญชี **tab** is gone:
 * its brand ticks now render as extra columns on THIS grid, joined onto each
 * row by the `settings/access` GET route. **The brand tick set is the primary
 * switch** — ticking ≥1 brand is what makes `AccReimburseApprover.IsActive =
 * 1`, and unticking the last one is what turns it back off, with no separate
 * per-brand-group toggle to contradict it (see `brand-scope.ts` and
 * `setReimburseApproverBrands`'s own docblock for why). **The สถานะ column
 * below is a second, coarser switch on the same flag** — turning it off
 * clears approval authority too, regardless of ticks (the ticks themselves
 * survive; only the derived `IsActive` does not — see
 * `setReimburseAccessAndApprovalActive`'s own docblock, added in review
 * round 1 after the button was found to silently leave approval live while
 * reading "ปิด"), and turning it back on restores approval only if a tick
 * still exists. The two controls answer different questions — "which brands"
 * versus "on or off at all, for everything this row holds" — and never
 * disagree about the end state.
 *
 * **Unlike AP-1's equivalent grid, an all-unticked row is not "unrestricted"
 * here.** AP-1 collapses "every code ticked" and "none ticked" to the same
 * stored shape and reads zero rows as "every brand allowed" — a measured
 * fail-open this table deliberately does not reproduce. Zero brand ticks on
 * this grid means zero brands and zero approval authority, full stop.
 *
 * **Two commissioning states get an alarm banner, carried over from the
 * deleted ผู้อนุมัติบัญชี tab's own panel:** nobody able to approve (every
 * AP-4 claim stops dead at the accounting step) and exactly one person able
 * to approve (the two-person rule then stalls every claim at the final
 * step — "the one that looks fine until it is tried"). Both count
 * `approverActive`, the real `AccReimburseApprover.IsActive` flag — NOT
 * `brandTargets.length > 0`, which would undercount a row created before
 * `setReimburseApproverBrands` existed (see that field's own comment).
 * Neither banner is about
 * สิทธิ์เข้าถึง's OWN roster: an admin who has added people here with no ticks
 * of either kind is a neutral state and gets no banner, same as before —
 * nothing is hidden and nothing is broken by that, because admins keep every
 * tab and menu regardless of this list.
 *
 * Membership alone grants nothing either — the ticks do. Somebody added and
 * left with no boxes ticked has exactly the access they had before, which is
 * why the row copy says so rather than leaving an admin to infer it.
 *
 * Table shape follows `UatUserSettings`: one สถานะ column in which the badge
 * reports the state and the round button beside it performs the single
 * available action. Deactivation is a soft delete — rows are never removed, so
 * the history of who could edit what stays readable. As of review round 1
 * that สถานะ column reports and controls BOTH grants at once — settings-tab
 * sight AND approval authority — never `AccReimburseAccess.IsActive` alone;
 * `displayActiveFor` below is the one place that answer is computed, and
 * every other reader of "is this row on" goes through it.
 *
 * **Some rows have no `AccReimburseAccess` row at all.** The GET route unions
 * in "orphan" `AccReimburseApprover` rows — active approvers added before
 * this screen existed, with no settings-access counterpart — so this screen
 * never hides a real approval grant (review round 1, IMPORTANT #1). An
 * orphan's `id` is `null` and its `isActive` is always `false` (there is no
 * access row to be active); `hasAccessRow` is what tells the two apart, and
 * `staffId`, not `id`, is what identifies a row everywhere in this file.
 */
export function ReimburseAccessSettings() {
  const {
    data,
    error: fetchError,
    mutate,
    isLoading,
  } = useSWR<{
    ok: boolean;
    data: ReimburseAccessRow[];
    error?: string;
  }>(ENDPOINT, fetcher);

  const [showAddModal, setShowAddModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);
  const [busyStaffId, setBusyStaffId] = useState<number | null>(null);

  const rows = data?.ok ? data.data ?? [] : [];
  // A rejected fetch has to reach `loadError` too, not just an `ok: false` body:
  // SWR would otherwise leave `data` undefined with `isLoading` false, and the
  // panel would render an unreadable roster as an empty one. Here that is a
  // milder lie than it is on AP-17's panel — nothing is alarming about an empty
  // list — but an admin would still be looking at "nobody is granted anything"
  // when the truth is "the roster could not be read".
  const loadError = fetchError
    ? fetchError instanceof Error
      ? fetchError.message
      : "โหลดข้อมูลไม่สำเร็จ"
    : data && !data.ok
      ? data.error ?? "โหลดข้อมูลไม่สำเร็จ"
      : null;
  const activeCount = rows.filter((r) => r.isActive).length;
  // The accounting-approver count, off `approverActive` — the REAL
  // `AccReimburseApprover.IsActive` flag, not `isActive` above (สิทธิ์เข้าถึง's
  // own settings-tab/menu switch, a different question) and not
  // `brandTargets.length > 0` either. Review round 1, IMPORTANT #1: a row
  // written before `setReimburseApproverBrands` existed can be active with
  // zero brand rows (migration 144 shipped with no backfill), and
  // `findActiveApprover` reads the database flag alone — counting by ticks
  // would undercount exactly those people and let both banners below claim
  // "nobody can approve" while somebody still can. This is what the two
  // commissioning banners key on.
  const approverActiveCount = rows.filter((r) => r.approverActive).length;

  const call = async (
    method: "POST" | "PATCH",
    body: Record<string, unknown>,
    busy?: number,
  ) => {
    if (busy !== undefined) setBusyStaffId(busy);
    try {
      const res = await fetch(ENDPOINT, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success("บันทึกเรียบร้อย");
        await mutate();
      } else {
        toast.error(json.error ?? "เกิดข้อผิดพลาด");
      }
    } catch {
      toast.error("เกิดข้อผิดพลาด");
    } finally {
      if (busy !== undefined) setBusyStaffId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ── Commissioning banners — carried over verbatim in spirit from the
          deleted ผู้อนุมัติบัญชี tab's own panel. Keyed on the brand ticks
          (`approverActiveCount`), never on สิทธิ์เข้าถึง's own `activeCount`:
          the two answer different questions, and this banner is about whether
          AP-4's accounting step can move at all. */}
      {!isLoading && !loadError && approverActiveCount === 0 && (
        <div
          className="rounded-xl px-4 py-3 flex items-start gap-2.5"
          style={{ background: "var(--status-bad-bg)", color: "var(--status-bad-text)" }}
        >
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <p className="text-[12px] leading-relaxed">
            ยังไม่มีผู้อนุมัติฝ่ายบัญชีที่เปิดใช้งาน (ยังไม่มีใครติ๊กแบรนด์เลยสักคน) — คำขอ AP-4
            ทุกใบจะค้างที่ขั้นตรวจสอบของบัญชี และไม่มีใครกดอนุมัติได้ กรุณาติ๊กแบรนด์ให้ผู้มีสิทธิ์เข้าถึงอย่างน้อย 2 คน
          </p>
        </div>
      )}
      {!isLoading && !loadError && approverActiveCount === 1 && (
        <div
          className="rounded-xl px-4 py-3 flex items-start gap-2.5"
          style={{ background: "var(--status-pending-bg)", color: "var(--status-pending-text)" }}
        >
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <p className="text-[12px] leading-relaxed">
            มีผู้อนุมัติฝ่ายบัญชีที่เปิดใช้งานเพียง 1 คน — AP-4 กำหนดให้ผู้ที่ตรวจสอบ (ขั้นบัญชี)
            กับผู้ที่อนุมัติขั้นสุดท้ายต้องไม่ใช่คนเดียวกัน คำขอจะค้างที่ขั้นอนุมัติสุดท้าย
            จนกว่าจะมีผู้อนุมัติที่เปิดใช้งานอย่างน้อย 2 คน
          </p>
        </div>
      )}

      <div
        className="rounded-xl p-4"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
      >
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck size={16} style={{ color: "var(--text-heading)" }} />
          <h2 className="text-[14px] font-bold flex-1" style={{ color: "var(--text-heading)" }}>
            สิทธิ์เข้าถึง
          </h2>
          <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
            เปิดใช้งาน {activeCount} / {rows.length} คน · ผู้อนุมัติฝ่ายบัญชี {approverActiveCount} คน
          </span>
        </div>
        <p className="text-[11px] mb-3 leading-relaxed" style={{ color: "var(--text-muted)" }}>
          หน้านี้รวมสองสิทธิ์ไว้ในที่เดียว — <strong>ผู้อนุมัติฝ่ายบัญชี (AP-4)</strong> ติ๊กแบรนด์
          ด้านล่าง กับ <strong>แท็บตั้งค่า</strong> และ <strong>หน้าใช้งาน</strong> เช่น
          คิวอนุมัติ (บัญชี) · IT Admin และ System Admin เห็นทุกแท็บและทุกหน้าอยู่แล้วโดยไม่ต้องอยู่ในรายชื่อนี้
          และอนุมัติได้ทุกแบรนด์อยู่แล้ว · <strong>ติ๊กแบรนด์กับติ๊กแท็บเป็นอิสระจากกัน</strong> —
          ติ๊กแบรนด์ไม่ได้แปลว่าแก้ตั้งค่าได้ และติ๊กแท็บ/หน้าใช้งานไม่ได้แปลว่าอนุมัติจ่ายเงินได้
        </p>

        <div className="mb-4">
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-2 rounded-lg cursor-pointer"
            style={{ background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)", border: "1px solid var(--btn-primary-border)" }}
          >
            <Plus size={12} /> เพิ่มผู้มีสิทธิ์เข้าถึง
          </button>
        </div>

        {showAddModal && (
          <ADSearchModal
            title="เพิ่มผู้มีสิทธิ์เข้าถึง"
            subtitle="ค้นหาผู้ใช้จาก Microsoft Entra ID — ต้องมีข้อมูลพนักงานที่ยังทำงานอยู่ในระบบ HR"
            onClose={() => setShowAddModal(false)}
            // Only the email goes up: the server resolves StaffId from HR.
            onSelect={(u: ADResult) => {
              void call("POST", { email: u.email, displayName: u.name });
            }}
            // `displayActiveFor`, not `r.isActive` alone — an orphan row's
            // `isActive` is always `false` (no access row to be active), but
            // it is still somebody real on the roster and the AD search
            // should mark them "already added" the same as any other active
            // row.
            existingEmails={rows.filter(displayActiveFor).map((r) => r.email)}
          />
        )}

        {isLoading ? (
          <div className="py-10 flex justify-center">
            <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-muted)" }} />
          </div>
        ) : loadError ? (
          <p className="py-8 text-center text-[12px]" style={{ color: "var(--text-danger)" }}>
            {loadError}
          </p>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-[12px]" style={{ color: "var(--text-muted)" }}>
            ยังไม่มีรายชื่อ — กด &quot;เพิ่มผู้มีสิทธิ์เข้าถึง&quot; เพื่อเริ่มต้น
          </p>
        ) : (
          <>
            {/* Verbatim header note for the new brand group, then the
                existing note for the settings-tab group — two short lines
                rather than one crowded one, since they answer two different
                questions. */}
            <p className="text-[11px] mb-1" style={{ color: "var(--color-warning)" }}>
              ติ๊กแบรนด์ที่อนุมัติได้ — อย่างน้อย 1 แบรนด์จึงจะเป็นผู้อนุมัติ ·
              ไม่ติ๊กเลย = ไม่ใช่ผู้อนุมัติ
            </p>
            <p className="text-[11px] mb-2" style={{ color: "var(--text-muted)" }}>
              ติ๊กแท็บที่ให้แก้ได้ — ถ้าไม่ติ๊กเลย จะยังเข้าหน้าตั้งค่าไม่ได้
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] min-w-[1080px]">
                <thead>
                  {/* Group heading row. The three identity columns and สถานะ
                      span both rows unchanged; the three grant groups each get
                      a labelled span above their own checkbox columns so an
                      admin reads "may approve this brand", "may open the
                      settings tab" and "may open the working screen" as three
                      different questions, not one wide block of checkboxes. */}
                  <tr
                    style={{
                      borderBottom: "1px solid var(--border-light)",
                      background: "var(--bg-card-alt)",
                    }}
                  >
                    <th rowSpan={2} className="text-left px-4 py-2 font-semibold align-bottom" style={{ color: "var(--text-muted)" }}>
                      ชื่อ
                    </th>
                    <th rowSpan={2} className="text-left px-4 py-2 font-semibold align-bottom" style={{ color: "var(--text-muted)" }}>
                      อีเมล
                    </th>
                    <th rowSpan={2} className="text-left px-4 py-2 font-semibold align-bottom" style={{ color: "var(--text-muted)" }}>
                      รหัสพนักงาน
                    </th>
                    {/* The brand-approval group — AccReimburseApproverBrand,
                        joined onto this row by the GET route (see the route's
                        own docblock). This is AP-4's payment-approval pool,
                        not a settings grant, which is why it gets its own
                        accent and sits first, ahead of the two sight-only
                        groups. */}
                    <th
                      colSpan={ERP_INTERFACE_BRANDS.length}
                      className="text-center px-3 py-1.5 font-semibold whitespace-nowrap"
                      style={{ color: "var(--color-warning)" }}
                    >
                      ผู้อนุมัติฝ่ายบัญชี (ติ๊กแบรนด์)
                    </th>
                    <th
                      colSpan={GRANTABLE_REIMBURSE_TABS.length}
                      className="text-center px-3 py-1.5 font-semibold whitespace-nowrap"
                      style={{ color: "var(--text-info-green)", borderLeft: "1px solid var(--border-light)" }}
                    >
                      แท็บตั้งค่า
                    </th>
                    <th
                      colSpan={REIMBURSE_MENUS.length}
                      className="text-center px-3 py-1.5 font-semibold whitespace-nowrap"
                      style={{ color: "var(--color-action)", borderLeft: "1px solid var(--border-light)", background: "var(--bg-card-alt)" }}
                    >
                      หน้าใช้งาน
                    </th>
                    {/* Status and its control share one column: the badge
                        reports, the button acts. A badge that is also a button
                        reads as neither. */}
                    <th rowSpan={2} className="text-center px-4 py-2 font-semibold align-bottom" style={{ color: "var(--text-muted)" }}>
                      สถานะ
                    </th>
                  </tr>
                  <tr
                    style={{
                      borderBottom: "1px solid var(--border-light)",
                      background: "var(--bg-card-alt)",
                    }}
                  >
                    {/* The four brand-approval columns, same logo-over-code
                        shape as AP-1's ApproverInterfaceBrandTable header. */}
                    {ERP_INTERFACE_BRANDS.map((b) => (
                      <th
                        key={b.id}
                        className="text-center px-3 py-2 font-semibold whitespace-nowrap w-20"
                        style={{ color: "var(--text-muted)" }}
                      >
                        <img
                          src={`/brandlogo/${b.id.toLowerCase()}-200.png`}
                          alt={b.name}
                          className="h-5 w-auto object-contain mx-auto mb-0.5"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                        <span className="block text-[10px]">{b.id}</span>
                      </th>
                    ))}
                    {/* The grantable settings tabs, in the settings page's own
                        order — both lists come from GRANTABLE_REIMBURSE_TABS,
                        which is filtered from the page's tab order, so a new
                        grantable tab appears in both or in neither. Its own
                        left border marks the boundary with the brand group. */}
                    {GRANTABLE_REIMBURSE_TABS.map((tab, idx) => (
                      <th
                        key={tab.key}
                        className="text-center px-3 py-2 font-semibold whitespace-nowrap"
                        style={
                          idx === 0
                            ? { color: "var(--text-muted)", borderLeft: "1px solid var(--border-light)" }
                            : { color: "var(--text-muted)" }
                        }
                      >
                        {tab.label}
                      </th>
                    ))}
                    {/* The menu group — a second, unrelated vocabulary of keys
                        stored in the same TabKey column (see settings-tabs.ts
                        for why the two are kept apart in code). Given its own
                        left border so the column split reads even without the
                        heading above it; the background here matches the row's
                        own (headers do not stripe, so it is purely cosmetic
                        and, unlike the body cells below, does not need to let
                        anything show through). */}
                    {REIMBURSE_MENUS.map((menu, idx) => (
                      <th
                        key={menu.key}
                        className="text-center px-3 py-2 font-semibold whitespace-nowrap"
                        style={
                          idx === 0
                            ? { color: "var(--text-muted)", borderLeft: "1px solid var(--border-light)", background: "var(--bg-card-alt)" }
                            : { color: "var(--text-muted)", background: "var(--bg-card-alt)" }
                        }
                      >
                        {menu.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => {
                    // The one true "is this row currently active" answer,
                    // reused for the badge, the button's colour/icon and the
                    // click handler's branch — see `displayActiveFor`'s own
                    // comment for why an orphan reads `approverActive`
                    // instead of a hardcoded `false`.
                    const active = displayActiveFor(r);
                    return (
                      <tr
                        // `staffId`, not `id` — `id` is `null` for an orphan
                        // row (no `AccReimburseAccess` row at all), and
                        // `staffId` is the one column guaranteed unique and
                        // non-null across BOTH rosters this grid unions.
                        key={r.staffId}
                        className="transition-colors hover:!bg-[var(--bg-row-hover)]"
                        style={{
                          borderBottom: "1px solid var(--border-light)",
                          background: idx % 2 === 1 ? "var(--bg-row-stripe)" : undefined,
                        }}
                      >
                        <td className="px-4 py-2.5 font-medium" style={{ color: "var(--text-primary)" }}>
                          {r.displayName}
                          {/* An orphan — an active AccReimburseApprover row
                              unioned in with no matching AccReimburseAccess
                              row (see the GET route's own docblock, review
                              round 1 IMPORTANT #1). Named here rather than
                              only in the สถานะ column, so it reads next to
                              the identity it qualifies rather than being
                              mistaken for a second status. */}
                          {!r.hasAccessRow && (
                            <span
                              className="block text-[10px] font-normal mt-0.5"
                              style={{ color: "var(--text-faint)" }}
                            >
                              ไม่มีสิทธิ์แท็บตั้งค่า — เป็นผู้อนุมัติฝ่ายบัญชีเท่านั้น
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5" style={{ color: "var(--text-muted)" }}>
                          {r.email}
                        </td>
                        <td className="px-4 py-2.5" style={{ color: "var(--text-muted)" }}>
                          {r.staffId}
                        </td>
                        {/* Brand-approval ticks — a different table
                            (`AccReimburseApprover`/`AccReimburseApproverBrand`),
                            joined onto this row by the GET route. Rendered
                            regardless of สิทธิ์เข้าถึง's own `isActive`: a person
                            can be an active approver while their settings-tab
                            access is switched off, and vice versa — the two are
                            independent, see the component docblock above. */}
                        <BrandTickCells row={r} onSaved={() => void mutate()} />
                        {/* Ticks render on every row, active or not. Deactivating
                            does not delete grant rows — `resolveReimburseTabsByEmail`
                            filters `IsActive = 1`, so access stops immediately and
                            comes back exactly as it was on reactivation. Hiding
                            the ticks would leave an admin unable to see what a
                            deactivated person still holds, or to set it up before
                            switching them on. The save cannot flip the status: the
                            payload echoes `isActive` back unchanged. */}
                        <TabGrantCells row={r} onSaved={() => void mutate()} />
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-center gap-2">
                            <span
                              className="text-[10px] font-bold px-2 py-0.5 rounded"
                              style={
                                active
                                  ? { background: "var(--status-ok-bg)", color: "var(--status-ok-text)" }
                                  : { background: "var(--bg-badge)", color: "var(--text-muted)" }
                              }
                            >
                              {active ? "ใช้งาน" : "ปิด"}
                            </span>
                            <button
                              type="button"
                              disabled={busyStaffId === r.staffId}
                              onClick={() => {
                                if (!active) {
                                  void call("PATCH", { staffId: r.staffId, isActive: true }, r.staffId);
                                  return;
                                }
                                setConfirmAction({
                                  // The title and message both adapt to what
                                  // this row actually holds — see
                                  // `buildDeactivateMessage`'s own comment.
                                  // Review round 1, IMPORTANT #2: the old
                                  // fixed copy claimed only "จะเข้าหน้าตั้งค่า
                                  // AP-4 ไม่ได้อีก" while the PATCH now also
                                  // stops real approval authority — an admin
                                  // reading only the dialog would not know
                                  // that.
                                  title: r.hasAccessRow ? "ปิดสิทธิ์เข้าถึง" : "ปิดสิทธิ์อนุมัติ",
                                  message: buildDeactivateMessage(r),
                                  danger: true,
                                  onConfirm: () => {
                                    setConfirmAction(null);
                                    void call(
                                      "PATCH",
                                      { staffId: r.staffId, isActive: false },
                                      r.staffId,
                                    );
                                  },
                                });
                              }}
                              className="inline-flex items-center justify-center rounded-full border-none shrink-0 enabled:cursor-pointer disabled:cursor-default disabled:opacity-70"
                              style={
                                active
                                  ? {
                                      width: 24,
                                      height: 24,
                                      background: "var(--status-bad-bg)",
                                      color: "var(--status-bad-text)",
                                    }
                                  : {
                                      width: 24,
                                      height: 24,
                                      background: "var(--status-ok-bg)",
                                      color: "var(--status-ok-text)",
                                    }
                              }
                              title={active ? "ปิดการใช้งาน" : "เปิดใช้งาน"}
                              aria-label={
                                active
                                  ? `ปิดการใช้งาน ${r.displayName}`
                                  : `เปิดใช้งาน ${r.displayName}`
                              }
                            >
                              {busyStaffId === r.staffId ? (
                                <Loader2 size={13} className="animate-spin" />
                              ) : active ? (
                                <UserX size={13} />
                              ) : (
                                <UserCheck size={13} />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {confirmAction && (
        <ConfirmModal
          title={confirmAction.title}
          message={confirmAction.message}
          danger={confirmAction.danger}
          onConfirm={confirmAction.onConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}
