"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Search, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";

type Role = "HEAD_ACC" | "DIRECTOR" | "ACC_OFFICER";

const ROLES: Role[] = ["HEAD_ACC", "DIRECTOR", "ACC_OFFICER"];
const ROLE_LABEL: Record<Role, string> = {
  HEAD_ACC: "Head Accounting",
  DIRECTOR: "ผู้บริหาร",
  ACC_OFFICER: "Accounting Officer",
};
const ROLE_HINT: Record<Role, string> = {
  HEAD_ACC: "ผู้อนุมัติระดับบัญชี",
  DIRECTOR: "ผู้บริหาร (สำหรับยอดสูง)",
  ACC_OFFICER: "เลือกวันจ่าย + ตรวจสอบ (ขั้นสุดท้าย)",
};

interface Approver {
  id: number;
  email: string;
  displayName: string | null;
  approverRole: Role;
  isActive: boolean;
  photoUrl: string | null;
}
interface Candidate {
  staffId: number;
  email: string;
  fullName: string;
  departmentName: string | null;
  position: string | null;
  photoUrl: string | null;
}

/* ── Candidate search modal (AP-1-style, sourced from IT/Accounting) ── */
function CandidateModal({
  candidates, loading, role, onRole, existing, onAdd, onClose, busy,
}: {
  candidates: Candidate[];
  loading: boolean;
  role: Role;
  onRole: (r: Role) => void;
  existing: Set<string>; // "email" already at the selected role (lowercased)
  onAdd: (c: Candidate) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const results = candidates.filter((c) =>
    !q ||
    c.fullName.toLowerCase().includes(q) ||
    c.email.toLowerCase().includes(q) ||
    (c.departmentName ?? "").toLowerCase().includes(q),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "var(--overlay-bg)" }}>
      <div className="rounded-2xl w-[560px] max-w-[95vw] max-h-[80vh] flex flex-col overflow-hidden"
        style={{ background: "var(--bg-card)", boxShadow: "var(--shadow-modal)", border: "1px solid var(--border-card)" }}>
        {/* Header + role selector */}
        <div className="px-5 py-4 flex items-center justify-between shrink-0" style={{ borderBottom: "1px solid var(--border-card)" }}>
          <div>
            <h2 className="text-[15px] font-bold" style={{ color: "var(--text-heading)" }}>เพิ่มผู้อนุมัติ</h2>
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>เฉพาะพนักงานบัญชี · ผู้บริหาร · IT (สำนักงานใหญ่)</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer border-none"
            style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}><span className="text-[14px]">✕</span></button>
        </div>

        <div className="px-5 pt-3 shrink-0 flex items-center gap-2">
          <span className="text-[12px] font-semibold" style={{ color: "var(--text-secondary)" }}>เพิ่มเป็น:</span>
          <select value={role} onChange={(e) => onRole(e.target.value as Role)}
            className="text-[13px] px-3 py-1.5 rounded-lg outline-none"
            style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </div>

        {/* Search */}
        <div className="px-5 py-3 shrink-0">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)" }}>
            <Search size={14} style={{ color: "var(--text-muted)" }} />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="พิมพ์ชื่อ / อีเมล / แผนก..."
              className="flex-1 text-[13px] outline-none bg-transparent" style={{ color: "var(--text-primary)" }} />
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {loading && candidates.length === 0 ? (
            <div className="py-10 text-center"><p className="text-[12px]" style={{ color: "var(--text-muted)" }}>กำลังโหลดรายชื่อ...</p></div>
          ) : results.length === 0 ? (
            <div className="py-10 text-center"><p className="text-[12px]" style={{ color: "var(--text-muted)" }}>ไม่พบพนักงาน</p></div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider mb-1" style={{ color: "var(--text-faint)" }}>{results.length} รายการ</p>
              {results.map((c) => {
                const added = existing.has(c.email.toLowerCase());
                return (
                  <div key={c.staffId} className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                    style={{ border: `1px solid ${added ? "#4fa37a30" : "var(--border-card)"}`, background: added ? "#e4f4ea08" : "var(--bg-card)" }}>
                    <Avatar name={c.fullName || "?"} size={36} photo={c.photoUrl ?? undefined} color="var(--nav-active-text)" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold truncate" style={{ color: "var(--text-heading)" }}>{c.fullName}</p>
                      <p className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                        {c.email}{c.departmentName ? ` · ${c.departmentName}` : ""}
                      </p>
                    </div>
                    {added ? (
                      <span className="text-[10px] font-bold px-2 py-1 rounded-lg" style={{ color: "#4fa37a", background: "#e4f4ea" }}>เพิ่มแล้ว</span>
                    ) : (
                      <button disabled={busy} onClick={() => onAdd(c)}
                        className="text-[11px] font-bold px-3 py-1 rounded-lg cursor-pointer border-none"
                        style={{ background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)" }}>+ เพิ่ม</button>
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

/* ── Main ── */
export function AdvanceApproverSettings() {
  const [rows, setRows] = useState<Approver[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalRole, setModalRole] = useState<Role>("HEAD_ACC");

  // Reload just the approver list — used after add / remove. The candidate list
  // (an HR query) is static for the session, so it is fetched once on mount and
  // never re-queried on every mutation (that was the slow part).
  const loadApprovers = useCallback(() => {
    return fetch("/api/request/advance/settings/approvers")
      .then((r) => r.json())
      .then((ap: { ok: boolean; data?: Approver[] }) => setRows(ap.ok && ap.data ? ap.data : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    // The approver list is what the page shows — render it as soon as it lands.
    setLoading(true);
    fetch("/api/request/advance/settings/approvers")
      .then((r) => r.json())
      .then((ap: { ok: boolean; data?: Approver[] }) => setRows(ap.ok && ap.data ? ap.data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
    // Candidate picker (HR query) is only needed when the "add" modal opens —
    // load it in the background so it never blocks the list.
    setCandidatesLoading(true);
    fetch("/api/request/advance/settings/approvers/candidates")
      .then((r) => r.json())
      .then((cand: { ok: boolean; data?: Candidate[] }) => setCandidates(cand.ok && cand.data ? cand.data : []))
      .catch(() => {})
      .finally(() => setCandidatesLoading(false));
  }, []);

  async function post(body: unknown, okMsg?: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/request/advance/settings/approvers", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error ?? "บันทึกไม่สำเร็จ");
      if (okMsg) toast.success(okMsg);
      loadApprovers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally { setBusy(false); }
  }

  async function remove(id: number) {
    if (!window.confirm("ลบผู้อนุมัติรายนี้?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/request/advance/settings/approvers/${id}`, { method: "DELETE" });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error ?? "ลบไม่สำเร็จ");
      toast.success("ลบแล้ว");
      loadApprovers();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
    } finally { setBusy(false); }
  }

  const existingAtModalRole = useMemo(
    () => new Set(rows.filter((r) => r.approverRole === modalRole).map((r) => r.email.toLowerCase())),
    [rows, modalRole],
  );
  const activeCount = rows.filter((r) => r.isActive).length;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-[14px] font-bold" style={{ color: "var(--text-heading)" }}>ผู้อนุมัติบัญชี AP-2</h3>
        <p className="text-[12px] mt-0.5" style={{ color: "var(--text-muted)" }}>
          ผู้อนุมัติแต่ละระดับ (Head Accounting / ผู้บริหาร / Accounting Officer) · จะใช้ระดับไหนบ้างขึ้นกับ <b>ขั้นตามเงิน</b> · เพิ่มได้จากบัญชี · ผู้บริหาร · IT (สำนักงานใหญ่)
        </p>
      </div>

      {/* Header row: count + add button (AP-1 style) */}
      <div className="flex items-center justify-between">
        <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
          {activeCount} คนที่ใช้งานอยู่ / {rows.length} คนทั้งหมด
        </p>
        <button onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-2 rounded-lg cursor-pointer border-none"
          style={{ background: "var(--color-action)", color: "#fff" }}>
          <Plus size={13} /> เพิ่มผู้อนุมัติ
        </button>
      </div>

      {/* Sections by role */}
      {loading ? (
        <p className="text-[12px] py-6 text-center" style={{ color: "var(--text-muted)" }}>กำลังโหลด...</p>
      ) : (
        ROLES.map((lvl) => {
          const list = rows.filter((r) => r.approverRole === lvl);
          return (
            <div key={lvl} className="flex flex-col gap-2">
              <div className="flex items-baseline gap-2">
                <h4 className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>{ROLE_LABEL[lvl]}</h4>
                <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>{ROLE_HINT[lvl]}</span>
              </div>
              {list.length === 0 ? (
                <p className="text-[12px] px-1" style={{ color: "var(--text-muted)" }}>— ยังไม่มี —</p>
              ) : (
                list.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
                    style={{ border: "1px solid var(--border-card)", background: "var(--bg-card)", opacity: a.isActive ? 1 : 0.55 }}>
                    <Avatar name={a.displayName || a.email} size={36} photo={a.photoUrl ?? undefined} color="var(--nav-active-text)" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold truncate" style={{ color: "var(--text-heading)" }}>{a.displayName ?? a.email}</p>
                      <p className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>{a.email}</p>
                    </div>
                    <label className="flex items-center gap-1.5 text-[11px] cursor-pointer" style={{ color: "var(--text-secondary)" }}>
                      <input type="checkbox" checked={a.isActive} disabled={busy}
                        onChange={(e) => post({ id: a.id, isActive: e.target.checked })} />
                      ใช้งาน
                    </label>
                    <button onClick={() => remove(a.id)} disabled={busy}
                      className="p-1.5 rounded-lg cursor-pointer border-none bg-transparent"
                      style={{ color: "var(--text-danger, #dc2626)" }} title="ลบ"><Trash2 size={15} /></button>
                  </div>
                ))
              )}
            </div>
          );
        })
      )}

      {modalOpen && (
        <CandidateModal
          candidates={candidates}
          loading={candidatesLoading}
          role={modalRole}
          onRole={setModalRole}
          existing={existingAtModalRole}
          busy={busy}
          onClose={() => setModalOpen(false)}
          onAdd={async (c) => {
            await post({ email: c.email, approverRole: modalRole }, "เพิ่มผู้อนุมัติแล้ว");
            setModalOpen(false); // เด้งกลับหน้ารายการผู้อนุมัติหลังเพิ่มสำเร็จ
          }}
        />
      )}
    </div>
  );
}
