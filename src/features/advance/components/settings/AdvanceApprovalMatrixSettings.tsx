"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SELECTABLE_STEPS, STEP_LABEL, type StepType } from "@/lib/adv/approval-steps";

interface Tier {
  id: number;
  minAmount: number;
  maxAmount: number | null;
  steps: StepType[];
  isActive: boolean;
  sortOrder: number;
}

// Steps are stored/applied in this canonical order regardless of tick order.
const ORDER: StepType[] = SELECTABLE_STEPS;

export function AdvanceApprovalMatrixSettings() {
  const [rows, setRows] = useState<Tier[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [steps, setSteps] = useState<Set<StepType>>(new Set<StepType>(["HEAD_ACC", "ACC_OFFICER"]));

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/request/advance/settings/tiers")
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: Tier[] }) => setRows(j.ok && j.data ? j.data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => load(), [load]);

  function toggleStep(s: StepType) {
    setSteps((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  }

  async function add() {
    const orderedSteps = ORDER.filter((s) => steps.has(s));
    if (orderedSteps.length === 0) return toast.error("เลือกอย่างน้อย 1 ขั้น");
    setBusy(true);
    try {
      const res = await fetch("/api/request/advance/settings/tiers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          minAmount: Number(min || 0),
          maxAmount: max.trim() === "" ? null : Number(max),
          steps: orderedSteps,
          sortOrder: rows.length + 1,
        }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error ?? "บันทึกไม่สำเร็จ");
      toast.success("เพิ่มขั้นเงินแล้ว");
      setMin(""); setMax("");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally { setBusy(false); }
  }

  async function remove(id: number) {
    if (!window.confirm("ลบขั้นเงินนี้?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/request/advance/settings/tiers/${id}`, { method: "DELETE" });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error ?? "ลบไม่สำเร็จ");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
    } finally { setBusy(false); }
  }

  const inputStyle: React.CSSProperties = {
    background: "var(--bg-card)", color: "var(--text-primary)", border: "1px solid var(--border-card)",
  };
  const fmt = (n: number | null) => (n == null ? "∞" : n.toLocaleString());

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-[14px] font-bold" style={{ color: "var(--text-heading)" }}>ขั้นอนุมัติตามจำนวนเงิน (Approval Matrix)</h3>
        <p className="text-[12px] mt-0.5" style={{ color: "var(--text-muted)" }}>
          จำนวนเงินคำขอตกอยู่ช่วงไหน → ผ่านผู้อนุมัติตามที่กำหนด · ขั้นเรียงตามลำดับ: Head Accounting → ผู้บริหาร → Accounting Officer
        </p>
      </div>

      {/* Add tier */}
      <div className="flex flex-col gap-3 p-3 rounded-xl"
        style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>ตั้งแต่ (บาท)</span>
            <input type="number" value={min} onChange={(e) => setMin(e.target.value)} placeholder="0"
              className="w-[130px] text-[13px] px-3 py-2 rounded-lg outline-none" style={inputStyle} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold" style={{ color: "var(--text-secondary)" }}>ถึง (เว้นว่าง = ไม่จำกัด)</span>
            <input type="number" value={max} onChange={(e) => setMax(e.target.value)} placeholder="∞"
              className="w-[150px] text-[13px] px-3 py-2 rounded-lg outline-none" style={inputStyle} />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          {ORDER.map((s) => (
            <label key={s} className="flex items-center gap-1.5 text-[12px] px-2.5 py-1.5 rounded-lg cursor-pointer"
              style={{ background: steps.has(s) ? "var(--nav-active-bg)" : "var(--bg-card)", border: "1px solid var(--border-card)", color: steps.has(s) ? "var(--nav-active-text)" : "var(--text-secondary)" }}>
              <input type="checkbox" checked={steps.has(s)} onChange={() => toggleStep(s)} />
              {STEP_LABEL[s]}
            </label>
          ))}
          <Button variant="primary" onClick={add} loading={busy} icon={<Plus size={15} />}>เพิ่มขั้น</Button>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <p className="text-[12px] py-6 text-center" style={{ color: "var(--text-muted)" }}>กำลังโหลด...</p>
      ) : rows.length === 0 ? (
        <p className="text-[12px] py-6 text-center" style={{ color: "var(--text-muted)" }}>ยังไม่มีขั้นเงิน — เพิ่มด้านบน</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl"
              style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)", opacity: t.isActive ? 1 : 0.5 }}>
              <span className="text-[13px] font-bold shrink-0 w-[150px]" style={{ color: "var(--text-primary)" }}>
                {fmt(t.minAmount)} – {fmt(t.maxAmount)} ฿
              </span>
              <div className="flex-1 flex flex-wrap gap-1">
                {t.steps.map((s, i) => (
                  <span key={s} className="text-[10px] font-semibold px-1.5 py-0.5 rounded"
                    style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}>
                    {i + 1}. {STEP_LABEL[s]}
                  </span>
                ))}
              </div>
              <button onClick={() => remove(t.id)} disabled={busy}
                className="p-1.5 rounded-lg cursor-pointer border-none bg-transparent shrink-0"
                style={{ color: "var(--text-danger, #dc2626)" }} title="ลบ">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
