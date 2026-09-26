"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { AlertTriangle, Check, Loader2, Plus, ShieldCheck, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { Button, Dialog } from "@/components/ui";
import { ADSearchModal, type ADResult } from "@/components/settings/ADSearchModal";
import {
  advClrMenusForForm,
  advClrTabsForForm,
  filterAdvClrKeysForForm,
  type AdvClrForm,
} from "@/lib/adv/settings-tabs";
import {
  advClrApproverColumnsForForm,
  advClrApproverEndpoint,
  advClrApproverWriteBody,
  type AdvClrApproverColumn,
} from "@/lib/adv/approver-columns";
import { approverRosterKey, fetchApproverRoster } from "@/lib/adv/approver-roster";
import { FormOwnerCheckbox } from "@/features/settings/FormOwnerCheckbox";
import {
  buildAccessGridRows,
  countActiveApprovers,
  type AccessGridRow,
  type AccessRosterRow,
} from "@/lib/adv/access-grid-rows";

const ENDPOINT = "/api/request/advance/settings/access";
const fetcher = (url: string) => fetch(url).then((r) => r.json());

/**
 * One tick.
 *
 * A local copy of AP-4's `TabGrantCheckbox` rather than an import: it is not
 * exported there, and extracting it would mean editing a working screen this
 * change was not asked to touch. The accent is what tells the three grant
 * groups apart at a glance; a screen reader gets the same from `ariaLabel`,
 * which names the group.
 */
