"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { AlertTriangle, Check, Loader2, Plus, ShieldCheck, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { ADSearchModal, type ADResult } from "@/components/settings/ADSearchModal";
import { GRANTABLE_BOOKING_TABS, GRANTABLE_BOOKING_MENUS } from "@/lib/acc/travel-booking/settings-tabs";

const ENDPOINT = "/api/request/travel-booking/settings/approvers";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface BookingApproverRow {
  id: number;
  staffId: number;
  email: string;
  displayName: string;
  isActive: boolean;
  settingsTabs: string[];
  /** null = every brand. There is no "no brands" — see booking-brand-access-shared.ts. */
  brandCodes: string[] | null;
}

/* ── Confirm Modal — same shape as the UAT Users panel's ── */
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
 * One checkbox per entry in `GRANTABLE_BOOKING_TABS`, which is also what the
 * settings page builds its tab strip from — so the columns and the tabs cannot
 * drift, and the tab that hands out access (`access`) can never appear among
 * them. A non-admin who could open it would grant themselves the rest.
 *
 * `GRANTABLE_BOOKING_MENUS` — the booking-queue and account-approval work
 * queues — is a separate vocabulary stored in the same `AccBookingApproverTab`
 * rows. `settings-tabs.ts` keeps the two apart for authorization
 * (`isGrantableBookingTabKey` refuses a menu key, `isBookingMenuKey` refuses a
 * tab key), but for *display and save* here they are one combined grant set:
 * a single checked-state and a single POST, or a save that touched only one
 * half would replace the stored row and silently erase the other half —
 * `setBookingApproverTabs` replaces the granted set, it does not merge.
 */
function TabGrantCheckbox({
  checked,
  saving,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  saving: boolean;
  onChange: () => void;
  ariaLabel: string;
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
        background: checked ? "var(--text-info-green)" : "var(--bg-card)",
        boxShadow: checked
          ? "0 0 0 2px color-mix(in srgb, var(--text-info-green) 28%, transparent)"
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

// The whole grant vocabulary this panel can tick, tabs first then menus — the
// order the columns render in, and the order posted so what is stored never
// depends on which box happened to be ticked last.
const ALL_GRANT_COLUMNS: readonly { key: string; label: string }[] = [
  ...GRANTABLE_BOOKING_TABS,
  ...GRANTABLE_BOOKING_MENUS,
];

/**
 * One approver's brand scope.
 *
 * **No rows means every brand**, so the resting state reads "ทุกแบรนด์" rather
 * than an empty set of ticks — the opposite of the grant columns beside it,
 * where empty means none. Unticking everything therefore restores full access
 * rather than removing it, which is why the dialog says so.
 */
function BrandScopeCell({
  row,
  onSaved,
}: {
  row: BookingApproverRow;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(row.brandCodes ?? []));
  const { data: brandData } = useSWR<{ ok: boolean; data?: { brandCode: string; isActive: boolean }[] }>(
    open ? "/api/request/travel-booking/settings/brands" : null,
    (url: string) => fetch(url).then((r) => r.json()),
  );

  useEffect(() => {
    setPicked(new Set(row.brandCodes ?? []));
  }, [row.id, row.brandCodes]);

  const brands = brandData?.data ?? [];

  const save = async () => {
    setSaving(true);
    try {
      const codes = Array.from(picked);
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: row.email,
          displayName: row.displayName,
          isActive: row.isActive,
          // Nothing ticked posts null, which CLEARS the scope — every brand.
          // Posting [] would mean the same thing server-side, but saying null
          // here keeps the intent readable in a network log.
          brandCodes: codes.length > 0 ? codes : null,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error ?? "บันทึกไม่สำเร็จ");
        return;
      }
      setOpen(false);
      onSaved();
    } catch {
      toast.error("บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  const label =
    row.brandCodes === null || row.brandCodes.length === 0
      ? "ทุกแบรนด์"
      : row.brandCodes.join(", ");

  return (
    <td className="px-3 py-2.5 text-center">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] font-semibold rounded-lg px-2.5 py-1.5 cursor-pointer whitespace-nowrap"
        style={{
          background: row.brandCodes === null ? "var(--bg-card-alt)" : "var(--nav-active-bg)",
          color: row.brandCodes === null ? "var(--text-muted)" : "var(--nav-active-text)",
          border: "1px solid var(--border-card)",
        }}
      >
        {label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.35)" }}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-5 flex flex-col gap-3 text-left"
            style={{ background: "var(--bg-card)", boxShadow: "var(--shadow-card)" }}
          >
            <h3 className="text-[15px] font-bold m-0" style={{ color: "var(--text-heading)" }}>
              แบรนด์ที่ {row.displayName || row.email} เห็น
            </h3>
            <p className="text-[12px] leading-relaxed m-0" style={{ color: "var(--text-muted)" }}>
              ไม่ติ๊กเลย = เห็น<strong>ทุกแบรนด์</strong> · ติ๊กบางอัน = เห็นเฉพาะที่ติ๊ก ·
              มีผลกับคิวจอง คิวบัญชี รายงาน และการกดอนุมัติ
            </p>
            <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
              {brands.length === 0 ? (
                <span className="text-[12px]" style={{ color: "var(--text-faint)" }}>
                  กำลังโหลด...
                </span>
              ) : (
                brands.map((b) => (
                  <label
                    key={b.brandCode}
                    className="flex items-center gap-2 text-[13px] cursor-pointer rounded-lg px-2 py-1.5"
                    style={{ color: "var(--text-primary)", background: "var(--bg-card-alt)" }}
                  >
                    <input
                      type="checkbox"
                      checked={picked.has(b.brandCode)}
                      onChange={() => {
                        const next = new Set(picked);
                        if (next.has(b.brandCode)) next.delete(b.brandCode);
                        else next.add(b.brandCode);
                        setPicked(next);
                      }}
                    />
                    {b.brandCode}
                    {!b.isActive && (
                      <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
                        (ปิดใช้งานอยู่)
                      </span>
                    )}
                  </label>
                ))
              )}
            </div>
            <div className="flex items-center gap-2 justify-end">
              <button
                type="button"
                onClick={() => {
                  setPicked(new Set(row.brandCodes ?? []));
                  setOpen(false);
                }}
                className="text-[13px] font-semibold rounded-xl px-4 py-2 cursor-pointer"
                style={{
                  background: "var(--bg-card-alt)",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border-card)",
                }}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="text-[13px] font-semibold rounded-xl px-4 py-2 cursor-pointer"
                style={{ background: "var(--color-action)", color: "#fff", opacity: saving ? 0.6 : 1 }}
              >
                บันทึก
              </button>
            </div>
          </div>
        </div>
      )}
    </td>
  );
}

