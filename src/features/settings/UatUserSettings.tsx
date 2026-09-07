"use client";

import { useState } from "react";
import useSWR from "swr";
import { AlertTriangle, FlaskConical, Loader2, Plus, UserCheck, UserX, Wallet } from "lucide-react";
import { toast } from "sonner";
// This page's own copy of the picker is what `@/components/settings/ADSearchModal`
// was lifted from, so the shared one is that copy with an `aria-label` added and
// `onSelect` widened to hand back the whole row.
import { ADSearchModal } from "@/components/settings/ADSearchModal";
import { SidePanel, SidePanelClose } from "@/components/ui/SidePanel";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface UatTesterListItem {
  id: number;
  staffId: number;
  email: string;
  name: string;
  managerStaffId: number | null;
  managerEmail: string | null;
  managerIsTester: boolean;
  isActive: boolean;
  updatedAt: string | null;
}

interface UatUsersData {
  testers: UatTesterListItem[];
  accountApproverIsTester: boolean;
}

interface UatPerDiemRate {
  id: number;
  staffId: number;
  effectiveDate: string;
  amount: number;
  note: string | null;
  isActive: boolean;
}

/* ── Confirm Modal ── */
function ConfirmModal({ title, message, danger, onConfirm, onCancel }: {
  title: string; message: string; danger?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="app-overlay fixed inset-0 z-50 flex items-center justify-center">
      <div className="rounded-2xl w-[400px] max-w-[90vw] overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-modal)" }}>
        <div className="px-5 py-4">
          <h3 className="text-[14px] font-bold mb-2" style={{ color: "var(--text-heading)" }}>{title}</h3>
          <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>{message}</p>
        </div>
        <div className="flex gap-2 px-5 py-3" style={{ borderTop: "1px solid var(--border-card)", background: "var(--bg-card-alt)" }}>
          <button onClick={onCancel} className="flex-1 px-3 py-2 rounded-lg text-[12px] font-medium cursor-pointer" style={{ background: "var(--bg-badge)", color: "var(--text-secondary)", border: "none" }}>ยกเลิก</button>
          <button onClick={onConfirm} className="flex-1 px-3 py-2 rounded-lg text-[12px] font-bold cursor-pointer border-none text-white" style={{ background: danger ? "var(--color-danger)" : "var(--color-action)" }}>ยืนยัน</button>
        </div>
      </div>
    </div>
  );
}

/* ── Per-diem editor ──
   The AMOUNT opens BLANK and the DATE defaults to today. That split is the
   lesson PerDiemCountrySettings paid for: pre-filling the stored values makes
   one click an in-place rewrite of a rate trips were already priced at, when
   the intent is almost always to add a new dated row. Defaulting the date has
   no such risk — the save key is (StaffId, EffectiveDate), and today is rarely
   an existing row — and it is what keeps a new rate covering every trip, since
   a trip cannot depart before tomorrow. */