function GrantCheckbox({
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

/** The approver group's accent — a real approval on real money, not sight. */
const APPROVER_ACCENT = "var(--color-warning)";
/** The working-menu group's accent, as on AP-4's grid. */
const MENU_ACCENT = "var(--color-action)";

/**
 * The approver ticks for one person — one cell per role this form has.
 *
 * **Ticking creates, unticking deactivates, and nothing here deletes.** The
 * body comes from `advClrApproverWriteBody`, which is where the three rules
 * behind that live; a hard delete stays in the approver panel below, where the
 * confirm dialog is.
 *
 * **A failed roster read renders a dash, never an empty box.** With
 * `rosterOk` false every row's ticks would otherwise draw unticked — the
 * "unreadable renders as empty" lie this codebase keeps recording — and a click
 * on one would then CREATE an approver row for somebody who may already have
 * one.
 */
function ApproverCells({
  form,
  row,
  columns,
  rosterOk,
  onSaved,
}: {
  form: AdvClrForm;
  row: AccessGridRow;
  columns: readonly AdvClrApproverColumn[];
  rosterOk: boolean;
  onSaved: () => Promise<unknown>;
}) {
  const [savingRole, setSavingRole] = useState<string | null>(null);

  const toggle = async (col: AdvClrApproverColumn, next: boolean) => {
    const existing = row.approverByRole[col.role] ?? null;
    const body = advClrApproverWriteBody(form, {
      id: existing ? existing.id : null,
      email: row.email,
      role: col.role,
      isActive: next,
    });
    if (!body) return;
    setSavingRole(col.role);
    try {
      // The same resolver `approverRosterKey` reads the SWR key from, so the
      // write and the cache it invalidates can never name different endpoints.
      const res = await fetch(advClrApproverEndpoint(form), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error ?? "บันทึกไม่สำเร็จ");
      toast.success(
        next
          ? `${row.displayName} เป็นผู้อนุมัติ ${col.label} แล้ว`
          : `ปิดสิทธิ์อนุมัติ ${col.label} ของ ${row.displayName}`,
      );
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSavingRole(null);
    }
  };

  return (
    <>
      {columns.map((col, idx) => {
        const existing = row.approverByRole[col.role] ?? null;
        return (
          <td
            key={col.role}
            className="px-3 py-2.5 text-center"
            style={idx === 0 ? { borderLeft: "1px solid var(--border-light)" } : undefined}
          >
            {!rosterOk ? (
              <span
                className="text-[12px]"
                style={{ color: "var(--text-faint)" }}
                title="อ่านรายชื่อผู้อนุมัติไม่สำเร็จ — รีเฟรชหน้านี้ก่อนแก้ไข"
              >
                —
              </span>
            ) : (
              <GrantCheckbox
                checked={!!existing && existing.isActive}
                saving={savingRole === col.role}
                onChange={() => void toggle(col, !(existing && existing.isActive))}
                ariaLabel={`${row.displayName} — ผู้อนุมัติ: ${col.label}`}
                accent={APPROVER_ACCENT}
              />
            )}
          </td>
        );
      })}
    </>
  );
}

/**
 * The settings-tab and working-menu ticks for one person.
 *
 * **Each tick posts this form's whole granted set, with `form` beside it.**
 * That is what keeps the bounded save bounded: `setAdvClrAccessTabs` replaces
 * only the named form's keys, so the other form's grants — edited on the other
 * page — are neither read nor deleted here. Sending the other form's keys would
 * make that a silent drop rather than a second line of defence, so the payload
 * goes through `filterAdvClrKeysForForm` on the way out as well.
 *
 * **An approver-only row omits `isActive` instead of echoing `false`.** A row
 * with no `AccAdvClrAccess` row has no flag to echo, and `upsertAdvClrAccess`
 * reads an absent one as "leave it alone" while a new row defaults to active —
 * so echoing the `false` this screen displays for such a row would create the
 * access row **switched off**, granting nothing and leaving the tick looking
 * broken.
 */
function TabGrantCells({
  form,
  row,
  tabs,
  menus,
  onSaved,
}: {
  form: AdvClrForm;
  row: AccessGridRow;
  tabs: readonly { key: string; label: string; adminOnly?: string; note?: string }[];
  menus: readonly { key: string; label: string }[];
  onSaved: () => Promise<unknown>;
}) {
  const saved = filterAdvClrKeysForForm(row.access?.settingsTabs ?? [], form);
  const [checked, setChecked] = useState<string[]>(saved);
  const [saving, setSaving] = useState(false);
  // Guards the re-seed below while THIS row's own click is in flight — AP-4's
  // `BrandTickCells` carries the same ref for the same reason. Without it an
  // unrelated SWR revalidation (another row's tick, a focus revalidation) can
  // land mid-save carrying the pre-click grants, and the effect would reset
  // `checked` to that stale value, visibly flipping the box just clicked back.
  const savingRef = useRef(false);

  // The server's answer is the truth; re-seed whenever SWR brings a new one.
  // `row.key` is the lowercased email — see `AccessGridRow`'s own comment for why it
  // is that and not the StaffId AP-4 keys on.
  useEffect(() => {
    if (savingRef.current) return;
    setChecked(filterAdvClrKeysForForm(row.access?.settingsTabs ?? [], form));
  }, [row.key, row.access?.settingsTabs, form]);

  const has = (k: string) => checked.indexOf(k) !== -1;

  const toggle = async (key: string) => {
    const next = has(key) ? checked.filter((k) => k !== key) : checked.concat([key]);
    setChecked(next);
    setSaving(true);
    savingRef.current = true;
    try {
      const body: Record<string, unknown> = {
        email: row.email,
        displayName: row.displayName,
        // Posted in a fixed order — this form's tabs, then its menus — so what
        // is stored never depends on the order the boxes happened to be ticked.
        settingsTabs: filterAdvClrKeysForForm(
          tabs
            .map((t) => t.key)
            .filter((k) => next.indexOf(k) !== -1)
            .concat(menus.map((m) => m.key).filter((k) => next.indexOf(k) !== -1)),
          form,
        ),
        // Which half of the roster this replaces. The route refuses a save that
        // does not name one rather than guessing.
        form,
      };
      // See the component docblock: absent, not `false`, for an orphan row.
      if (row.access) body.isActive = row.access.isActive;
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error ?? "บันทึกไม่สำเร็จ");
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      setChecked(filterAdvClrKeysForForm(row.access?.settingsTabs ?? [], form));
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  return (
    <>
      {tabs.map((tab, idx) => (
        <td
          key={tab.key}
          className="px-3 py-2.5 text-center"
          style={idx === 0 ? { borderLeft: "1px solid var(--border-light)" } : undefined}
          title={tab.adminOnly ? `ให้สิทธิ์ไม่ได้ — ${tab.adminOnly}` : tab.note}
        >
          {tab.adminOnly ? (
            // A dash, not an unticked box: an empty checkbox invites a click
            // that would do nothing, and reads as "not granted yet" rather than
            // "cannot be granted". Enforcement is unchanged either way —
            // filterStorableAdvClrKeys refuses to write these keys and
            // decideAdvClrTabAccess refuses to open them — so this cell is a
            // statement rather than the thing stopping a grant.
            <span className="text-[12px]" style={{ color: "var(--text-faint)" }}>—</span>
          ) : (
            <GrantCheckbox
              checked={has(tab.key)}
              saving={saving}
              onChange={() => void toggle(tab.key)}
              ariaLabel={`${row.displayName} — แท็บตั้งค่า: ${tab.label}`}
            />
          )}
        </td>
      ))}
      {menus.map((menu, idx) => (
        <td
          key={menu.key}
          className="px-3 py-2.5 text-center"
          style={idx === 0 ? { borderLeft: "1px solid var(--border-light)" } : undefined}
        >
          <GrantCheckbox
            checked={has(menu.key)}
            saving={saving}
            onChange={() => void toggle(menu.key)}
            ariaLabel={`${row.displayName} — หน้าใช้งาน: ${menu.label}`}
            accent={MENU_ACCENT}
          />
        </td>
      ))}
    </>
  );
}

/**
 * The Message tab's tick — its own column, deliberately outside `TabGrantCells`
 * above and both groups it renders.
 *
 * **Not a `settingsTabs` entry.** `advanceMessages` / `clearMessages` are
 * excluded from `GRANTABLE_ADV_CLR_TABS` and always must be: the grant is
 * `AccAdvClrAccess.CanAdvanceMessage` / `.CanClearMessage` (migration 166), a
 * column ACC Portal's own settings-tab saver never names and so never
 * deletes, unlike a `TabKey` row in the table that saver rewrites wholesale.
 * See `@/lib/acc/message-grant`.
 *
 * **One component for both forms**, reading and writing whichever column
 * `form` selects — exactly like the two Interface ERP settings-tab keys are
 * one shared shape with a form-selected key.
 *
 * Disabled for an approver-only row (`row.access === null`): there is no
 * `AccAdvClrAccess` row to hold the column, so a tick there would have
 * nothing to set. `row.access`'s absence is also why this cell reads `false`
 * rather than the wrong form's flag.
 */
function MessageGrantCell({
  form,
  row,
  onSaved,
}: {
  form: AdvClrForm;
  row: AccessGridRow;
  onSaved: () => Promise<unknown>;
}) {
  const stored = form === "AP-2" ? row.access?.canAdvanceMessage : row.access?.canClearMessage;
  const [checked, setChecked] = useState(!!stored);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setChecked(!!stored);
  }, [row.key, stored]);

  const toggle = async () => {
    if (!row.access) return;
    const next = !checked;
    setChecked(next);
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        email: row.email,
        displayName: row.displayName,
        isActive: row.access.isActive,
        ...(form === "AP-2" ? { canAdvanceMessage: next } : { canClearMessage: next }),
      };
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error ?? "บันทึกไม่สำเร็จ");
      await onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      setChecked(!!stored);
    } finally {
      setSaving(false);
    }
  };

  return (
    <td className="px-3 py-2.5 text-center" style={{ borderLeft: "1px solid var(--border-light)" }}>
      <GrantCheckbox
        checked={checked}
        saving={saving || !row.access}
        onChange={() => void toggle()}
        ariaLabel={`${row.displayName} — Message`}
      />
    </td>
  );
}

