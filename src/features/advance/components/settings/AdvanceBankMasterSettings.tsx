"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface Bank {
  id: number;
  bankCode: string;
  bankName: string;
  isActive: boolean;
  sortOrder: number;
}

export function AdvanceBankMasterSettings() {
  const [rows, setRows] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/request/advance/settings/banks")
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: Bank[] }) => setRows(j.ok && j.data ? j.data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  async function post(body: unknown, okMsg?: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/request/advance/settings/banks", {
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
    const code = newCode.trim();
    const name = newName.trim();
    if (!code || !name) return toast.error("กรอกรหัส + ชื่อธนาคาร");
    await post({ bankCode: code, bankName: name }, "เพิ่มธนาคารแล้ว");
    setNewCode("");
    setNewName("");
  }

  async function saveName(b: Bank, name: string) {
    const v = name.trim();
    if (!v || v === b.bankName) return;
    await post({ id: b.id, bankName: v });
  }

  async function remove(b: Bank) {
    if (!window.confirm(`ลบธนาคาร ${b.bankCode} — ${b.bankName}?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/request/advance/settings/banks/${b.id}`, { method: "DELETE" });
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

  const inputStyle: React.CSSProperties = {
    background: "var(--bg-card)", color: "var(--text-primary)", border: "1px solid var(--border-card)",
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-[14px] font-bold" style={{ color: "var(--text-heading)" }}>
          ธนาคาร (Master · AP2.1)
        </h3>
        <p className="text-[12px] mt-0.5" style={{ color: "var(--text-muted)" }}>
          รายชื่อธนาคารสำหรับ dropdown ตอนโอนให้คู่ค้า — ปิด &quot;ใช้งาน&quot; เพื่อซ่อนจากฟอร์มโดยไม่ลบ
        </p>
      </div>

      {/* Add row */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={newCode}
          onChange={(e) => setNewCode(e.target.value)}
          placeholder="รหัส (เช่น 002)"
          className="w-[110px] text-[13px] px-3 py-2 rounded-lg outline-none"
          style={inputStyle}
        />
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="ชื่อธนาคาร"
          className="flex-1 min-w-[200px] text-[13px] px-3 py-2 rounded-lg outline-none"
          style={inputStyle}
        />
        <Button variant="primary" onClick={add} loading={busy} icon={<Plus size={15} />}>
          เพิ่ม
        </Button>
      </div>

      {/* List */}
      {loading ? (
        <p className="text-[12px] py-6 text-center" style={{ color: "var(--text-muted)" }}>กำลังโหลด...</p>
      ) : rows.length === 0 ? (
        <p className="text-[12px] py-6 text-center" style={{ color: "var(--text-muted)" }}>ยังไม่มีธนาคาร</p>
      ) : (
        <>
          <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>ทั้งหมด {rows.length} ธนาคาร</p>
          <div className="flex flex-col gap-1.5">
            {rows.map((b) => (
              <div
                key={b.id}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
                style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)", opacity: b.isActive ? 1 : 0.5 }}
              >
                <span
                  className="text-[12px] font-mono font-bold w-[46px] shrink-0"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {b.bankCode}
                </span>
                <input
                  defaultValue={b.bankName}
                  onBlur={(e) => saveName(b, e.target.value)}
                  disabled={busy}
                  className="flex-1 min-w-0 text-[13px] px-2 py-1 rounded-md outline-none bg-transparent"
                  style={{ color: "var(--text-primary)", border: "1px solid transparent" }}
                  onFocus={(e) => (e.target.style.border = "1px solid var(--border-card)")}
                  onBlurCapture={(e) => (e.target.style.border = "1px solid transparent")}
                />
                <label className="flex items-center gap-1.5 text-[11px] cursor-pointer shrink-0" style={{ color: "var(--text-secondary)" }}>
                  <input
                    type="checkbox"
                    checked={b.isActive}
                    disabled={busy}
                    onChange={(e) => post({ id: b.id, isActive: e.target.checked })}
                  />
                  ใช้งาน
                </label>
                <button
                  onClick={() => remove(b)}
                  disabled={busy}
                  className="p-1.5 rounded-lg cursor-pointer border-none bg-transparent shrink-0"
                  style={{ color: "var(--text-danger, #dc2626)" }}
                  title="ลบ"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
