"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { UserPlus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface Approver {
  id: number;
  staffId: number | null;
  email: string;
  displayName: string | null;
  isActive: boolean;
  photoUrl: string | null;
}

export function AdvanceApproverSettings() {
  const [rows, setRows] = useState<Approver[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/request/advance/settings/approvers")
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: Approver[] }) => setRows(j.ok && j.data ? j.data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  async function post(body: unknown, okMsg?: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/request/advance/settings/approvers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error ?? "บันทึกไม่สำเร็จ");
      if (okMsg) toast.success(okMsg);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    const e = email.trim();
    if (!e) return toast.error("กรุณากรอกอีเมล");
    await post({ email: e }, "เพิ่มผู้อนุมัติแล้ว");
    setEmail("");
  }

  async function remove(id: number) {
    if (!window.confirm("ลบผู้อนุมัติรายนี้?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/request/advance/settings/approvers/${id}`, { method: "DELETE" });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error ?? "ลบไม่สำเร็จ");
      toast.success("ลบแล้ว");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-[14px] font-bold" style={{ color: "var(--text-heading)" }}>
          ผู้อนุมัติบัญชี (ขั้นบัญชี · AP-2)
        </h3>
        <p className="text-[12px] mt-0.5" style={{ color: "var(--text-muted)" }}>
          รายชื่อนี้ใช้เฉพาะ AP-2 · ขั้นผู้จัดการมาจากสายบังคับบัญชา (HR) อัตโนมัติ
        </p>
      </div>

      {/* Add */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="อีเมลผู้อนุมัติ (@rocks-foods.com)"
          className="flex-1 min-w-[220px] text-[13px] px-3 py-2 rounded-lg outline-none"
          style={{ background: "var(--bg-card)", color: "var(--text-primary)", border: "1px solid var(--border-card)" }}
        />
        <Button variant="primary" onClick={add} loading={busy} icon={<UserPlus size={15} />}>
          เพิ่ม
        </Button>
      </div>

      {/* List */}
      {loading ? (
        <p className="text-[12px] py-6 text-center" style={{ color: "var(--text-muted)" }}>กำลังโหลด...</p>
      ) : rows.length === 0 ? (
        <p className="text-[12px] py-6 text-center" style={{ color: "var(--text-muted)" }}>ยังไม่มีผู้อนุมัติ</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-3 px-3 py-2 rounded-xl"
              style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)", opacity: a.isActive ? 1 : 0.55 }}
            >
              {a.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.photoUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
              ) : (
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold"
                  style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}>
                  {(a.displayName ?? a.email).charAt(0).toUpperCase()}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                  {a.displayName ?? a.email}
                </p>
                <p className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>{a.email}</p>
              </div>
              <label className="flex items-center gap-1.5 text-[11px] cursor-pointer" style={{ color: "var(--text-secondary)" }}>
                <input
                  type="checkbox"
                  checked={a.isActive}
                  disabled={busy}
                  onChange={(e) => post({ id: a.id, isActive: e.target.checked })}
                />
                ใช้งาน
              </label>
              <button
                onClick={() => remove(a.id)}
                disabled={busy}
                className="p-1.5 rounded-lg cursor-pointer border-none bg-transparent"
                style={{ color: "var(--text-danger, #dc2626)" }}
                title="ลบ"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