function TabGrantCells({
  row,
  onSaved,
}: {
  row: BookingApproverRow;
  onSaved: () => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(row.settingsTabs));
  const [saving, setSaving] = useState(false);

  // The server's answer is the truth; re-seed whenever SWR brings a new one.
  useEffect(() => {
    setChecked(new Set(row.settingsTabs));
  }, [row.id, row.settingsTabs]);

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
          // The whole granted set — settings tabs AND the two menu grants —
          // travels together in one POST. `setBookingApproverTabs` replaces
          // the stored set rather than merging it, so posting only the tab
          // half (or only the menu half) would silently erase the other half
          // of whatever this person already held.
          settingsTabs: ALL_GRANT_COLUMNS.filter((t) => next.has(t.key)).map((t) => t.key),
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
      {GRANTABLE_BOOKING_TABS.map((tab) => (
        <td key={tab.key} className="px-3 py-2.5 text-center">
          <TabGrantCheckbox
            checked={checked.has(tab.key)}
            saving={saving}
            onChange={() => void toggle(tab.key)}
            ariaLabel={`${row.displayName || row.email} — ${tab.label}`}
          />
        </td>
      ))}
      {GRANTABLE_BOOKING_MENUS.map((menu) => (
        <td key={menu.key} className="px-3 py-2.5 text-center">
          <TabGrantCheckbox
            checked={checked.has(menu.key)}
            saving={saving}
            onChange={() => void toggle(menu.key)}
            ariaLabel={`${row.displayName || row.email} — ${menu.label}`}
          />
        </td>
      ))}
    </>
  );
}

/**
 * AP-17's สิทธิ์เข้าถึง tab — who may see the booking queue and the booking
 * report.
 *
 * Deliberately a separate roster from AP-1's ผู้อนุมัติบัญชี: arranging hotels is
 * not approving expense claims. It is also, unusually, a list that starts
 * **empty**, and an empty list is not a neutral state once the gate is on — it
 * hides the queue and the report from everyone who is not an admin. So the
 * empty case gets a standing notice rather than the usual grey "nothing here
 * yet" line: it is a configuration an admin needs explained, not discovered.
 *
 * Table shape follows `UatUserSettings`: one สถานะ column in which the badge
 * reports the state and the round button beside it performs the single
 * available action. Deactivation is a soft delete — rows are never removed, so
 * the history of who could see what stays readable.
 *
 * Between the two sit the settings-tab grant columns and, grouped under their
 * own "เมนูที่เห็น" heading, the two work-queue menu grant columns. They are
 * only offered on an **active** row: the save behind a tick is the same
 * upsert that adds a person, so ticking a box on a deactivated row would
 * quietly restore them, and their grants are inert while they are off anyway.
 */
