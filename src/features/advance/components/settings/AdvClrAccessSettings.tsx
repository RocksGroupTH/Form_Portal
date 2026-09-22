"use client";

import { useState } from "react";
import useSWR from "swr";
import { Plus, ShieldCheck, Save, UserX, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { ADSearchModal, type ADResult } from "@/components/settings/ADSearchModal";
import {
  advClrMenusForForm,
  advClrTabsForForm,
  filterAdvClrKeysForForm,
  type AdvClrForm,
} from "@/lib/adv/settings-tabs";

const ENDPOINT = "/api/request/advance/settings/access";
const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface AccessRow {
  id: number;
  staffId: number;
  email: string;
  displayName: string;
  isActive: boolean;
  settingsTabs: string[];
}

/**
 * Who may open which of ONE form's settings tabs and working menus.
 *
 * **One roster for both forms, one screen each** (`AccAdvClrAccess`, migration
 * 152 — the user's decision, 2026-09-14). The table carries no `FormCode` and
 * still does not; what changed on 2026-09-22, on the user's instruction
 * (*"สิทธิ์เข้าถึง AP-2 จะใช้แค่ AP-2 เท่านั้น..."*), is that this panel takes the
 * form it is rendered for and shows only that form's keys. Both pages still
 * call one endpoint, which is correct — these are shared master tables written
 * through `writeBothPools`, so which database a request resolves cannot matter.
 *
 * **What it renders is derived, never retyped.** `advClrTabsForForm` reads the
 * form's own tab strip and `advClrMenusForForm` the menus' `form` field, so the
 * grid, the page's tab strip and the form-scoped save cannot disagree about
 * what this form owns.
 *
 * **Two things about the person list are still shared, and the copy says so.**
 * Adding somebody here adds them to the other form's list too, and ปิดสิทธิ์
 * switches off *both* forms' grants — `resolveAdvClrTabsByEmail` tests
 * `IsActive = 1`, so the flag is a property of the person, not of the form.
 * Only the ticks are per form. Leaving that unsaid would make ปิดสิทธิ์ on this
 * page look local when it is not.
 *
 * **It grants sight, never authority.** Who may actually approve is
 * `AccAdvanceApprover` / `AccClearAdvanceApprover`, edited by the panel beside
 * this one on the same tab and re-decided where the money moves. Somebody with
 * `advanceQueue` and no approver row sees the queue and can act on nothing in
 * it — that is the split this roster exists for, and the copy below says so out
 * loud rather than leaving an admin to infer it.
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
  const { data, isLoading, error, mutate } = useSWR<{ ok: boolean; data?: AccessRow[] }>(
    ENDPOINT,
    fetcher,
  );
  const rows = data?.ok && data.data ? data.data : [];
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  /** Ticks being edited, keyed on StaffId. Absent = show what is saved. */
  const [draft, setDraft] = useState<Record<number, string[]>>({});

  const menus = advClrMenusForForm(form);
  const tabs = advClrTabsForForm(form);
  const otherForm: AdvClrForm = form === "AP-2" ? "AP-3" : "AP-2";

  /**
   * The draft carries BOTH forms' keys — it starts from the saved row, which
   * is deliberately wide — and only this form's are rendered, so only this
   * form's can change. The other form's ride along untouched and are filtered
   * off at the POST.
   */
  const keysOf = (row: AccessRow) => draft[row.staffId] ?? row.settingsTabs;
  /**
   * Dirty is measured on THIS form's keys alone. Comparing the whole list would
   * call a row dirty because a revalidation brought back a change somebody else
   * made to the other form — a Save button lit by an edit this screen cannot
   * even see.
   */
  const dirty = (row: AccessRow) => {
    const a = filterAdvClrKeysForForm(keysOf(row), form);
    const b = filterAdvClrKeysForForm(row.settingsTabs, form);
    return a.length !== b.length || a.some((k) => b.indexOf(k) === -1);
  };

  function toggle(row: AccessRow, key: string, on: boolean) {
    const cur = keysOf(row);
    const next = on ? (cur.indexOf(key) === -1 ? cur.concat([key]) : cur) : cur.filter((k) => k !== key);
    setDraft((p) => ({ ...p, [row.staffId]: next }));
  }

  async function save(row: AccessRow) {
    setBusy(row.staffId);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: row.email,
          displayName: row.displayName,
          // Echoed so a save never silently reactivates somebody: the route
          // treats an absent flag as "leave it alone", and this keeps the two
          // readings the same whichever way that rule later moves.
          isActive: row.isActive,
          // Only this form's keys go on the wire. The service narrows again on
          // arrival, but sending the other form's here would make that a silent
          // drop rather than a second line of defence.
          settingsTabs: filterAdvClrKeysForForm(keysOf(row), form),
          // Which half of the roster this replaces. The route refuses a save
          // that does not name one rather than guessing.
          form,
        }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error ?? "บันทึกไม่สำเร็จ");
      toast.success(`บันทึกสิทธิ์ของ ${row.displayName} แล้ว`);
      setDraft((p) => { const n = { ...p }; delete n[row.staffId]; return n; });
      await mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  }

  async function setActive(row: AccessRow, isActive: boolean) {
    setBusy(row.staffId);
    try {
      const res = await fetch(ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId: row.staffId, isActive }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error ?? "อัปเดตไม่สำเร็จ");
      toast.success(isActive ? `เปิดสิทธิ์ ${row.displayName}` : `ปิดสิทธิ์ ${row.displayName}`);
      await mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "อัปเดตไม่สำเร็จ");
    } finally {
      setBusy(null);
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

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl px-4 py-3 flex flex-wrap items-start justify-between gap-3"
        style={{ background: "var(--nav-active-bg)", border: "1px solid var(--border-card)" }}>
        <div className="flex-1 min-w-[240px]">
          <p className="text-[13px] font-semibold m-0 flex items-center gap-1.5" style={{ color: "var(--text-heading)" }}>
            <ShieldCheck size={15} style={{ color: "var(--nav-active-text)" }} /> สิทธิ์เข้าถึง ({form})
          </p>
          <p className="text-[11px] m-0 mt-1" style={{ color: "var(--text-muted)" }}>
            ติ๊กได้เฉพาะเมนูและแท็บตั้งค่าของ {form} ·
            <b> ให้สิทธิ์ “เห็น” เท่านั้น</b> — สิทธิ์อนุมัติเงินอยู่ที่รายชื่อผู้อนุมัติด้านล่าง
          </p>
          {/* The ticks split per form; the person list and its on/off switch did
              not. Saying so here is what keeps ปิดสิทธิ์ from looking local: it
              clears the other form's grants too, because IsActive is a property
              of the person. */}
          <p className="text-[11px] m-0 mt-1" style={{ color: "var(--text-muted)" }}>
            รายชื่อผู้มีสิทธิ์เป็นชุดเดียวกับ {otherForm} — การ <b>เพิ่ม</b> และ <b>ปิด/เปิดสิทธิ์</b>{" "}
            มีผลกับทั้งสองฟอร์ม ส่วนการติ๊กแยกกันคนละหน้า
          </p>
        </div>
        <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => setAdding(true)}>
          เพิ่มผู้มีสิทธิ์
        </Button>
      </div>

      {error || (data && !data.ok) ? (
        // Never render an unreadable list as "nobody has any grants": the next
        // tick would POST a one-element set and revoke the rest.
        <p className="text-[12px] m-0 px-3 py-2 rounded-lg"
          style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}>
          โหลดรายชื่อสิทธิ์เข้าถึงไม่สำเร็จ — กรุณารีเฟรชหน้านี้ก่อนแก้ไข
        </p>
      ) : isLoading ? (
        <p className="text-[13px] py-8 text-center m-0" style={{ color: "var(--text-muted)" }}>กำลังโหลด...</p>
      ) : rows.length === 0 ? (
        <p className="text-[12px] py-8 text-center m-0" style={{ color: "var(--text-muted)" }}>
          ยังไม่มีใครในรายชื่อ — ผู้ดูแลระบบยังเข้าได้ทุกเมนูตามเดิม
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row) => {
            const keys = keysOf(row);
            const has = (k: string) => keys.indexOf(k) !== -1;
            return (
              <div key={row.staffId} className="rounded-xl p-4 flex flex-col gap-3"
                style={{
                  background: "var(--bg-card-alt)",
                  border: `1px solid ${dirty(row) ? "var(--border-info-yellow)" : "var(--border-card)"}`,
                  opacity: row.isActive ? 1 : 0.6,
                }}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-[13px] font-bold m-0 truncate" style={{ color: "var(--text-heading)" }}>
                      {row.displayName}
                      {!row.isActive && (
                        <span className="text-[10px] font-semibold ml-2 px-1.5 py-0.5 rounded"
                          style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}>ปิดอยู่</span>
                      )}
                    </p>
                    <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>{row.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm"
                      icon={row.isActive ? <UserX size={14} /> : <UserCheck size={14} />}
                      disabled={busy === row.staffId}
                      onClick={() => void setActive(row, !row.isActive)}>
                      {row.isActive ? "ปิดสิทธิ์" : "เปิดสิทธิ์"}
                    </Button>
                    <Button variant="primary" size="sm" icon={<Save size={14} />}
                      loading={busy === row.staffId}
                      disabled={busy === row.staffId || !dirty(row)}
                      onClick={() => void save(row)}>บันทึก</Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3"
                  style={{ borderTop: "1px solid var(--border-light)" }}>
                  <TickGroup
                    label={`เมนู ${form}`}
                    hint="เห็นหน้าคิว/รายงาน — ไม่ได้แปลว่าอนุมัติได้"
                    items={menus}
                    has={has}
                    onToggle={(k, on) => toggle(row, k, on)}
                  />
                  <TickGroup
                    label={`แท็บตั้งค่า ${form}`}
                    hint="ทุกแท็บของหน้านี้อยู่ครบ — อันที่จางคือให้สิทธิ์ไม่ได้ ชี้เพื่อดูเหตุผล"
                    items={tabs}
                    has={has}
                    onToggle={(k, on) => toggle(row, k, on)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {adding && (
        <ADSearchModal
          title="เพิ่มผู้มีสิทธิ์เข้าถึง"
          subtitle={`ค้นหาจาก Azure AD — เพิ่มแล้วยังไม่ได้สิทธิ์ใด ๆ จนกว่าจะติ๊ก · รายชื่อใช้ร่วมกับ ${otherForm}`}
          existingEmails={rows.map((r) => r.email)}
          onClose={() => setAdding(false)}
          onSelect={(u) => void add(u)}
        />
      )}
    </div>
  );
}

/**
 * One group of ticks.
 *
 * **Every tab is listed, including the ones that can never be granted** (user,
 * 2026-09-14: the column showed four of eight and read as incomplete). Those
 * render disabled, greyed, with the reason on hover — more honest than omitting
 * them, since an admin looking for "who may open Interface ERP" should find the
 * answer here rather than conclude the tab is missing. Nothing about
 * enforcement changes: `filterStorableAdvClrKeys` still refuses to write them
 * and `decideAdvClrTabAccess` still refuses to open them for a non-admin, so a
 * disabled box is a statement rather than the only thing stopping a grant.
 *
 * **Every tab shown is one THIS page has** — the caller passes the form's own
 * strip. The two tabs both pages carry, Interface ERP and สิทธิ์เข้าถึง, are on
 * both strips and so appear on both grids, which is what keeps the property
 * above true on each of them.
 *
 * `note` is what a label can no longer say now that the `(AP-2 + AP-3)`
 * suffixes are gone: แบรนด์ที่เบิกได้ is granted from AP-2's page and still
 * reaches both forms' claimable brands, because there is one switch behind it.
 */
function TickGroup({ label, hint, items, has, onToggle }: {
  label: string;
  hint: string;
  items: readonly { key: string; label: string; adminOnly?: string; note?: string }[];
  has: (key: string) => boolean;
  onToggle: (key: string, on: boolean) => void;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wide m-0" style={{ color: "var(--text-faint)" }}>{label}</p>
      <p className="text-[10px] m-0 mb-2" style={{ color: "var(--text-faint)" }}>{hint}</p>
      <div className="flex flex-col gap-1.5">
        {items.map((it) => (
          <div key={it.key} className="min-w-0">
            <label
              className={`flex items-center gap-2 text-[12px] ${it.adminOnly ? "cursor-not-allowed" : "cursor-pointer"}`}
              title={it.adminOnly ? `ให้สิทธิ์ไม่ได้ — ${it.adminOnly}` : undefined}
              style={{ color: it.adminOnly ? "var(--text-faint)" : "var(--text-secondary)" }}>
              <input type="checkbox" checked={!it.adminOnly && has(it.key)}
                disabled={!!it.adminOnly}
                onChange={(e) => onToggle(it.key, e.target.checked)} />
              {it.label}
              {it.adminOnly && (
                <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                  style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}>
                  ผู้ดูแลระบบ
                </span>
              )}
            </label>
            {it.note && (
              <p className="text-[10px] m-0 ml-[22px]" style={{ color: "var(--text-faint)" }}>
                {it.note}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