/**
 * Who may open which of ONE form's settings tabs and working menus, and who
 * approves its money — one table, one row per person, one column per right.
 *
 * **One roster for both forms, one screen each** (`AccAdvClrAccess`, migration
 * 152 — the user's decision, 2026-09-14). The table carries no `FormCode` and
 * still does not; what changed on 2026-09-22, on the user's instruction
 * (*"สิทธิ์เข้าถึง AP-2 จะใช้แค่ AP-2 เท่านั้น..."*), is that this panel takes the
 * form it is rendered for and shows only that form's keys. Both pages still
 * call one endpoint, which is correct — these are shared master tables written
 * through `writeBothPools`, so which database a request resolves cannot matter.
 *
 * **The card-per-person layout became AP-4's table on 2026-09-22** (user, with
 * screenshots: *"สิทธิ์เข้าถึง AP-2 ยังเหมือนเดิม จะต้องเป็นรูปแบบเหมือน AP-4"*),
 * and with it the approver pool moved into the grid as its own column group.
 * Three groups now: **ผู้อนุมัติ**, **แท็บตั้งค่า**, **หน้าใช้งาน**, each with
 * its own accent because they answer materially different questions — the first
 * is authority over money, the other two are sight of a screen.
 *
 * **The approver group is one column per ROLE, not one per person, and that is
 * where AP-4's shape needed correcting rather than copying.** See
 * `approver-columns.ts`: `AccAdvanceApprover` is unique on `(Email,
 * ApproverRole)` over three levels, so a single tick would have had to guess
 * which one it meant. AP-3 genuinely is one tick, because its roster has one
 * live role.
 *
 * **What it renders is derived, never retyped.** `advClrTabsForForm` reads the
 * form's own tab strip, `advClrMenusForForm` the menus' `form` field and
 * `advClrApproverColumnsForForm` the roster's roles — so the grid, the page's
 * tab strip and the form-scoped save cannot disagree about what this form owns.
 *
 * **Two things about the person list are still shared, and the copy says so.**
 * Adding somebody here adds them to the other form's list too, and ปิดสิทธิ์
 * switches off *both* forms' grants — `resolveAdvClrTabsByEmail` tests
 * `IsActive = 1`, so the flag is a property of the person, not of the form.
 * Only the ticks are per form. Leaving that unsaid would make ปิดสิทธิ์ on this
 * page look local when it is not, which is why it is now said twice: once in
 * the header and once in the confirm dialog, where the control actually is.
 *
 * **สถานะ does NOT touch either approver pool**, unlike AP-4's equivalent — see
 * `setAdvClrAccessActive`'s own docblock, which explains why. The approver
 * ticks in this same row are the control for that, and the approver panel below
 * shares their cache (`approver-roster.ts`) so the two can never show different
 * answers to the same question.
 *
 * **A row is never deleted, only switched off.** Deactivating leaves every tick
 * in place, so the grid keeps showing what that person still holds — an admin
 * needs to see it, and to set it up before switching them back on — and turning
 * them back on restores exactly that rather than a blank slate. Inactive rows
 * therefore stay listed: a grid that drops a row the moment its own button is
 * pressed is a dead end, which is the shape AP-4's equivalent had to be fixed
 * out of.
 */