export function BookingApproverSettings() {
  const {
    data,
    error: fetchError,
    mutate,
    isLoading,
  } = useSWR<{
    ok: boolean;
    data: BookingApproverRow[];
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
  // A rejected fetch has to reach `loadError` too, not just an `ok: false` body.
  // Without it SWR leaves `data` undefined and `isLoading` false, `rows` is []
  // and the standing notice below announces "ยังไม่มีผู้มีสิทธิ์เข้าถึง — คิวจอง
  // และรายงานจะไม่แสดงกับใครเลย" on the strength of knowing nothing. An empty
  // roster and an unreadable one look identical from here and mean opposite
  // things, and once the gate is wired that banner is an alarm people act on.
  const loadError = fetchError
    ? fetchError instanceof Error
      ? fetchError.message
      : "โหลดข้อมูลไม่สำเร็จ"
    : data && !data.ok
      ? data.error ?? "โหลดข้อมูลไม่สำเร็จ"
      : null;
  const activeCount = rows.filter((r) => r.isActive).length;

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
      {/* ── The standing notice. Reachable right now, and the state this page
          ships in: nothing is broken, but nobody outside IT/System Admin can
          reach the booking queue or the report until someone is added. ── */}
      {!isLoading && !loadError && activeCount === 0 && (
        <div
          className="rounded-xl px-4 py-3 flex items-start gap-2.5"
          style={{ background: "var(--status-bad-bg)", color: "var(--status-bad-text)" }}
        >
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <p className="text-[12px] leading-relaxed">
            ยังไม่มีผู้มีสิทธิ์เข้าถึง — คิวจองและรายงานจะไม่แสดงกับใครเลย
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
            เปิดใช้งาน {activeCount} / {rows.length} คน
          </span>
        </div>
        <p className="text-[11px] mb-3" style={{ color: "var(--text-muted)" }}>
          ผู้ที่อยู่ในรายชื่อนี้จะเห็นคิวจอง (Admin) และรายงานของแบบฟอร์มขอเดินทาง (AP-17)
          — แยกจากรายชื่อผู้อนุมัติบัญชีของ AP-1
        </p>

        <div className="mb-4">
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-2 rounded-lg cursor-pointer border-none"
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
            existingEmails={rows.filter((r) => r.isActive).map((r) => r.email)}
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
          <p className="text-[11px] mb-2" style={{ color: "var(--text-muted)" }}>
            ผู้อนุมัติที่ไม่ใช่แอดมินจะเห็นเฉพาะแท็บและเมนูที่ติ๊กให้
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] min-w-[980px]">
              <thead>
                <tr
                  style={{
                    background: "var(--bg-card-header)",
                  }}
                >
                  <th
                    rowSpan={2}
                    className="text-left px-4 py-2 font-semibold align-bottom"
                    style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border-light)" }}
                  >
                    ชื่อ
                  </th>
                  <th
                    rowSpan={2}
                    className="text-left px-4 py-2 font-semibold align-bottom"
                    style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border-light)" }}
                  >
                    อีเมล
                  </th>
                  <th
                    rowSpan={2}
                    className="text-left px-4 py-2 font-semibold align-bottom"
                    style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border-light)" }}
                  >
                    รหัสพนักงาน
                  </th>
                  {/* Group heading for the settings-tab columns below — no text
                      of its own, since the tab strip already names each one and
                      "แท็บตั้งค่า" would only repeat that. */}
                  <th
                    colSpan={GRANTABLE_BOOKING_TABS.length}
                    className="text-center px-3 py-1 font-semibold"
                    style={{ color: "var(--text-faint)", borderBottom: "1px solid var(--border-light)" }}
                  />
                  {/* The two work-queue menu grants get their own heading so an
                      admin can tell a menu grant from a settings grant at a
                      glance — they are a different vocabulary, stored in the
                      same rows, and mean "sees this queue", not "may configure
                      this". */}
                  <th
                    colSpan={GRANTABLE_BOOKING_MENUS.length}
                    className="text-center px-3 py-1 font-semibold whitespace-nowrap"
                    style={{ color: "var(--text-faint)", borderBottom: "1px solid var(--border-light)" }}
                  >
                    เมนูที่เห็น
                  </th>
                  {/* Status and its control share one column: the badge reports,
                      the button acts. A badge that is also a button reads as
                      neither. */}
                  <th
                    rowSpan={2}
                    className="text-center px-4 py-2 font-semibold align-bottom"
                    style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border-light)" }}
                  >
                    สถานะ
                  </th>
                </tr>
                <tr
                  style={{
                    borderBottom: "1px solid var(--border-light)",
                    background: "var(--bg-card-header)",
                  }}
                >
                  {/* The grantable settings tabs, in the settings page's own
                      order — both lists are built from GRANTABLE_BOOKING_TABS,
                      so a fifth tab appears in both or in neither. */}
                  {GRANTABLE_BOOKING_TABS.map((tab) => (
                    <th
                      key={tab.key}
                      className="text-center px-3 py-2 font-semibold whitespace-nowrap"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {tab.label}
                    </th>
                  ))}
                  {/* The grantable work-queue menus, in the page's own order —
                      both lists are built from GRANTABLE_BOOKING_MENUS, so a
                      third menu appears in both or in neither. */}
                  {GRANTABLE_BOOKING_MENUS.map((menu) => (
                    <th
                      key={menu.key}
                      className="text-center px-3 py-2 font-semibold whitespace-nowrap"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {menu.label}
                    </th>
                  ))}
                  {/* Not a checkbox column, deliberately. The tick columns above
                      are a CLOSED vocabulary — a fixed list of tabs and menus —
                      while brands are data that changes at Settings →
                      แบรนด์ที่เบิก. Extending ALL_GRANT_COLUMNS with them would
                      mix the two and route brand ticks through the tab writer. */}
                  <th
                    className="text-center px-3 py-2 font-semibold whitespace-nowrap"
                    style={{ color: "var(--text-muted)" }}
                  >
                    แบรนด์ที่เห็น
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr
                    key={r.id}
                    className="transition-colors hover:!bg-[var(--bg-row-hover)]"
                    style={{
                      borderBottom: "1px solid var(--border-light)",
                      background: idx % 2 === 1 ? "var(--bg-row-stripe)" : undefined,
                    }}
                  >
                    <td className="px-4 py-2.5 font-medium" style={{ color: "var(--text-primary)" }}>
                      {r.displayName}
                    </td>
                    <td className="px-4 py-2.5" style={{ color: "var(--text-muted)" }}>
                      {r.email}
                    </td>
                    <td className="px-4 py-2.5" style={{ color: "var(--text-muted)" }}>
                      {r.staffId}
                    </td>
                    {/* Ticks render on every row, active or not. Deactivating
                        does not delete grant rows — `resolveBookingTabsByEmail`
                        filters `IsActive = 1`, so access stops immediately and
                        comes back exactly as it was on reactivation. Hiding the
                        ticks would leave an admin unable to see what a
                        deactivated person still holds, or to set it up before
                        switching them on. The save cannot flip the status: the
                        payload echoes `isActive` back unchanged. */}
                    <TabGrantCells row={r} onSaved={() => void mutate()} />
                    <BrandScopeCell row={r} onSaved={() => void mutate()} />
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-center gap-2">
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded"
                          style={
                            r.isActive
                              ? { background: "var(--status-ok-bg)", color: "var(--status-ok-text)" }
                              : { background: "var(--bg-badge)", color: "var(--text-muted)" }
                          }
                        >
                          {r.isActive ? "ใช้งาน" : "ปิด"}
                        </span>
                        <button
                          type="button"
                          disabled={busyStaffId === r.staffId}
                          onClick={() => {
                            if (!r.isActive) {
                              void call("PATCH", { staffId: r.staffId, isActive: true }, r.staffId);
                              return;
                            }
                            // Turning the last one off is the state the standing
                            // notice describes — say so before it happens, not
                            // after.
                            const last = activeCount === 1;
                            setConfirmAction({
                              title: "ปิดสิทธิ์เข้าถึง",
                              message: last
                                ? `ปิดสิทธิ์เข้าถึงของ ${r.displayName} (${r.email})? นี่เป็นคนสุดท้ายในรายชื่อ — หลังปิดแล้วจะไม่มีใครเห็นคิวจองและรายงาน AP-17 เลย`
                                : `ปิดสิทธิ์เข้าถึงของ ${r.displayName} (${r.email})? จะไม่เห็นคิวจองและรายงาน AP-17 อีกต่อไป`,
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
                            r.isActive
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
                          title={r.isActive ? "ปิดการใช้งาน" : "เปิดใช้งาน"}
                          aria-label={
                            r.isActive
                              ? `ปิดการใช้งาน ${r.displayName}`
                              : `เปิดใช้งาน ${r.displayName}`
                          }
                        >
                          {busyStaffId === r.staffId ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : r.isActive ? (
                            <UserX size={13} />
                          ) : (
                            <UserCheck size={13} />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
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
