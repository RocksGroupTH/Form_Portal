"use client";

import { useState } from "react";
import { FileText, Plus, ChevronRight, Trash2 } from "lucide-react";
import { Dialog, Button } from "@/components/ui";
import type { AdvanceDraftSummary } from "@/features/advance/types";

function fmtUpdatedAt(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()} ${hh}:${min}`;
}

function fmtBaht(n: number | null): string {
  if (n == null || n === 0) return "—";
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface Props {
  open: boolean;
  drafts: AdvanceDraftSummary[];
  onPickDraft: (id: number) => void;
  onNew: () => void;
  onDismiss: () => void;
  /** Delete a draft by id; resolves once the server confirms. */
  onDeleteDraft: (id: number) => Promise<void>;
}

/** Resume-or-start picker shown when opening AP-2 with unsent drafts (mirrors AP-1). */
export function AdvanceDraftPicker({ open, drafts, onPickDraft, onNew, onDismiss, onDeleteDraft }: Props) {
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const handleConfirmDelete = async (id: number) => {
    setDeletingId(id);
    try {
      await onDeleteDraft(id);
      setConfirmId(null);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onDismiss(); }} title="แบบร่างที่ค้างไว้" contentClassName="max-w-[520px]">
      <div className="flex flex-col gap-2 p-1">
        <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
          มีแบบร่างที่ยังไม่ได้ส่ง {drafts.length} รายการ — เลือกทำต่อ หรือเริ่มใบใหม่
        </p>

        <div className="flex flex-col gap-1.5 max-h-[52vh] overflow-y-auto">
          {drafts.map((d) => {
            const confirming = confirmId === d.id;
            return (
              <div key={d.id} className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
                style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}>
                <FileText size={16} className="shrink-0" style={{ color: "var(--nav-active-text)" }} />
                <button type="button" onClick={() => onPickDraft(d.id)}
                  className="flex-1 min-w-0 text-left bg-transparent border-none cursor-pointer p-0">
                  <p className="text-[13px] font-bold truncate m-0" style={{ color: "var(--text-heading)" }}>
                    {d.purpose?.trim() || "(ยังไม่ระบุรายละเอียด)"}
                  </p>
                  <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
                    {d.brandCode ? `${d.brandCode} · ` : ""}{fmtBaht(d.amount)} ฿ · แก้ล่าสุด {fmtUpdatedAt(d.updatedAt)}
                  </p>
                </button>

                {confirming ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="primary" onClick={() => handleConfirmDelete(d.id)} loading={deletingId === d.id}>ลบ</Button>
                    <Button variant="secondary" onClick={() => setConfirmId(null)} disabled={deletingId === d.id}>ยกเลิก</Button>
                  </div>
                ) : (
                  <>
                    <button type="button" onClick={() => setConfirmId(d.id)} title="ลบแบบร่าง"
                      className="p-1.5 rounded-lg cursor-pointer border-none bg-transparent shrink-0" style={{ color: "#dc2626" }}>
                      <Trash2 size={14} />
                    </button>
                    <button type="button" onClick={() => onPickDraft(d.id)}
                      className="p-1 shrink-0 bg-transparent border-none cursor-pointer" style={{ color: "var(--text-muted)" }}>
                      <ChevronRight size={16} />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2 mt-1 pt-2" style={{ borderTop: "1px solid var(--border-light)" }}>
          <Button variant="secondary" onClick={onDismiss}>ปิด</Button>
          <Button variant="primary" icon={<Plus size={15} />} onClick={onNew}>เริ่มใบใหม่</Button>
        </div>
      </div>
    </Dialog>
  );
}