function PerDiemPanel({
  tester, rates, onClose, onSaved,
}: {
  tester: { staffId: number; name: string; email: string };
  rates: UatPerDiemRate[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;

  const [effectiveDate, setEffectiveDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const mine = rates
    .filter((r) => r.staffId === tester.staffId)
    .slice()
    .sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : -1));

  const save = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/uat-users/per-diem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId: tester.staffId, effectiveDate, amount, note }),
      });
      const json = await res.json();
      if (!json.ok) { toast.error(json.error ?? "บันทึกไม่สำเร็จ"); return; }
      toast.success("บันทึกเรตแล้ว");
      setAmount("");
      setNote("");
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (id: number, isActive: boolean) => {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/uat-users/per-diem", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isActive }),
      });
      const json = await res.json();
      if (!json.ok) { toast.error(json.error ?? "ทำรายการไม่สำเร็จ"); return; }
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel open onClose={onClose} width="480px">
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--border-card)" }}>
        <div>
          <h3 className="text-[14px] font-bold" style={{ color: "var(--text-heading)" }}>เบี้ยเลี้ยง UAT</h3>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{tester.name} · {tester.email}</p>
        </div>
        <SidePanelClose onClick={onClose} />
      </div>

      <div className="px-5 py-4 overflow-y-auto flex-1">
        <p className="text-[11px] mb-3" style={{ color: "var(--text-muted)" }}>
          ใช้เฉพาะใน UAT · ถ้าไม่ตั้ง จะใช้เบี้ยเลี้ยงจริงจากระบบ HR · ทริปต่างประเทศที่มีเรตรายประเทศ จะใช้เรตรายประเทศ
        </p>

        <div className="grid grid-cols-2 gap-2 mb-2">
          <label className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
            วันที่เริ่มมีผล
            <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)}
              className="w-full mt-1 px-2 py-1.5 rounded-lg text-[12px]"
              style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-main)" }} />
          </label>
          <label className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
            จำนวนเงินต่อวัน (บาท)
            <input type="number" min={0} step="0.01" value={amount} placeholder="เช่น 800"
              onChange={(e) => setAmount(e.target.value)}
              className="w-full mt-1 px-2 py-1.5 rounded-lg text-[12px]"
              style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-main)" }} />
          </label>
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="หมายเหตุ (ไม่บังคับ)" maxLength={300}
          className="w-full px-2 py-1.5 rounded-lg text-[12px] mb-3"
          style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-main)" }} />
        <button onClick={() => void save()} disabled={busy}
          className="w-full px-3 py-2 rounded-lg text-[12px] font-bold border-none text-white enabled:cursor-pointer disabled:opacity-60"
          style={{ background: "var(--color-action)" }}>
          {busy ? "กำลังบันทึก…" : "บันทึกเรต"}
        </button>

        <div className="mt-5">
          <p className="text-[11px] font-bold mb-2" style={{ color: "var(--text-heading)" }}>เรตที่ตั้งไว้</p>
          {mine.length === 0 ? (
            <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>ยังไม่ได้ตั้งเรต — จะใช้ข้อมูลจากระบบ HR</p>
          ) : (
            mine.map((r) => (
              <div key={r.id} className="flex items-center justify-between py-1.5" style={{ borderBottom: "1px solid var(--border-card)" }}>
                <span className="text-[12px]" style={{ color: r.isActive ? "var(--text-primary)" : "var(--text-faint)" }}>
                  {r.effectiveDate} · ฿{r.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}/วัน
                  {r.note ? ` · ${r.note}` : ""}
                </span>
                <button onClick={() => void toggle(r.id, !r.isActive)} disabled={busy}
                  className="text-[10px] font-medium px-2 py-0.5 rounded-lg border-none enabled:cursor-pointer disabled:opacity-60"
                  style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}>
                  {r.isActive ? "ปิดใช้" : "เปิดใช้"}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </SidePanel>
  );
}

export function UatUserSettings() {
  const { data, mutate, isLoading } = useSWR<{ ok: boolean; data: UatUsersData; error?: string }>(
    "/api/settings/uat-users",
    fetcher,
  );

  const { data: rateData, mutate: mutateRates } = useSWR<{ ok: boolean; data: UatPerDiemRate[] }>(
    "/api/settings/uat-users/per-diem",
    fetcher,
  );
  const rates = rateData?.ok ? rateData.data : [];
  const [perDiemFor, setPerDiemFor] = useState<UatTesterListItem | null>(null);

  /** The rate in force today, by the same rule the trip pricing uses. */
  const rateToday = (staffId: number): number | null => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate(),
    ).padStart(2, "0")}`;
    let best: UatPerDiemRate | null = null;
    for (const r of rates) {
      if (r.staffId !== staffId || !r.isActive || r.effectiveDate > today) continue;
      if (!best || r.effectiveDate > best.effectiveDate) best = r;
    }
    return best ? best.amount : null;
  };

  const [showAddTesterModal, setShowAddTesterModal] = useState(false);
  const [managerPickerFor, setManagerPickerFor] = useState<{ email: string; name: string } | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ title: string; message: string; danger?: boolean; onConfirm: () => void } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const testers = data?.ok ? data.data.testers : [];
  const accountApproverIsTester = data?.ok ? data.data.accountApproverIsTester : true;
  const loadError = data && !data.ok ? data.error ?? "โหลดข้อมูลไม่สำเร็จ" : null;

  // Rule 2 ("a UAT manager must themselves be an active tester") is only
  // enforced at upsert time. Deactivating the manager later reaches the same
  // broken state without tripping that check, so surface it here: everyone
  // currently pointing at a manager who is no longer an active tester.
  const orphanedTesters = testers.filter((t) => t.isActive && t.managerStaffId !== null && !t.managerIsTester);

  // The other half of the same problem, and the one nothing used to say out
  // loud: a tester with no UAT manager at all. `uatManagerFor` returns null and
  // the submit refuses, but the person only finds out at the end of a form they
  // have already filled in. There is no bootstrap trap any more — a tester may
  // be their own manager — so the warning names the fix rather than a blocker.
  const managerlessTesters = testers.filter((t) => t.isActive && t.managerStaffId === null);

  const doAction = async (body: Record<string, unknown>, busy?: number) => {
    if (busy !== undefined) setBusyId(busy);
    try {
      const res = await fetch("/api/settings/uat-users", {
        method: "POST",
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
    } finally {
      if (busy !== undefined) setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ── Warning: no active AccApprover is a tester ── */}
      {!isLoading && !loadError && !accountApproverIsTester && (
        <div
          className="rounded-xl px-4 py-3 flex items-start gap-2.5"
          style={{ background: "var(--status-bad-bg)", color: "var(--status-bad-text)" }}
        >
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <p className="text-[12px] leading-relaxed">
            ยังไม่มีผู้อนุมัติบัญชี (AccApprover) คนไหนอยู่ในรายชื่อ UAT — คำขอ UAT จะค้างที่ขั้นอนุมัติบัญชี
          </p>
        </div>
      )}

      {/* ── Warning: someone's UAT manager is no longer an active tester ── */}
      {!isLoading && !loadError && orphanedTesters.length > 0 && (
        <div
          className="rounded-xl px-4 py-3 flex items-start gap-2.5"
          style={{ background: "var(--status-bad-bg)", color: "var(--status-bad-text)" }}
        >
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <p className="text-[12px] leading-relaxed">
            ผู้ทดสอบต่อไปนี้มีผู้จัดการสำหรับ UAT ที่ไม่ได้อยู่ในรายชื่อผู้ทดสอบที่เปิดใช้งาน — คำขอ UAT ของคนเหล่านี้จะค้างที่ขั้นอนุมัติของผู้จัดการ:{" "}
            <b>{orphanedTesters.map((t) => t.name).join(", ")}</b>
          </p>
        </div>
      )}

      {!isLoading && !loadError && managerlessTesters.length > 0 && (
        <div
          className="rounded-xl px-4 py-3 flex items-start gap-2.5"
          style={{ background: "var(--status-pending-bg)", color: "var(--status-pending-text)" }}
        >
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <p className="text-[12px] leading-relaxed">
            ผู้ทดสอบต่อไปนี้ยังไม่ได้กำหนดผู้จัดการสำหรับ UAT — จะกดส่งคำขอ UAT ไม่ได้จนกว่าจะกำหนด:{" "}
            <b>{managerlessTesters.map((t) => t.name).join(", ")}</b>{" "}
            ผู้จัดการสำหรับ UAT ต้องเป็นผู้ทดสอบที่เปิดใช้งานอยู่ และตั้งตัวเองได้
            หากต้องการทดสอบครบวงจรด้วยคนเดียว
          </p>
        </div>
      )}

      {/* ── Tester table ── */}
      <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
        <div className="flex items-center gap-2 mb-3">
          <FlaskConical size={16} style={{ color: "var(--text-heading)" }} />
          <h2 className="text-[14px] font-bold flex-1" style={{ color: "var(--text-heading)" }}>UAT Users</h2>
          <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>{testers.length} คน</span>
        </div>

        <div className="mb-4">
          <button
            onClick={() => setShowAddTesterModal(true)}
            className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-2 rounded-lg cursor-pointer border-none"
            style={{ background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)", border: "1px solid var(--btn-primary-border)" }}
          >
            <Plus size={12} /> เพิ่มผู้ทดสอบ
          </button>
        </div>

        {showAddTesterModal && (
          <ADSearchModal
            title="เพิ่มผู้ทดสอบ UAT"
            onClose={() => setShowAddTesterModal(false)}
            onSelect={(u) => { void doAction({ action: "upsert", email: u.email }); }}
            existingEmails={testers.map((t) => t.email)}
          />
        )}
        {managerPickerFor && (
          <ADSearchModal
            title="ตั้งผู้จัดการสำหรับ UAT"
            subtitle={`สำหรับ ${managerPickerFor.name} (${managerPickerFor.email})`}
            onClose={() => setManagerPickerFor(null)}
            onSelect={(u) => {
              void doAction({ action: "upsert", email: managerPickerFor.email, managerEmail: u.email });
            }}
          />
        )}

        {isLoading ? (
          <div className="py-10 flex justify-center">
            <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-muted)" }} />
          </div>
        ) : loadError ? (
          <p className="py-8 text-center text-[12px]" style={{ color: "var(--text-danger)" }}>{loadError}</p>
        ) : testers.length === 0 ? (
          <p className="py-8 text-center text-[12px]" style={{ color: "var(--text-muted)" }}>
            ยังไม่มีผู้ทดสอบ UAT — กด "เพิ่มผู้ทดสอบ" เพื่อเริ่มต้น
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-light)", background: "var(--bg-card-header)" }}>
                  <th className="text-left px-4 py-2 font-semibold" style={{ color: "var(--text-muted)" }}>ชื่อ</th>
                  <th className="text-left px-4 py-2 font-semibold" style={{ color: "var(--text-muted)" }}>อีเมล</th>
                  <th className="text-left px-4 py-2 font-semibold" style={{ color: "var(--text-muted)" }}>ผู้จัดการสำหรับ UAT</th>
                  <th className="text-left px-4 py-2 font-semibold" style={{ color: "var(--text-muted)" }}>เบี้ยเลี้ยง UAT</th>
                  {/* Status and its control are one column: the badge *is* the
                      switch, so there is nothing left for a separate action
                      column to hold. */}
                  <th className="text-center px-4 py-2 font-semibold" style={{ color: "var(--text-muted)" }}>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {testers.map((t, idx) => (
                  <tr
                    key={t.id}
                    className="transition-colors hover:!bg-[var(--bg-row-hover)]"
                    style={{ borderBottom: "1px solid var(--border-light)", background: idx % 2 === 1 ? "var(--bg-row-stripe)" : undefined }}
                  >
                    <td className="px-4 py-2.5 font-medium" style={{ color: "var(--text-primary)" }}>{t.name}</td>
                    <td className="px-4 py-2.5" style={{ color: "var(--text-muted)" }}>{t.email}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {t.managerEmail ? (
                          <>
                            <span style={{ color: t.managerIsTester ? "var(--text-muted)" : "var(--status-bad-text)" }}>
                              {t.managerEmail}
                            </span>
                            {!t.managerIsTester && (
                              <span title="ผู้จัดการคนนี้ไม่ได้อยู่ในรายชื่อ UAT Users">
                                <AlertTriangle size={12} style={{ color: "var(--status-bad-text)" }} />
                              </span>
                            )}
                            <button
                              onClick={() => setManagerPickerFor({ email: t.email, name: t.name })}
                              className="text-[10px] font-medium px-2 py-0.5 rounded-lg cursor-pointer border-none"
                              style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
                            >
                              เปลี่ยน
                            </button>
                            <button
                              onClick={() => { void doAction({ action: "upsert", email: t.email, managerEmail: "" }, t.id); }}
                              className="text-[10px] font-medium px-2 py-0.5 rounded-lg cursor-pointer border-none"
                              style={{ background: "var(--bg-badge)", color: "var(--text-faint)" }}
                            >
                              ล้าง
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setManagerPickerFor({ email: t.email, name: t.name })}
                            className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-lg cursor-pointer border-none"
                            style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
                          >
                            <Plus size={10} /> ตั้งผู้จัดการ
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span
                          className="text-[11px]"
                          style={{ color: rateToday(t.staffId) != null ? "var(--text-secondary)" : "var(--text-faint)" }}
                        >
                          {rateToday(t.staffId) != null
                            ? `฿${rateToday(t.staffId)!.toLocaleString("en-US", { minimumFractionDigits: 2 })}/วัน`
                            : "—"}
                        </span>
                        <button
                          onClick={() => setPerDiemFor(t)}
                          className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-lg cursor-pointer border-none"
                          style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
                        >
                          <Wallet size={10} /> ตั้งเรต
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      {/* One column, two jobs kept visually separate: the badge
                          reports the state and is not clickable, the round
                          button beside it does the one thing available — green
                          "turn on" for a disabled row, red "turn off" for an
                          active one. A badge that is also a button reads as
                          neither. */}
                      {/* Centred to match the centred column header — a centred
                          heading over left-aligned cells reads as a mistake. */}
                      <div className="flex items-center justify-center gap-2">
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded"
                          style={
                            t.isActive
                              ? { background: "var(--status-ok-bg)", color: "var(--status-ok-text)" }
                              : { background: "var(--bg-badge)", color: "var(--text-muted)" }
                          }
                        >
                          {t.isActive ? "ใช้งาน" : "ปิด"}
                        </span>
                        <button
                          type="button"
                          disabled={busyId === t.id}
                          onClick={() => {
                            if (!t.isActive) {
                              void doAction({ action: "setActive", id: t.id, isActive: true }, t.id);
                              return;
                            }
                            const dependants = testers.filter(
                              (d) => d.isActive && d.managerStaffId === t.staffId && d.id !== t.id,
                            );
                            const message =
                              dependants.length > 0
                                ? `ปิดสิทธิ์ผู้ทดสอบ UAT ของ ${t.name} (${t.email})? มีผู้ทดสอบอีก ${dependants.length} คนที่ตั้งให้คนนี้เป็นผู้จัดการสำหรับ UAT (${dependants
                                    .map((d) => d.name)
                                    .join(", ")}) — คำขอ UAT ของพวกเขาจะค้างที่ขั้นอนุมัติของผู้จัดการหลังปิดสิทธิ์`
                                : `ปิดสิทธิ์ผู้ทดสอบ UAT ของ ${t.name} (${t.email})?`;
                            setConfirmAction({
                              title: "ปิดสิทธิ์ผู้ทดสอบ",
                              message,
                              danger: true,
                              onConfirm: () => {
                                setConfirmAction(null);
                                void doAction({ action: "remove", id: t.id }, t.id);
                              },
                            });
                          }}
                          className="inline-flex items-center justify-center rounded-full border-none shrink-0 enabled:cursor-pointer disabled:cursor-default disabled:opacity-70"
                          style={
                            t.isActive
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
                          title={t.isActive ? "ปิดการใช้งาน" : "เปิดใช้งาน"}
                          aria-label={
                            t.isActive ? `ปิดการใช้งาน ${t.name}` : `เปิดใช้งาน ${t.name}`
                          }
                        >
                          {busyId === t.id ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : t.isActive ? (
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

      {perDiemFor && (
        <PerDiemPanel
          tester={perDiemFor}
          rates={rates}
          onClose={() => setPerDiemFor(null)}
          onSaved={() => { void mutateRates(); }}
        />
      )}
    </div>
  );
}
