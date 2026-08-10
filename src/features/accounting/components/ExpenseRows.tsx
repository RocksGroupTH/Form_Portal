"use client";

import React, { useRef, useState } from "react";
import { Plus, Trash2, Paperclip, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui";
import { ImageLightbox } from "@/features/accounting/components/ImageLightbox";
import type { TravelExpenseItem, PendingFile } from "@/features/accounting/types";
import type { TravelItemType } from "@/features/accounting/constants";

interface ExpenseRowsProps {
  label: string;
  type: TravelItemType;
  items: TravelExpenseItem[];
  onAdd: () => void;
  onUpdate: (idx: number, patch: Partial<TravelExpenseItem>) => void;
  onRemove: (idx: number) => void;
  /** After a failed submit: flag rows that have an amount but no receipt image. */
  highlightMissingReceipt?: boolean;
  /** Saved request id — enables deleting already-uploaded images (Draft editing). */
  requestId?: number;
}

const inputStyle: React.CSSProperties = {
  background: "var(--bg-input)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-input)",
};

export function ExpenseRows({
  label,
  type,
  items,
  onAdd,
  onUpdate,
  onRemove,
  highlightMissingReceipt = false,
  requestId,
}: ExpenseRowsProps) {
  const rowItems = items.filter((it) => it.itemType === type);
  const allItems = items;

  // Get the global index for a filtered item (to pass to onUpdate/onRemove)
  const globalIndex = (filteredIdx: number): number => {
    let count = 0;
    for (let i = 0; i < allItems.length; i++) {
      if (allItems[i].itemType === type) {
        if (count === filteredIdx) return i;
        count++;
      }
    }
    return -1;
  };

  const handleAmountChange = (filteredIdx: number, raw: string) => {
    const amount = parseFloat(raw) || 0;
    const gi = globalIndex(filteredIdx);
    if (gi >= 0) onUpdate(gi, { amount });
  };

  const handleRemove = (filteredIdx: number) => {
    const gi = globalIndex(filteredIdx);
    if (gi >= 0) onRemove(gi);
  };

  return (
    <div className="w-full">
      <div className="mb-2">
        <label
          className="text-[13px] font-medium"
          style={{ color: "var(--text-secondary)" }}
        >
          {label}
        </label>
      </div>

      {/* Always-present add row — pinned to the top (new rows appear just below) */}
      <button
        type="button"
        onClick={onAdd}
        className="w-full flex items-center justify-center gap-1.5 py-2.5 mb-2 rounded-xl text-[13px] font-medium cursor-pointer transition-colors acc-add-row"
        style={{
          border: "1px dashed var(--border-card)",
          background: "transparent",
          color: "var(--text-muted)",
        }}
      >
        <Plus size={13} /> เพิ่มรายการ
      </button>

      <div className="flex flex-col gap-2">
        {rowItems.map((item, filteredIdx) => (
          <ExpenseRow
            key={filteredIdx}
            item={item}
            requestId={requestId}
            highlightMissingReceipt={highlightMissingReceipt}
            onAmountChange={(val) => handleAmountChange(filteredIdx, val)}
            onRemove={() => handleRemove(filteredIdx)}
            onPendingAdd={(pf) => {
              const gi = globalIndex(filteredIdx);
              if (gi < 0) return;
              const existing = allItems[gi].pendingFiles ?? [];
              onUpdate(gi, { pendingFiles: [...existing, pf] });
            }}
            onPendingRemove={(localId) => {
              const gi = globalIndex(filteredIdx);
              if (gi < 0) return;
              const existing = allItems[gi].pendingFiles ?? [];
              const target = existing.find((p) => p.localId === localId);
              if (target) URL.revokeObjectURL(target.previewUrl);
              onUpdate(gi, { pendingFiles: existing.filter((p) => p.localId !== localId) });
            }}
            onUploadedRemove={(fileId) => {
              const gi = globalIndex(filteredIdx);
              if (gi < 0) return;
              const existing = allItems[gi].files ?? [];
              onUpdate(gi, { files: existing.filter((f) => f.id !== fileId) });
            }}
          />
        ))}
      </div>

      {rowItems.length > 0 && (
        <div
          className="flex justify-end mt-2 pt-2"
          style={{ borderTop: "1px solid var(--border-light)" }}
        >
          <span className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            รวม:{" "}
            <span className="font-bold" style={{ color: "var(--text-primary)" }}>
              {rowItems
                .reduce((s, i) => s + (Number(i.amount) || 0), 0)
                .toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>{" "}
            บาท
          </span>
        </div>
      )}
    </div>
  );
}

/* ── Single row ── */

interface ExpenseRowProps {
  item: TravelExpenseItem;
  requestId?: number;
  highlightMissingReceipt?: boolean;
  onAmountChange: (val: string) => void;
  onRemove: () => void;
  onPendingAdd: (file: PendingFile) => void;
  onPendingRemove: (localId: string) => void;
  onUploadedRemove: (fileId: number) => void;
}

function ExpenseRow({
  item,
  requestId,
  highlightMissingReceipt = false,
  onAmountChange,
  onRemove,
  onPendingAdd,
  onPendingRemove,
  onUploadedRemove,
}: ExpenseRowProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);
  // Pending confirmation for destructive actions on already-saved data.
  const [confirm, setConfirm] = useState<{ kind: "file"; fileId: number } | { kind: "row" } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const uploaded = item.files ?? [];
  const pending = item.pendingFiles ?? [];
  const totalFiles = uploaded.length + pending.length;
  const needsReceipt = highlightMissingReceipt && Number(item.amount) > 0 && totalFiles === 0;
  // A row is "saved" once it has a DB id (persisted by a previous save/submit).
  const isSaved = item.id != null;

  // Delete an already-uploaded image (only possible while editing a saved draft).
  const handleRemoveUploaded = async (fileId: number) => {
    if (!requestId || removingId != null) return;
    setRemovingId(fileId);
    try {
      const res = await fetch(
        `/api/request/accounting/requests/${requestId}/files?fileId=${fileId}`,
        { method: "DELETE" },
      );
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error ?? "ลบรูปไม่สำเร็จ");
        return;
      }
      onUploadedRemove(fileId);
      toast.success("ลบรูปแล้ว");
    } catch {
      toast.error("ลบรูปไม่สำเร็จ");
    } finally {
      setRemovingId(null);
    }
  };

  // Run the confirmed destructive action.
  const runConfirm = async () => {
    if (!confirm) return;
    setConfirming(true);
    try {
      if (confirm.kind === "file") {
        await handleRemoveUploaded(confirm.fileId);
      } else {
        // Saved row → delete from the server immediately (no save step needed).
        if (isSaved && requestId && item.id != null) {
          const res = await fetch(
            `/api/request/accounting/requests/${requestId}/items/${item.id}`,
            { method: "DELETE" },
          );
          const json = await res.json();
          if (!json.ok) {
            toast.error(json.error ?? "ลบรายการไม่สำเร็จ");
            return;
          }
          toast.success("ลบรายการแล้ว");
        }
        onRemove();
      }
      setConfirm(null);
    } finally {
      setConfirming(false);
    }
  };

  // Row delete: confirm only when the row was already saved; new rows go instantly.
  const handleRowRemove = () => {
    if (isSaved) setConfirm({ kind: "row" });
    else onRemove();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("แนบได้เฉพาะไฟล์รูปภาพเท่านั้น");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    // Hold in memory; the form uploads it on save / submit (no need to save a draft first).
    onPendingAdd({
      localId: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      file,
      previewUrl: URL.createObjectURL(file),
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div
      className="flex flex-col gap-2 p-2.5 rounded-xl"
      style={{
        background: "var(--bg-card-alt)",
        border: needsReceipt ? "1px solid var(--color-danger)" : "1px solid var(--border-card)",
        boxShadow: needsReceipt ? "0 0 0 1px var(--color-danger)" : undefined,
      }}
    >
      <div className="flex items-center gap-2">
        {/* File attach (left) — chip reflects attach state */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="แนบรูปใบเสร็จ (รูปภาพเท่านั้น)"
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-semibold cursor-pointer transition-colors"
          style={
            totalFiles > 0
              ? { background: "var(--nav-active-bg)", color: "var(--nav-active-text)", border: "1px solid var(--nav-active-text)" }
              : { background: "var(--bg-card)", color: "var(--text-secondary)", border: "1px solid var(--border-card)" }
          }
        >
          <Paperclip size={13} />
          {totalFiles > 0 ? `${totalFiles} รูป` : "แนบรูป"}
        </button>

        {/* Amount (right) — label, number right-aligned, ฿ suffix */}
        <div className="relative ml-auto w-44 sm:w-52 shrink-0">
          <input
            type="number"
            min="0"
            step="1"
            placeholder="จำนวนเงิน"
            value={item.amount || ""}
            onChange={(e) => onAmountChange(e.target.value)}
            className="w-full rounded-lg pl-3 pr-7 py-2 text-[15px] font-bold outline-none tabular-nums text-right"
            style={inputStyle}
          />
          <span
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[14px] font-bold pointer-events-none"
            style={{ color: "var(--text-muted)" }}
          >
            ฿
          </span>
        </div>

        {/* Remove */}
        <button
          type="button"
          onClick={handleRowRemove}
          aria-label="ลบแถวนี้"
          title="ลบแถวนี้"
          className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer acc-draft-del"
          style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", color: "var(--text-muted)" }}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Thumbnails — uploaded + pending; click to open zoomable lightbox */}
      {totalFiles > 0 && (
        <div className="flex flex-wrap gap-2">
          {uploaded.map((f) => (
            <div key={`u-${f.id}`} className="relative w-16 h-16">
              <button
                type="button"
                onClick={() => setLightbox({ src: f.url, alt: f.fileName })}
                className="w-full h-full rounded-xl overflow-hidden cursor-pointer p-0 border"
                style={{ borderColor: "var(--border-card)", background: "var(--bg-card)" }}
                title={`${f.fileName} — คลิกเพื่อดูรูปเต็ม`}
              >
                <img src={f.url} alt={f.fileName} className="w-full h-full object-cover" draggable={false} />
              </button>
              {/* Delete uploaded image — only while editing a saved draft */}
              {requestId != null && (
                <button
                  type="button"
                  onClick={() => setConfirm({ kind: "file", fileId: f.id })}
                  disabled={removingId != null}
                  aria-label="ลบรูป"
                  title="ลบรูป"
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center cursor-pointer border-none"
                  style={{ background: "var(--color-danger)", color: "#fff", opacity: removingId === f.id ? 0.6 : 1 }}
                >
                  {removingId === f.id ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
                </button>
              )}
            </div>
          ))}
          {pending.map((p) => (
            <div key={`p-${p.localId}`} className="relative w-16 h-16">
              <button
                type="button"
                onClick={() => setLightbox({ src: p.previewUrl, alt: p.file.name })}
                className="w-full h-full rounded-xl overflow-hidden cursor-pointer p-0 border"
                style={{ borderColor: "var(--color-warning)", background: "var(--bg-card)" }}
                title={`${p.file.name} — ยังไม่บันทึก · คลิกเพื่อดูรูปเต็ม`}
              >
                <img src={p.previewUrl} alt={p.file.name} className="w-full h-full object-cover" draggable={false} />
              </button>
              {/* Pending badge */}
              <span
                className="absolute bottom-0 left-0 right-0 text-[8px] font-bold text-center leading-tight py-0.5"
                style={{ background: "color-mix(in srgb, var(--color-warning) 85%, transparent)", color: "#fff" }}
              >
                ยังไม่บันทึก
              </span>
              {/* Remove pending */}
              <button
                type="button"
                onClick={() => onPendingRemove(p.localId)}
                aria-label="เอารูปออก"
                title="เอารูปออก"
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center cursor-pointer border-none"
                style={{ background: "var(--color-danger)", color: "#fff" }}
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {needsReceipt && (
        <p className="text-[12px] font-medium" style={{ color: "var(--color-danger)" }}>
          ต้องแนบรูปใบเสร็จสำหรับรายการที่กรอกจำนวนเงิน
        </p>
      )}

      <ImageLightbox
        open={lightbox != null}
        src={lightbox?.src ?? ""}
        alt={lightbox?.alt}
        onClose={() => setLightbox(null)}
      />

      {/* Confirm destructive action on saved data */}
      <Dialog
        open={confirm != null}
        onOpenChange={(v) => { if (!v && !confirming) setConfirm(null); }}
        title={confirm?.kind === "row" ? "ยืนยันการลบรายการ" : "ยืนยันการลบรูป"}
        uniformSurface
      >
        <p className="text-[14px] mb-6" style={{ color: "var(--text-secondary)" }}>
          {confirm?.kind === "row"
            ? "ลบรายการค่าใช้จ่ายนี้ (รวมถึงรูปที่แนบไว้) ออกจากคำขอทันที? ลบแล้วกู้คืนไม่ได้"
            : "ลบรูปนี้ออกจากคำขอ? ลบแล้วกู้คืนไม่ได้"}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirm(null)}
            disabled={confirming}
            className="text-[14px] font-medium px-4 py-2 rounded-lg cursor-pointer"
            style={{ color: "var(--text-secondary)", background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={runConfirm}
            disabled={confirming}
            className="inline-flex items-center gap-1.5 text-[14px] font-bold px-4 py-2 rounded-lg cursor-pointer border-none"
            style={{ background: "var(--color-danger)", color: "#fff", opacity: confirming ? 0.7 : 1 }}
          >
            {confirming && <Loader2 size={13} className="animate-spin" />}
            {confirm?.kind === "row" ? "ยืนยัน ลบรายการ" : "ยืนยัน ลบรูป"}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
