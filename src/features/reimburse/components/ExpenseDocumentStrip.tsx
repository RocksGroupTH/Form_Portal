"use client";

import { useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, FileText, Loader2, Paperclip, X } from "lucide-react";
import type { ReimburseFileMeta } from "@/features/reimburse/types";
import { AttachmentViewer, attachmentKind, type AttachmentKind, type AttachmentSource } from "./AttachmentViewer";

/**
 * AP-4's one attachment control: a wide drop zone, then a strip of thumbnails.
 *
 * It replaces two things at once — the separate "เอกสารแนบ" card and the
 * per-row scan button — because both were places to attach a file, and a form
 * with two of those makes the requester decide something that does not matter.
 * Attaching here is what creates expense rows; see `ReimburseForm`.
 *
 * The tile shape is AP-1's (`ExpenseRows`), deliberately: a 14×14 button, the
 * amber "ยังไม่บันทึก" band on anything not yet uploaded, and a remove badge
 * clipped to the corner. Two forms showing attachments two different ways is a
 * cost paid by every person who uses both.
 *
 * What is **not** copied from AP-1 is the image-only assumption. AP-4 takes
 * PDFs and workbooks too, so a tile is either a picture or a typed icon, and
 * clicking any of them opens `AttachmentViewer` rather than an image lightbox.
 */

/** A file chosen but not yet uploaded — no request id exists until the first save. */
export interface PendingDocument {
  /** Stable across re-renders; `File` carries no identity of its own. */
  localId: string;
  file: File;
  /** Set while this file is being read into rows. */
  reading?: boolean;
}

export function ExpenseDocumentStrip({
  storedFiles,
  pending,
  onPick,
  onRemovePending,
  onRemoveStored,
  removingId,
  disabled,
  hasError,
}: {
  storedFiles: ReimburseFileMeta[];
  pending: PendingDocument[];
  onPick: (files: File[]) => void;
  onRemovePending: (localId: string) => void;
  /** Resolves once the server confirms; the caller owns the toast. */
  onRemoveStored: (fileId: number) => Promise<boolean>;
  removingId: number | null;
  /** True while any file is being read — the zone is inert rather than hidden. */
  disabled?: boolean;
  hasError?: boolean;
}) {
  const [viewing, setViewing] = useState<{ source: AttachmentSource; kind: AttachmentKind } | null>(
    null,
  );

  /**
   * Object URLs for the picture thumbnails, revoked together whenever the
   * pending set changes so a long editing session cannot leak them. Non-image
   * files get no URL and show a typed icon instead.
   */
  const previewUrls = useMemo(
    () => pending.map((p) => (p.file.type.startsWith("image/") ? URL.createObjectURL(p.file) : null)),
    [pending],
  );
  useEffect(
    () => () => {
      for (const u of previewUrls) if (u) URL.revokeObjectURL(u);
    },
    [previewUrls],
  );

  return (
    <div className="flex flex-col gap-2.5 min-w-0">
      <input
        id="ap4-doc-input"
        type="file"
        accept={ATTACHMENT_ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files ? Array.from(e.target.files) : [];
          if (picked.length > 0) onPick(picked);
          // Cleared so re-picking the same file still fires `change`.
          e.target.value = "";
        }}
      />

      <button
        type="button"
        disabled={disabled}
        onClick={() => document.getElementById("ap4-doc-input")?.click()}
        className="w-full rounded-xl px-4 py-5 flex flex-col items-center justify-center gap-1.5 cursor-pointer acc-add-row disabled:cursor-not-allowed disabled:opacity-70"
        style={{
          border: `1px dashed ${hasError ? "var(--color-danger)" : "var(--border-card)"}`,
          background: "var(--bg-card-alt)",
          color: "var(--text-secondary)",
        }}
      >
        <span className="flex items-center gap-2 text-[13.5px] font-bold">
          <Paperclip size={16} /> แนบเอกสารที่นี่ — ระบบจะอ่านข้อมูลมาสร้างรายการให้
        </span>
        <span className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>
          รูปภาพ · PDF · Excel — แนบได้หลายไฟล์
        </span>
      </button>

      {(storedFiles.length > 0 || pending.length > 0) && (
        // Scrolls inside itself rather than wrapping, so the block's height
        // never changes as files are added and nothing below it moves. The
        // asymmetric padding is headroom for the remove badge, which sits
        // outside each tile and would otherwise be clipped.
        <div className="flex flex-nowrap items-center gap-2.5 overflow-x-auto pt-1.5 -mt-1.5 pb-1 pr-1.5">
          {storedFiles.map((f) => (
            <div key={`s-${f.id}`} className="relative w-14 h-14 shrink-0">
              <Tile
                title={`${f.fileName} — คลิกเพื่อเปิดดู`}
                imageSrc={isImageMeta(f) ? f.url : null}
                kind={attachmentKind(f.fileName, f.contentType)}
                onClick={() =>
                  setViewing({
                    source: { name: f.fileName, url: f.url },
                    kind: attachmentKind(f.fileName, f.contentType),
                  })
                }
              />
              <RemoveBadge
                label={`ลบไฟล์ ${f.fileName}`}
                busy={removingId === f.id}
                onClick={() => void onRemoveStored(f.id)}
              />
            </div>
          ))}

          {pending.map((p, i) => (
            <div key={`p-${p.localId}`} className="relative w-14 h-14 shrink-0">
              <Tile
                title={`${p.file.name} — ยังไม่บันทึก · คลิกเพื่อเปิดดู`}
                imageSrc={previewUrls[i]}
                kind={attachmentKind(p.file.name, p.file.type)}
                pending
                reading={p.reading}
                onClick={() =>
                  setViewing({
                    source: { name: p.file.name, file: p.file },
                    kind: attachmentKind(p.file.name, p.file.type),
                  })
                }
              />
              <RemoveBadge
                label={`เอาไฟล์ ${p.file.name} ออก`}
                onClick={() => onRemovePending(p.localId)}
              />
            </div>
          ))}
        </div>
      )}

      <AttachmentViewer
        open={viewing !== null}
        source={viewing?.source ?? null}
        kind={viewing?.kind ?? "other"}
        onClose={() => setViewing(null)}
      />
    </div>
  );
}

