"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { AlertTriangle, FlaskConical, Loader2, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";

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

/* ── Confirm Modal ── */
function ConfirmModal({ title, message, danger, onConfirm, onCancel }: {
  title: string; message: string; danger?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "var(--overlay-bg)" }}>
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

/* ── AD Search Modal — same shape as Settings → Users & Roles' own modal ── */
interface ADResult { email: string; name: string; jobTitle: string | null; department: string | null; photo?: string | null }

function ADSearchModal({ title, subtitle, onClose, onSelect, existingEmails }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  onSelect: (email: string, name: string) => void;
  existingEmails?: string[];
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ADResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) { setResults([]); setError(null); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        setSearching(true); setError(null);
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(query.trim())}`);
        const json = await res.json();
        if (json.ok) setResults(json.data ?? []);
        else throw new Error(json.error || "ค้นหาไม่สำเร็จ");
      } catch (err) { setError(err instanceof Error ? err.message : "ค้นหาไม่สำเร็จ"); setResults([]); }
      finally { setSearching(false); }
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const existing = new Set((existingEmails ?? []).map((e) => e.toLowerCase()));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "var(--overlay-bg)" }}>
      <div className="rounded-2xl w-[560px] max-w-[95vw] max-h-[80vh] flex flex-col overflow-hidden" style={{ background: "var(--bg-card)", boxShadow: "var(--shadow-modal)", border: "1px solid var(--border-card)" }}>
        <div className="px-5 py-4 flex items-center justify-between shrink-0" style={{ borderBottom: "1px solid var(--border-card)" }}>
          <div>
            <h2 className="text-[15px] font-bold" style={{ color: "var(--text-heading)" }}>{title}</h2>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{subtitle ?? "ค้นหาผู้ใช้จาก Microsoft Entra ID"}</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer border-none" style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}>
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-3 shrink-0">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)" }}>
            <Search size={14} style={{ color: "var(--text-muted)" }} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="พิมพ์ชื่อหรืออีเมล..."
              className="flex-1 text-[13px] outline-none bg-transparent"
              style={{ color: "var(--text-primary)" }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {query.trim().length < 2 ? (
            <div className="py-10 text-center">
              <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหา</p>
            </div>
          ) : searching ? (
            <div className="py-10 text-center">
              <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>กำลังค้นหาใน Entra ID...</p>
            </div>
          ) : error ? (
            <div className="py-10 text-center">
              <p className="text-[12px]" style={{ color: "var(--color-danger)" }}>{error}</p>
            </div>
          ) : results.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>ไม่พบผู้ใช้สำหรับ "{query}"</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "var(--text-faint)" }}>{results.length} ผลลัพธ์</p>
              {results.map((u) => {
                const added = existing.has(u.email.toLowerCase());
                return (
                  <div key={u.email} className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ border: `1px solid ${added ? "color-mix(in srgb, var(--status-ok-text) 30%, transparent)" : "var(--border-card)"}`, background: added ? "var(--status-ok-bg)" : "var(--bg-card)" }}>
                    {u.photo ? (
                      <img src={u.photo} alt={u.name} className="w-9 h-9 rounded-full shrink-0 object-cover" />
                    ) : (
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0" style={{ background: added ? "color-mix(in srgb, var(--status-ok-text) 20%, transparent)" : "var(--nav-active-bg)", color: added ? "var(--status-ok-text)" : "var(--nav-active-text)" }}>
                        {u.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>{u.name}</p>
                      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {u.email}{u.jobTitle ? ` · ${u.jobTitle}` : ""}{u.department ? ` · ${u.department}` : ""}
                      </p>
                    </div>
                    {added ? (
                      <span className="text-[10px] font-bold px-2 py-1 rounded-lg" style={{ color: "var(--status-ok-text)", background: "var(--status-ok-bg)" }}>เพิ่มแล้ว</span>
                    ) : (
                      <button
                        onClick={() => { onSelect(u.email, u.name); onClose(); }}
                        className="text-[11px] font-bold px-3 py-1 rounded-lg cursor-pointer border-none"
                        style={{ background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)" }}
                      >
                        + เลือก
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function UatUserSettings() {
  const { data, mutate, isLoading } = useSWR<{ ok: boolean; data: UatUsersData; error?: string }>(
    "/api/settings/uat-users",
    fetcher,
  );

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
  // have already filled in. Note the bootstrap trap this catches — a manager
  // must themselves be an active tester and self-manager is refused, so a
  // one-person list cannot be given a valid manager at all.
  const managerlessTesters = testers.filter((t) => t.isActive && t.managerStaffId === null);
  const activeTesterCount = testers.filter((t) => t.isActive).length;

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
            <b>{managerlessTesters.map((t) => t.name).join(", ")}</b>
            {activeTesterCount < 2 && (
              <>
                {" "}
                ผู้จัดการสำหรับ UAT ต้องเป็นผู้ทดสอบที่เปิดใช้งานอยู่ และตั้งตัวเองเป็นผู้จัดการไม่ได้
                จึงต้องเพิ่มผู้ทดสอบอย่างน้อย 2 คนก่อน
              </>
            )}
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
            style={{ background: "var(--color-action)", color: "var(--btn-primary-text)" }}
          >
            <Plus size={12} /> เพิ่มผู้ทดสอบ
          </button>
        </div>

        {showAddTesterModal && (
          <ADSearchModal
            title="เพิ่มผู้ทดสอบ UAT"
            onClose={() => setShowAddTesterModal(false)}
            onSelect={(email) => { void doAction({ action: "upsert", email }); }}
            existingEmails={testers.map((t) => t.email)}
          />
        )}
        {managerPickerFor && (
          <ADSearchModal
            title="ตั้งผู้จัดการสำหรับ UAT"
            subtitle={`สำหรับ ${managerPickerFor.name} (${managerPickerFor.email})`}
            onClose={() => setManagerPickerFor(null)}
            onSelect={(managerEmail) => {
              void doAction({ action: "upsert", email: managerPickerFor.email, managerEmail });
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
                <tr style={{ borderBottom: "1px solid var(--border-light)", background: "var(--bg-card-alt)" }}>
                  <th className="text-left px-4 py-2 font-semibold" style={{ color: "var(--text-muted)" }}>ชื่อ</th>
                  <th className="text-left px-4 py-2 font-semibold" style={{ color: "var(--text-muted)" }}>อีเมล</th>
                  <th className="text-left px-4 py-2 font-semibold" style={{ color: "var(--text-muted)" }}>ผู้จัดการสำหรับ UAT</th>
                  <th className="text-left px-4 py-2 font-semibold" style={{ color: "var(--text-muted)" }}>สถานะ</th>
                  <th className="text-left px-4 py-2 font-semibold" style={{ color: "var(--text-muted)" }}>การดำเนินการ</th>
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
                      <span
                        className="text-[10px] font-bold px-2 py-0.5 rounded"
                        style={
                          t.isActive
                            ? { background: "var(--status-ok-bg)", color: "var(--status-ok-text)" }
                            : { background: "var(--status-bad-bg)", color: "var(--status-bad-text)" }
                        }
                      >
                        {t.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {busyId === t.id ? (
                        <Loader2 size={13} className="animate-spin" style={{ color: "var(--text-muted)" }} />
                      ) : t.isActive ? (
                        <button
                          onClick={() => {
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
                          className="cursor-pointer bg-transparent border-none p-0.5"
                          style={{ color: "var(--text-faint)" }}
                          title="ปิดสิทธิ์ผู้ทดสอบ"
                        >
                          <Trash2 size={13} />
                        </button>
                      ) : (
                        <button
                          onClick={() => { void doAction({ action: "setActive", id: t.id, isActive: true }, t.id); }}
                          className="flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg cursor-pointer border-none"
                          style={{ background: "var(--status-ok-bg)", color: "var(--status-ok-text)" }}
                          title="เปิดสิทธิ์ผู้ทดสอบอีกครั้ง"
                        >
                          <RotateCcw size={11} /> เปิดใช้งาน
                        </button>
                      )}
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
    </div>
  );
}
