"use client";

import { useState } from "react";
import { FileText, Plus, ChevronRight, Trash2, Loader2 } from "lucide-react";
import { Dialog, Button } from "@/components/ui";
import type { TravelBookingDraftSummary } from "@/features/travel-booking/types";

function fmtSpan(from: string | null, to: string | null): string {
  if (!from && !to) return "ยังไม่ระบุวันเดินทาง";
  const fmt = (ymd: string) => {
    const [y, m, d] = ymd.split("-");
    return `${d}/${m}/${y}`;
  };
  if (from && to && from !== to) return `${fmt(from)} – ${fmt(to)}`;
  return fmt(from ?? to ?? "");
}

function fmtUpdatedAt(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

interface Props {
  open: boolean;
  drafts: TravelBookingDraftSummary[];
  onPickDraft: (groupKey: string) => void;
  onNew: () => void;
  onDismiss: () => void;
  /** Delete a draft group by GroupKey; should resolve once the server confirms. */
  onDeleteDraft: (groupKey: string) => Promise<void>;
}

export function TravelBookingDraftPicker({ open, drafts, onPickDraft, onNew, onDismiss, onDeleteDraft }: Props) {
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const handleConfirmDelete = async (groupKey: string) => {
    setDeletingKey(groupKey);
    try {
      await onDeleteDraft(groupKey);
      setConfirmKey(null);
    } finally {
      setDeletingKey(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => { if (!v) onDismiss(); }}
      title="เลือกแบบร่างหรือสร้างใหม่"
      description="พบแบบร่างคำขอจองที่พัก/ตั๋วโดยสารที่บันทึกไว้ — เลือกเปิดต่อหรือเริ่มคำขอใหม่"
      contentClassName="max-w-md"
      uniformSurface
    >
      <div className="flex flex-col gap-3">
        <p className="text-[13px] m-0" style={{ color: "var(--text-muted)" }}>
          คุณมีแบบร่างคำขอ {drafts.length} รายการ
        </p>

        <ul className="flex flex-col gap-2 m-0 p-0 list-none max-h-[min(50vh,320px)] overflow-y-auto">
          {drafts.map((d) =>
            confirmKey === d.groupKey ? (
              <li key={d.groupKey}>
                <div
                  className="rounded-xl p-3.5 flex items-center gap-3"
                  style={{
                    background: "color-mix(in srgb, var(--color-danger) 7%, var(--bg-card-alt))",
                    border: "1px solid color-mix(in srgb, var(--color-danger) 35%, transparent)",
                  }}
                >
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: "color-mix(in srgb, var(--color-danger) 14%, transparent)", color: "var(--color-danger)" }}
                  >
                    <Trash2 size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-bold m-0" style={{ color: "var(--text-heading)" }}>
                      ลบแบบร่างนี้?
                    </p>
                    <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
                      {d.tabCount} Request · {fmtSpan(d.departDate, d.returnDate)} · ลบแล้วกู้คืนไม่ได้
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmKey(null)}
                    disabled={deletingKey === d.groupKey}
                    className="text-[12px] font-semibold px-3 py-1.5 rounded-lg cursor-pointer"
                    style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", color: "var(--text-secondary)" }}
                  >
                    ยกเลิก
                  </button>
                  <button
                    type="button"
                    onClick={() => handleConfirmDelete(d.groupKey)}
                    disabled={deletingKey === d.groupKey}
                    className="text-[12px] font-bold px-3 py-1.5 rounded-lg cursor-pointer border-none flex items-center gap-1.5"
                    style={{ background: "var(--color-danger)", color: "#fff", opacity: deletingKey === d.groupKey ? 0.6 : 1 }}
                  >
                    {deletingKey === d.groupKey && <Loader2 size={13} className="animate-spin" />}
                    ลบ
                  </button>
                </div>
              </li>
            ) : (
              <li key={d.groupKey} className="flex items-stretch gap-1.5">
                <button
                  type="button"
                  onClick={() => onPickDraft(d.groupKey)}
                  className="flex-1 min-w-0 text-left rounded-xl p-3.5 transition-colors cursor-pointer border-none"
                  style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                      style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
                    >
                      <FileText size={16} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>
                          {fmtSpan(d.departDate, d.returnDate)}
                        </span>
                        <span
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                          style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
                        >
                          {d.tabCount} Request{d.tabCount > 1 ? "s" : ""}
                        </span>
                        {d.provinceName && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}>
                            {d.provinceName}
                          </span>
                        )}
                      </div>
                      {d.workDetail?.trim() && (
                        <p className="text-[12px] m-0 mb-1 line-clamp-2" style={{ color: "var(--text-secondary)" }}>
                          {d.workDetail.trim()}
                        </p>
                      )}
                      <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
                        อัปเดต {fmtUpdatedAt(d.updatedAt)}
                      </p>
                    </div>
                    <ChevronRight size={16} className="shrink-0 mt-1" style={{ color: "var(--text-faint)" }} />
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmKey(d.groupKey)}
                  aria-label="ลบแบบร่าง"
                  title="ลบแบบร่าง"
                  className="shrink-0 w-10 rounded-xl flex items-center justify-center cursor-pointer transition-colors"
                  style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)", color: "var(--text-muted)" }}
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ),
          )}
        </ul>

        <div className="pt-3 flex flex-col sm:flex-row gap-2 sm:justify-end" style={{ borderTop: "1px solid var(--border-light)" }}>
          <Button type="button" variant="primary" icon={<Plus size={15} />} onClick={onNew}>
            สร้างคำขอใหม่
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