/**
 * What the picker offers — a convenience, not a control. `accept` filters the
 * file dialog; the magic-byte check on the upload route is what decides.
 */
const ATTACHMENT_ACCEPT =
  "image/*,application/pdf,.pdf,.xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.ms-excel.sheet.macroEnabled.12";

function isImageMeta(f: ReimburseFileMeta): boolean {
  return attachmentKind(f.fileName, f.contentType) === "image";
}

function Tile({
  title,
  imageSrc,
  kind,
  pending,
  reading,
  onClick,
}: {
  title: string;
  imageSrc: string | null;
  kind: AttachmentKind;
  pending?: boolean;
  reading?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      // `relative` is load-bearing: it makes this button the band's containing
      // block, which is what lets `overflow-hidden` clip the band to the tile's
      // rounded corner.
      className="relative w-full h-full rounded-xl overflow-hidden cursor-pointer p-0 border flex items-center justify-center"
      style={{
        borderColor: pending ? "var(--color-warning)" : "var(--border-card)",
        background: "var(--bg-card)",
        color: "var(--nav-active-text)",
      }}
    >
      {imageSrc ? (
        <img src={imageSrc} alt="" className="w-full h-full object-cover" draggable={false} />
      ) : kind === "excel" ? (
        <FileSpreadsheet size={22} />
      ) : (
        <FileText size={22} />
      )}

      {reading && (
        <span
          className="absolute inset-0 flex items-center justify-center"
          style={{ background: "color-mix(in srgb, var(--bg-card) 70%, transparent)" }}
        >
          <Loader2 size={16} className="animate-spin" style={{ color: "var(--nav-active-text)" }} />
        </span>
      )}

      {pending && !reading && (
        <span
          className="absolute bottom-0 left-0 right-0 text-[8px] font-bold text-center leading-tight py-0.5"
          style={{ background: "color-mix(in srgb, var(--color-warning) 85%, transparent)", color: "#fff" }}
        >
          ยังไม่บันทึก
        </span>
      )}
    </button>
  );
}

function RemoveBadge({
  label,
  busy,
  onClick,
}: {
  label: string;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-label={label}
      title={label}
      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center cursor-pointer border-none disabled:opacity-60"
      style={{
        background: "var(--btn-danger-bg)",
        color: "var(--btn-danger-text)",
        border: "1px solid var(--btn-danger-border)",
      }}
    >
      {busy ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
    </button>
  );
}