export function AdvClrAccessSettings({ form }: { form: AdvClrForm }) {
  const { data, isLoading, error, mutate } = useSWR<{ ok: boolean; data?: AccessRosterRow[] }>(
    ENDPOINT,
    fetcher,
  );
  // The SAME key and the SAME fetcher the approver panel below uses, so a tick
  // on either control revalidates both — see `approver-roster.ts`.
  const roster = useSWR(approverRosterKey(form), fetchApproverRoster);

  const [adding, setAdding] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const menus = advClrMenusForForm(form);
  /**
   * **Grantable tabs only — the admin-only ones are NOT columns** (user,
   * 2026-09-22: *"ตัดช่อง สิทธิ์เข้าถึง ในตารางออก"*).
   *
   * `สิทธิ์เข้าถึง` is ungrantable, so its cell could only ever render `—`: a
   * column on a ticking screen that can never be ticked. It is also the very
   * tab this screen IS.
   *
   * **`Interface ERP` was in that sentence for half a day and is not any
   * more.** The user's first instruction read as "cut the column" and it was
   * cut; their second (*"ของ AP-3,4 ก็ต้อง เปิด check box ทุกอัน"*) asked for a
   * working checkbox instead, so `erpInterface` — `advanceErpInterface` /
   * `clearErpInterface`, one key per form now — became grantable and the
   * column came back on its own. **Nothing here changed to bring it back**,
   * which is the point of filtering on `adminOnly` rather than naming keys: a
   * tab that becomes grantable reappears as a column by itself, and one that
   * stops being grantable disappears the same way.
   *
   * **This diverges from AP-4's grid deliberately.** CLAUDE.md records the
   * opposite call there (2026-09-14) — list every tab, because an admin
   * looking for "who may open Interface ERP" should find the answer rather
   * than conclude the tab is missing. That need is real, so it is met by the
   * line under the table instead of by a dead column.
   *
   * **`advanceMessages` / `clearMessages` are excluded EXPLICITLY, from both
   * filters, since migration 166.** Neither carries `adminOnly` or `note` any
   * more — the tab genuinely is grantable now, just not through this table's
   * TabKey vocabulary at all: the grant is `AccAdvClrAccess.CanAdvanceMessage`
   * / `.CanClearMessage`, a column, and `MessageGrantCell` is its own bespoke
   * checkbox. Without the `t.key !== "…Messages"` guard, a message tab would
   * pass the `!t.adminOnly` test and land in `tabs`, where its tick would
   * render through `TabGrantCells` but never save — `GRANTABLE_ADV_CLR_TABS`,
   * which the payload is built from, still excludes it and always must (see
   * `@/lib/acc/message-grant`).
   */
  const tabs = advClrTabsForForm(form).filter(
    (t) => !t.adminOnly && t.key !== "advanceMessages" && t.key !== "clearMessages",
  );
  const adminOnlyTabs = advClrTabsForForm(form).filter(
    (t) => t.adminOnly && t.key !== "advanceMessages" && t.key !== "clearMessages",
  );
  const columns = advClrApproverColumnsForForm(form);
  const otherForm: AdvClrForm = form === "AP-2" ? "AP-3" : "AP-2";

  const accessRows = data?.ok && data.data ? data.data : [];
  const rosterOk = !!roster.data?.ok;
  const rows = buildAccessGridRows(accessRows, roster.data?.rows ?? [], columns);

  /* The สิทธิ์เข้าถึง denominator counts rows that HAVE an access row, not the
     whole union: an approver-only row can never be "เปิดใช้งาน" in that sense,
     so including it would make the fraction read low for a reason nothing on
     screen explains. */
  const accessTotal = rows.filter((r) => r.access).length;
  const accessActive = rows.filter((r) => r.access?.isActive).length;
  const approverActive = countActiveApprovers(rows, columns);

  const refresh = async () => {
    await Promise.all([mutate(), roster.mutate()]);
  };

  async function setActive(row: AccessGridRow, isActive: boolean) {
    if (!row.access) return;
    setBusyKey(row.key);
    try {
      const res = await fetch(ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId: row.access.staffId, isActive }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error ?? "อัปเดตไม่สำเร็จ");
      toast.success(isActive ? `เปิดสิทธิ์ ${row.displayName}` : `ปิดสิทธิ์ ${row.displayName}`);
      await mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "อัปเดตไม่สำเร็จ");
    } finally {
      setBusyKey(null);
    }
  }

  async function add(u: ADResult) {
    setAdding(false);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // No `settingsTabs`: a new row must grant nothing until an admin ticks
        // something. The route reads omitted and empty differently for exactly
        // this reason.
        body: JSON.stringify({ email: u.email, displayName: u.name }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error ?? "เพิ่มไม่สำเร็จ");
      toast.success(`เพิ่ม ${u.name} แล้ว — ยังไม่ได้ให้สิทธิ์ใด ๆ`);
      await mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "เพิ่มไม่สำเร็จ");
    }
  }

  /* Wide enough that no column collapses, and horizontally scrollable inside
     the card below that — AP-4's answer at narrow widths, matched rather than
     re-invented. Computed instead of hardcoded because the two forms have
     different column counts (AP-2 has three approver levels, AP-3 one). */
  // +1 for the Message column, which is not counted in `tabs` — see that
  // const's own comment for why it is excluded.
  const minWidth = 430 + 74 * (columns.length + tabs.length + menus.length + 1);
  const notes = tabs.filter((t) => t.note);
  const loadFailed = !!error || (!!data && !data.ok);

  return (
    <div className="flex flex-col gap-4">
      {/* The one commissioning state worth an alarm: nobody at all can approve,
          so every request of this form stops at its accounting step. Guarded on
          a SUCCESSFUL roster read — an unreadable list must not be reported as
          an empty one, which is the failure this whole file keeps closing. */}
      {rosterOk && !roster.isLoading && approverActive === 0 && (
        <div
          className="rounded-xl px-4 py-3 flex items-start gap-2.5"
          style={{ background: "var(--status-bad-bg)", color: "var(--status-bad-text)" }}
        >
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <p className="text-[12px] leading-relaxed m-0">
            ยังไม่มีผู้อนุมัติที่เปิดใช้งานเลยสักคน — คำขอ {form} ทุกใบจะค้างที่ขั้นอนุมัติ
            และไม่มีใครกดอนุมัติได้ กรุณาติ๊กช่อง <b>ผู้อนุมัติ</b> ให้อย่างน้อย 1 คน
          </p>
        </div>
      )}

      <div
        className="rounded-xl p-4"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
      >
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <ShieldCheck size={16} style={{ color: "var(--text-heading)" }} />
          <h2 className="text-[14px] font-bold flex-1 m-0" style={{ color: "var(--text-heading)" }}>
            สิทธิ์เข้าถึง ({form})
          </h2>
          <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
            เปิดใช้งาน {accessActive} / {accessTotal} คน · ผู้อนุมัติ{" "}
            {rosterOk ? `${approverActive} คน` : "—"}
          </span>
        </div>
        <p className="text-[11px] mb-1 leading-relaxed m-0" style={{ color: "var(--text-muted)" }}>
          หน้านี้รวมสองสิทธิ์ไว้ในที่เดียว — <b>ผู้อนุมัติ</b> คือสิทธิ์อนุมัติเงินจริงของ {form} ส่วน{" "}
          <b>แท็บตั้งค่า</b> และ <b>หน้าใช้งาน</b> ให้สิทธิ์ “เห็น” เท่านั้น ·
          IT Admin และ System Admin เห็นทุกแท็บและทุกหน้าอยู่แล้วโดยไม่ต้องอยู่ในรายชื่อนี้ ·{" "}
          <b>ติ๊กผู้อนุมัติกับติ๊กแท็บเป็นอิสระจากกัน</b> — ติ๊กแท็บ/หน้าใช้งานไม่ได้แปลว่าอนุมัติเงินได้
        </p>
        {/* The ticks split per form; the person list and its on/off switch did
            not. Saying so here is what keeps ปิดสิทธิ์ from looking local: it
            clears the other form's grants too, because IsActive is a property
            of the person. */}
        <p className="text-[11px] mb-3 leading-relaxed m-0" style={{ color: "var(--text-muted)" }}>
          รายชื่อผู้มีสิทธิ์เป็นชุดเดียวกับ {otherForm} — การ <b>เพิ่ม</b> และ <b>ปิด/เปิดสิทธิ์</b>{" "}
          มีผลกับทั้งสองฟอร์ม ส่วนการติ๊กแยกกันคนละหน้า · ช่อง <b>ผู้อนุมัติ</b> เป็นของ {form}{" "}
          เท่านั้น (คนละตารางกับ {otherForm})
        </p>

        <div className="mb-4">
          <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => setAdding(true)}>
            เพิ่มผู้มีสิทธิ์
          </Button>
        </div>

        {loadFailed ? (
          // Never render an unreadable list as "nobody has any grants": the next
          // tick would POST a one-element set and revoke the rest.
          <p
            className="text-[12px] m-0 px-3 py-2 rounded-lg"
            style={{
              background: "var(--bg-info-yellow)",
              color: "var(--text-info-yellow)",
              border: "1px solid var(--border-info-yellow)",
            }}
          >
            โหลดรายชื่อสิทธิ์เข้าถึงไม่สำเร็จ — กรุณารีเฟรชหน้านี้ก่อนแก้ไข
          </p>
        ) : isLoading ? (
          <div className="py-10 flex justify-center">
            <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-muted)" }} />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-[12px] py-8 text-center m-0" style={{ color: "var(--text-muted)" }}>
            ยังไม่มีใครในรายชื่อ — ผู้ดูแลระบบยังเข้าได้ทุกเมนูตามเดิม
          </p>
        ) : (
          <>
            {!roster.isLoading && !rosterOk && (
              <p
                className="text-[11px] mb-2 m-0 px-3 py-2 rounded-lg"
                style={{
                  background: "var(--bg-info-yellow)",
                  color: "var(--text-info-yellow)",
                  border: "1px solid var(--border-info-yellow)",
                }}
              >
                อ่านรายชื่อผู้อนุมัติ {form} ไม่สำเร็จ — ช่อง “ผู้อนุมัติ” แสดงเป็น — และแก้ไม่ได้
                จนกว่าจะรีเฟรช (ช่องแท็บและหน้าใช้งานยังแก้ได้ตามปกติ)
              </p>
            )}
            <p className="text-[11px] mb-1 m-0" style={{ color: "var(--color-warning)" }}>
              ติ๊ก <b>ผู้อนุมัติ</b> = อนุมัติเงินจริงได้ทันที · เอาติ๊กออก = ปิดการใช้งาน
              (ไม่ได้ลบออกจากรายชื่อ — ลบได้ที่รายชื่อผู้อนุมัติด้านล่าง)
            </p>
            <p className="text-[11px] mb-2 m-0" style={{ color: "var(--text-muted)" }}>
              ติ๊กแท็บที่ให้แก้ได้ — ถ้าไม่ติ๊กเลย จะยังเข้าหน้าตั้งค่าไม่ได้ · ช่องที่เป็น —
              คือให้สิทธิ์ไม่ได้ ชี้เพื่อดูเหตุผล
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]" style={{ minWidth }}>
                <thead>
                  {/* Group heading row. The three identity columns and สถานะ span
                      both rows; each grant group gets a labelled span above its
                      own checkbox columns so an admin reads "may approve", "may
                      open the settings tab" and "may open the working screen" as
                      three different questions, not one wide block of boxes. */}
                  <tr
                    style={{
                      borderBottom: "1px solid var(--border-light)",
                      background: "var(--bg-card-alt)",
                    }}
                  >
                    <th
                      rowSpan={2}
                      className="text-left px-4 py-2 font-semibold align-bottom"
                      style={{ color: "var(--text-muted)" }}
                    >
                      ชื่อ
                    </th>
                    <th
                      rowSpan={2}
                      className="text-left px-4 py-2 font-semibold align-bottom"
                      style={{ color: "var(--text-muted)" }}
                    >
                      อีเมล
                    </th>
                    <th
                      rowSpan={2}
                      className="text-left px-4 py-2 font-semibold align-bottom"
                      style={{ color: "var(--text-muted)" }}
                    >
                      รหัสพนักงาน
                    </th>
                    <th
                      colSpan={columns.length}
                      className="text-center px-3 py-1.5 font-semibold whitespace-nowrap"
                      style={{
                        color: "var(--color-warning)",
                        borderLeft: "1px solid var(--border-light)",
                      }}
                    >
                      ผู้อนุมัติ {form}
                    </th>
                    <th
                      colSpan={tabs.length}
                      className="text-center px-3 py-1.5 font-semibold whitespace-nowrap"
                      style={{
                        color: "var(--text-info-green)",
                        borderLeft: "1px solid var(--border-light)",
                      }}
                    >
                      แท็บตั้งค่า
                    </th>
                    <th
                      colSpan={menus.length}
                      className="text-center px-3 py-1.5 font-semibold whitespace-nowrap"
                      style={{
                        color: "var(--color-action)",
                        borderLeft: "1px solid var(--border-light)",
                      }}
                    >
                      หน้าใช้งาน
                    </th>
                    {/* Its own single-column header, `rowSpan={2}` like
                        เจ้าของฟอร์ม/สถานะ beside it, rather than a group of
                        one: the grant is AccAdvClrAccess.CanAdvanceMessage /
                        .CanClearMessage (migration 166), never a
                        tabs/menus entry — see MessageGrantCell and
                        @/lib/acc/message-grant. */}
                    <th
                      rowSpan={2}
                      className="text-center px-3 py-2 font-semibold align-bottom whitespace-nowrap"
                      style={{ color: "var(--text-muted)", borderLeft: "1px solid var(--border-light)" }}
                    >
                      Message
                    </th>
                    {/* Before สถานะ (the user, 2026-09-24), outside every grant
                        group: an owner grants nothing, so it must not read as
                        another kind of tick. **It is per FORM even though the
                        roster is shared** — AP-2's page writes AP-2's owners
                        and AP-3's writes AP-3's, which is the one thing on this
                        grid that is not common to both. See
                        `FormOwnerCheckbox`. */}
                    <th
                      rowSpan={2}
                      className="text-center px-4 py-2 font-semibold align-bottom whitespace-nowrap"
                      style={{ color: "var(--text-muted)", borderLeft: "1px solid var(--border-light)" }}
                    >
                      เจ้าของฟอร์ม
                    </th>
                    {/* Status and its control share one column: the badge
                        reports, the button acts. A badge that is also a button
                        reads as neither. */}
                    <th
                      rowSpan={2}
                      className="text-center px-4 py-2 font-semibold align-bottom"
                      style={{ color: "var(--text-muted)" }}
                    >
                      สถานะ
                    </th>
                  </tr>
                  <tr
                    style={{
                      borderBottom: "1px solid var(--border-light)",
                      background: "var(--bg-card-alt)",
                    }}
                  >
                    {columns.map((c, idx) => (
                      <th
                        key={c.role}
                        className="text-center px-3 py-2 font-semibold whitespace-nowrap"
                        title={c.hint}
                        style={{
                          color: "var(--text-muted)",
                          ...(idx === 0 ? { borderLeft: "1px solid var(--border-light)" } : {}),
                        }}
                      >
                        {c.short}
                      </th>
                    ))}
                    {/* EVERY settings tab on this form's strip, in the page's own
                        order — not only the grantable ones (user, 2026-09-14:
                        the group showed some of them and read as incomplete).
                        The ones that cannot be handed out render greyed here and
                        as a dash below, with the reason on hover, because an
                        admin looking for "who may open Interface ERP" should
                        find the answer on this screen rather than conclude the
                        tab is missing. */}
                    {tabs.map((tab, idx) => (
                      <th
                        key={tab.key}
                        className="text-center px-3 py-2 font-semibold whitespace-nowrap"
                        title={tab.adminOnly ? `ให้สิทธิ์ไม่ได้ — ${tab.adminOnly}` : tab.note}
                        style={{
                          color: tab.adminOnly ? "var(--text-faint)" : "var(--text-muted)",
                          ...(idx === 0 ? { borderLeft: "1px solid var(--border-light)" } : {}),
                        }}
                      >
                        {tab.label}
                        {tab.note && <sup style={{ color: "var(--color-warning)" }}>*</sup>}
                      </th>
                    ))}
                    {menus.map((menu, idx) => (
                      <th
                        key={menu.key}
                        className="text-center px-3 py-2 font-semibold whitespace-nowrap"
                        style={{
                          color: "var(--text-muted)",
                          ...(idx === 0 ? { borderLeft: "1px solid var(--border-light)" } : {}),
                        }}
                      >
                        {menu.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => (
                    <tr
                      key={r.key}
                      className="transition-colors hover:!bg-[var(--bg-row-hover)]"
                      style={{
                        borderBottom: "1px solid var(--border-light)",
                        background: idx % 2 === 1 ? "var(--bg-row-stripe)" : undefined,
                      }}
                    >
                      <td className="px-4 py-2.5 font-medium" style={{ color: "var(--text-primary)" }}>
                        {r.displayName}
                        {/* An approver with no AccAdvClrAccess row — unioned in
                            by buildAccessGridRows so this screen never hides a real
                            approval grant. Named beside the identity it
                            qualifies rather than in the สถานะ column, where it
                            would read as a second status. */}
                        {!r.access && (
                          <span
                            className="block text-[10px] font-normal mt-0.5"
                            style={{ color: "var(--text-faint)" }}
                          >
                            ยังไม่อยู่ในรายชื่อสิทธิ์เข้าถึง — เป็นผู้อนุมัติเท่านั้น
                          </span>
                        )}
                        {r.access && !r.access.isActive && (
                          <span
                            className="text-[10px] font-semibold ml-2 px-1.5 py-0.5 rounded"
                            style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}
                          >
                            ปิดอยู่
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5" style={{ color: "var(--text-muted)" }}>
                        {r.email}
                      </td>
                      <td className="px-4 py-2.5" style={{ color: "var(--text-muted)" }}>
                        {r.staffId ?? "—"}
                      </td>
                      <ApproverCells
                        form={form}
                        row={r}
                        columns={columns}
                        rosterOk={rosterOk}
                        onSaved={refresh}
                      />
                      {/* Ticks render on every row, active or not. Deactivating
                          does not delete grant rows — resolveAdvClrTabsByEmail
                          filters IsActive = 1, so access stops immediately and
                          comes back exactly as it was on reactivation. Hiding
                          the ticks would leave an admin unable to see what a
                          deactivated person still holds, or to set it up before
                          switching them on. */}
                      <TabGrantCells
                        form={form}
                        row={r}
                        tabs={tabs}
                        menus={menus}
                        onSaved={refresh}
                      />
                      <MessageGrantCell form={form} row={r} onSaved={refresh} />
                      {/* Ticked for a row with no สิทธิ์เข้าถึง row at all, and
                          for one that is switched off: this is not access, so
                          neither state is a reason to stop telling requesters
                          to ask them. */}
                      <td className="px-4 py-2.5" style={{ borderLeft: "1px solid var(--border-light)" }}>
                        <FormOwnerCheckbox
                          formCode={form}
                          email={r.email}
                          displayName={r.displayName}
                          staffId={r.staffId}
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        {!r.access ? (
                          <div className="flex items-center justify-center">
                            <span
                              className="text-[12px]"
                              style={{ color: "var(--text-faint)" }}
                              title="ยังไม่มีแถวสิทธิ์เข้าถึง — ติ๊กแท็บหรือหน้าใช้งานสักช่องเพื่อสร้าง"
                            >
                              —
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-2">
                            <span
                              className="text-[10px] font-bold px-2 py-0.5 rounded"
                              style={
                                r.access.isActive
                                  ? { background: "var(--status-ok-bg)", color: "var(--status-ok-text)" }
                                  : { background: "var(--bg-badge)", color: "var(--text-muted)" }
                              }
                            >
                              {r.access.isActive ? "ใช้งาน" : "ปิด"}
                            </span>
                            <button
                              type="button"
                              disabled={busyKey === r.key}
                              onClick={() => {
                                if (!r.access?.isActive) {
                                  void setActive(r, true);
                                  return;
                                }
                                setConfirmAction({
                                  title: "ปิดสิทธิ์เข้าถึง",
                                  // The shared-roster consequence, said where
                                  // the control is. IsActive is a property of
                                  // the person, not of the form, so this button
                                  // on a page headed AP-2 also revokes AP-3.
                                  message: `ปิดสิทธิ์เข้าถึงของ ${r.displayName} (${r.email})? จะเข้าแท็บตั้งค่าและหน้าใช้งานของ ${form} ไม่ได้ และ มีผลกับ ${otherForm} ด้วย เพราะเป็นรายชื่อชุดเดียวกัน (ช่องที่ติ๊กไว้ยังอยู่ครบ ถ้าเปิดกลับจะได้เท่าเดิม) · สิทธิ์อนุมัติในช่อง “ผู้อนุมัติ” ไม่ถูกแตะต้อง`,
                                  onConfirm: () => {
                                    setConfirmAction(null);
                                    void setActive(r, false);
                                  },
                                });
                              }}
                              className="inline-flex items-center justify-center rounded-full border-none shrink-0 enabled:cursor-pointer disabled:cursor-default disabled:opacity-70"
                              style={
                                r.access.isActive
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
                              title={r.access.isActive ? "ปิดการใช้งาน" : "เปิดใช้งาน"}
                              aria-label={
                                r.access.isActive
                                  ? `ปิดการใช้งาน ${r.displayName}`
                                  : `เปิดใช้งาน ${r.displayName}`
                              }
                            >
                              {busyKey === r.key ? (
                                <Loader2 size={13} className="animate-spin" />
                              ) : r.access.isActive ? (
                                <UserX size={13} />
                              ) : (
                                <UserCheck size={13} />
                              )}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* `note` is what a label can no longer say now that the
                `(AP-2 + AP-3)` suffixes are gone: แบรนด์ที่เบิกได้ is granted
                from AP-2's page and still reaches both forms' claimable brands,
                because there is one switch behind it.

                A table head has no room for that, and a `title` alone hides it
                from anyone not hovering — so the notes are printed under the
                table and marked with * in the header. */}
            {notes.length > 0 && (
              <div className="mt-2 flex flex-col gap-0.5">
                {notes.map((t) => (
                  <p key={t.key} className="text-[10px] m-0" style={{ color: "var(--text-faint)" }}>
                    <span style={{ color: "var(--color-warning)" }}>*</span> {t.label} — {t.note}
                  </p>
                ))}
              </div>
            )}

            {/* The admin-only tabs are no longer columns (see `tabs` above), so
                they are named here instead. Without this an admin asking "who
                may open Interface ERP?" finds no row, no column and no answer,
                and reasonably concludes the tab has been removed — which is
                exactly the complaint AP-4's grid was changed to fix on
                2026-09-14. One line costs nothing and keeps that answerable. */}
            {adminOnlyTabs.length > 0 && (
              <p className="text-[10px] mt-2 m-0" style={{ color: "var(--text-faint)" }}>
                {adminOnlyTabs.map((t) => t.label).join(" · ")} — เปิดได้เฉพาะ IT Admin และ
                System Admin จึงไม่มีในตารางนี้
              </p>
            )}
          </>
        )}
      </div>

      {adding && (
        <ADSearchModal
          title="เพิ่มผู้มีสิทธิ์เข้าถึง"
          subtitle={`ค้นหาจาก Azure AD — เพิ่มแล้วยังไม่ได้สิทธิ์ใด ๆ จนกว่าจะติ๊ก · รายชื่อใช้ร่วมกับ ${otherForm}`}
          existingEmails={rows.map((r) => r.email)}
          onClose={() => setAdding(false)}
          onSelect={(u) => void add(u)}
        />
      )}

      {/* The shared Dialog rather than a hand-rolled overlay: AP-4's panel
          predates it and carries its own copy, which is not a reason to add a
          third. */}
      <Dialog
        open={!!confirmAction}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        title={confirmAction?.title ?? ""}
        contentClassName="max-w-md"
      >
        <p className="text-[12px] leading-relaxed m-0" style={{ color: "var(--text-muted)" }}>
          {confirmAction?.message}
        </p>
        <div className="flex gap-2 mt-4">
          <Button variant="secondary" size="md" className="flex-1" onClick={() => setConfirmAction(null)}>
            ยกเลิก
          </Button>
          <Button
            variant="danger"
            size="md"
            className="flex-1"
            onClick={() => confirmAction?.onConfirm()}
          >
            ยืนยัน
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
