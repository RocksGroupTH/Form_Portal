"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Check, Loader2, Plus, ShieldCheck, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { ADSearchModal, type ADResult } from "@/components/settings/ADSearchModal";
import { GRANTABLE_REIMBURSE_TABS } from "@/lib/acc/reimburse/settings-tabs";

const ENDPOINT = "/api/request/reimburse/settings/access";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface ReimburseAccessRow {
  id: number;
  staffId: number;
  email: string;
  displayName: string;
  isActive: boolean;
  settingsTabs: string[];
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

/* ── Per-tab grants ──
 *
 * One checkbox per entry in `GRANTABLE_REIMBURSE_TABS`, which is derived from
 * the settings page's own tab order — so the columns and the tabs cannot drift.
 * Two of the four tabs can never appear among them: `access`, because whoever
 * opens it could grant themselves the rest, and `approvers`, because that tab
 * edits the pool that approves real payments.
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
          // Posted in GRANTABLE_REIMBURSE_TABS order, so what is stored never
          // depends on the order the boxes happened to be ticked.
          settingsTabs: GRANTABLE_REIMBURSE_TABS.filter((t) => next.has(t.key)).map((t) => t.key),
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
      {GRANTABLE_REIMBURSE_TABS.map((tab) => (
        <td key={tab.key} className="px-3 py-2.5 text-center">
          <TabGrantCheckbox
            checked={checked.has(tab.key)}
            saving={saving}
            onChange={() => void toggle(tab.key)}
            ariaLabel={`${row.displayName || row.email} — ${tab.label}`}
          />
        </td>
      ))}
    </>
  );
}

/**
 * AP-4's สิทธิ์เข้าถึง tab — who may open which of AP-4's back-office settings.
 *
 * **Not the approval pool.** ผู้อนุมัติบัญชี (`AccReimburseApprover`) decides who
 * takes the two accounting steps on real reimbursement payments; this list
 * decides who may edit the payment-rule checklist and the brand allowlist.
 * Migration 106 adds a second table rather than reusing the first precisely so
 * one can be handed out without the other.
 *
 * Unlike AP-17's identically-shaped panel, an empty list here is a **neutral**
 * state and gets no alarm banner: nothing is hidden and nothing is broken by
 * it, because admins keep every tab and this roster only ever *adds* people.
 * AP-17's empty roster hides its queue and report from everyone, which is why
 * that one shouts.
 *
 * Membership alone grants nothing either — the ticks do. Somebody added and
 * left with no boxes ticked has exactly the access they had before, which is
 * why the row copy says so rather than leaving an admin to infer it.
 *
 * Table shape follows `UatUserSettings`: one สถานะ column in which the badge
 * reports the state and the round button beside it performs the single
 * available action. Deactivation is a soft delete — rows are never removed, so
 * the history of who could edit what stays readable.
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
        <p className="text-[11px] mb-3 leading-relaxed" style={{ color: "var(--text-muted)" }}>
          ให้คนที่ไม่ใช่แอดมินเข้ามาแก้เมนูตั้งค่าของ AP-4 ได้เฉพาะแท็บที่ติ๊กให้ ·
          IT Admin และ System Admin เห็นทุกแท็บอยู่แล้วโดยไม่ต้องอยู่ในรายชื่อนี้ ·
          <strong> คนละรายชื่อกับ &quot;ผู้อนุมัติบัญชี&quot;</strong> — อยู่ในนี้ไม่ได้แปลว่าอนุมัติจ่ายเงินได้
        </p>

        <div className="mb-4">
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-2 rounded-lg cursor-pointer border-none"
            style={{ background: "var(--color-action)", color: "var(--btn-primary-text)" }}
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
              ติ๊กแท็บที่ให้แก้ได้ — ถ้าไม่ติ๊กเลย จะยังเข้าหน้าตั้งค่าไม่ได้
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px] min-w-[720px]">
                <thead>
                  <tr
                    style={{
                      borderBottom: "1px solid var(--border-light)",
                      background: "var(--bg-card-alt)",
                    }}
                  >
                    <th
                      className="text-left px-4 py-2 font-semibold"
                      style={{ color: "var(--text-muted)" }}
                    >
                      ชื่อ
                    </th>
                    <th
                      className="text-left px-4 py-2 font-semibold"
                      style={{ color: "var(--text-muted)" }}
                    >
                      อีเมล
                    </th>
                    <th
                      className="text-left px-4 py-2 font-semibold"
                      style={{ color: "var(--text-muted)" }}
                    >
                      รหัสพนักงาน
                    </th>
                    {/* The grantable settings tabs, in the settings page's own
                        order — both lists come from GRANTABLE_REIMBURSE_TABS,
                        which is filtered from the page's tab order, so a new
                        grantable tab appears in both or in neither. */}
                    {GRANTABLE_REIMBURSE_TABS.map((tab) => (
                      <th
                        key={tab.key}
                        className="text-center px-3 py-2 font-semibold whitespace-nowrap"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {tab.label}
                      </th>
                    ))}
                    {/* Status and its control share one column: the badge
                        reports, the button acts. A badge that is also a button
                        reads as neither. */}
                    <th
                      className="text-center px-4 py-2 font-semibold"
                      style={{ color: "var(--text-muted)" }}
                    >
                      สถานะ
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
                              setConfirmAction({
                                title: "ปิดสิทธิ์เข้าถึง",
                                message: `ปิดสิทธิ์เข้าถึงของ ${r.displayName} (${r.email})? จะเข้าหน้าตั้งค่า AP-4 ไม่ได้อีก (แท็บที่ติ๊กไว้ยังอยู่ ถ้าเปิดกลับจะได้เท่าเดิม)`,
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
