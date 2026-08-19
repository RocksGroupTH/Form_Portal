"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  FileSpreadsheet,
  FileText,
  ImageIcon,
  Loader2,
  Paperclip,
  Trash2,
  Upload,
} from "lucide-react";
import { ImageLightbox } from "@/features/accounting/components/ImageLightbox";
import type { ReimburseFileMeta } from "@/features/reimburse/types";

/**
 * AP-4's two attachment slots (spec §5.2 fields 4b and 5).
 *
 * They are two different documents and are drawn as two separate controls, not
 * as one uploader with a file-type hint:
 *
 * - **the AP-4.1 workbook** — exactly one, and a second upload replaces it.
 *   `AccReimburse.ExcelFileId` is a pointer, and the upload route repoints it
 *   before removing the file it supersedes, so replacing is a single action
 *   here rather than delete-then-attach.
 * - **the receipts** — many, images or PDF.
 *
 * Both upload against `/api/request/reimburse/requests/[id]/files`, which needs
 * a saved request, so a file chosen on an unsaved form is held in memory and
 * uploaded by the next save — the same shape AP-1 and AP-17 use. The multipart
 * field is **`files`** (plural) and the slot is chosen by `refType`; the form
 * owns that call, this component only collects.
 */

const EXCEL_ACCEPT =
  ".xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.ms-excel.sheet.macroEnabled.12";
const RECEIPT_ACCEPT = "image/*,application/pdf,.pdf";

function fmtSize(bytes: number | null | undefined): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(contentType: string | null | undefined, name: string): boolean {
  if (contentType?.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(name);
}

/**
 * A stable React key per pending `File`.
 *
 * A `File` carries no id, and keying these rows by array index hands row 2's
 * DOM node to row 3 the moment row 2 is removed. Two picks of the same file are
 * two distinct `File` objects, so identical names and sizes still key apart.
 */
let pendingKeySeq = 0;
const pendingKeys = new WeakMap<File, string>();
function pendingKeyOf(file: File): string {
  let key = pendingKeys.get(file);
  if (key === undefined) {
    pendingKeySeq += 1;
    key = "pending-" + pendingKeySeq;
    pendingKeys.set(file, key);
  }
  return key;
}

/* ─────────────────────────── slot shell ─────────────────────────── */

function SlotShell({
  icon,
  title,
  hint,
  hasError,
  children,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  hint: string;
  hasError?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-xl px-4 py-3.5 flex flex-col gap-3 min-w-0"
      style={{
        background: "var(--bg-card-alt)",
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: hasError ? "var(--color-danger)" : "var(--border-card)",
      }}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        <span
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p
            className="text-[13px] font-bold m-0"
            style={{ color: hasError ? "var(--color-danger)" : "var(--text-heading)" }}
          >
            {title}
          </p>
          <p className="text-[11.5px] leading-relaxed m-0" style={{ color: "var(--text-muted)" }}>
            {hint}
          </p>
        </div>
      </div>
      {children}
    </div>
  );
}

function PickButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="self-start inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12.5px] font-bold text-white border-none cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
      style={{ background: "var(--color-action)" }}
    >
      <Paperclip size={14} /> {label}
    </button>
  );
}

/** One row in a slot's file list. */
function FileRow({
  icon,
  name,
  meta,
  href,
  onPreview,
  onRemove,
  removing,
  pending,
}: {
  icon: React.ReactNode;
  name: string;
  meta: string;
  href?: string;
  onPreview?: () => void;
  onRemove: () => void;
  removing?: boolean;
  pending?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-2.5 rounded-lg px-3 py-2 min-w-0"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
    >
      <span className="shrink-0" style={{ color: "var(--nav-active-text)" }}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        {onPreview ? (
          <button
            type="button"
            onClick={onPreview}
            className="block w-full text-left text-[12.5px] font-semibold truncate cursor-zoom-in border-none bg-transparent p-0"
            style={{ color: "var(--text-primary)" }}
            title={name}
          >
            {name}
          </button>
        ) : href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-[12.5px] font-semibold truncate no-underline"
            style={{ color: "var(--text-primary)" }}
            title={name}
          >
            {name}
          </a>
        ) : (
          <span
            className="block text-[12.5px] font-semibold truncate"
            style={{ color: "var(--text-primary)" }}
            title={name}
          >
            {name}
          </span>
        )}
        <span className="block text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
          {pending ? "จะอัปโหลดเมื่อกดบันทึกร่าง/ส่งคำขอ" : meta}
        </span>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={removing}
        aria-label={`ลบไฟล์ ${name}`}
        title="ลบไฟล์"
        className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border-none disabled:opacity-60"
        style={{ background: "var(--bg-card-alt)", color: "var(--color-danger)" }}
      >
        {removing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
      </button>
    </div>
  );
}

/* ─────────────────────────── the two slots ─────────────────────────── */

export function ReimburseAttachments({
  excelFile,
  receiptFiles,
  pendingExcel,
  pendingReceipts,
  onSelectExcel,
  onAddReceipts,
  onRemovePendingReceipt,
  onDeleteStored,
  excelError,
  receiptError,
}: {
  excelFile: ReimburseFileMeta | null;
  receiptFiles: ReimburseFileMeta[];
  /** Chosen but not yet uploaded — a saved request id is needed first. */
  pendingExcel: File | null;
  pendingReceipts: File[];
  onSelectExcel: (file: File | null) => void;
  onAddReceipts: (files: File[]) => void;
  onRemovePendingReceipt: (index: number) => void;
  /** Delete an already-uploaded file; resolves true once the server confirms. */
  onDeleteStored: (fileId: number) => Promise<boolean>;
  excelError?: boolean;
  receiptError?: boolean;
}) {
  const excelInputRef = useRef<HTMLInputElement>(null);
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Object URLs for the not-yet-uploaded receipt previews, revoked together
  // whenever the pending set changes so a long editing session cannot leak them.
  const pendingReceiptUrls = useMemo(
    () => pendingReceipts.map((f) => (f.type.startsWith("image/") ? URL.createObjectURL(f) : null)),
    [pendingReceipts],
  );
  useEffect(
    () => () => {
      for (const url of pendingReceiptUrls) if (url) URL.revokeObjectURL(url);
    },
    [pendingReceiptUrls],
  );

  const handleRemoveStored = async (fileId: number) => {
    setRemovingId(fileId);
    try {
      await onDeleteStored(fileId);
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-3 min-w-0">
      {/* ── 4b · the AP-4.1 workbook — exactly one ── */}
      <SlotShell
        icon={<FileSpreadsheet size={16} />}
        title="ไฟล์ Excel สรุปรายการ (AP-4.1)"
        hint="แนบได้ 1 ไฟล์ (.xlsx / .xls / .xlsm) — แนบใหม่จะแทนที่ไฟล์เดิม"
        hasError={excelError}
      >
        <input
          ref={excelInputRef}
          type="file"
          accept={EXCEL_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            if (file) onSelectExcel(file);
            e.target.value = "";
          }}
        />

        {pendingExcel ? (
          <FileRow
            icon={<FileSpreadsheet size={16} />}
            name={pendingExcel.name}
            meta={fmtSize(pendingExcel.size)}
            pending
            onRemove={() => onSelectExcel(null)}
          />
        ) : excelFile ? (
          <FileRow
            icon={<FileSpreadsheet size={16} />}
            name={excelFile.fileName}
            meta={fmtSize(excelFile.fileSize)}
            href={excelFile.url}
            onRemove={() => handleRemoveStored(excelFile.id)}
            removing={removingId === excelFile.id}
          />
        ) : null}

        <PickButton
          label={pendingExcel || excelFile ? "เปลี่ยนไฟล์ Excel" : "เลือกไฟล์ Excel"}
          onClick={() => excelInputRef.current?.click()}
        />
      </SlotShell>

      {/* ── 5 · receipts and tax invoices — many ── */}
      <SlotShell
        icon={<Upload size={16} />}
        title="หลักฐาน (ใบเสร็จ / ใบกำกับภาษี)"
        hint="แนบได้หลายไฟล์ — รูปภาพ หรือ PDF"
        hasError={receiptError}
      >
        <input
          ref={receiptInputRef}
          type="file"
          accept={RECEIPT_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            const picked = e.target.files ? Array.from(e.target.files) : [];
            if (picked.length > 0) onAddReceipts(picked);
            e.target.value = "";
          }}
        />

        {(receiptFiles.length > 0 || pendingReceipts.length > 0) && (
          <div className="flex flex-col gap-2">
            {receiptFiles.map((f) => {
              const image = isImage(f.contentType, f.fileName);
              return (
                <FileRow
                  key={f.id}
                  icon={image ? <ImageIcon size={16} /> : <FileText size={16} />}
                  name={f.fileName}
                  meta={fmtSize(f.fileSize)}
                  href={image ? undefined : f.url}
                  onPreview={image ? () => setLightboxSrc(f.url) : undefined}
                  onRemove={() => handleRemoveStored(f.id)}
                  removing={removingId === f.id}
                />
              );
            })}
            {pendingReceipts.map((f, i) => (
              <FileRow
                key={pendingKeyOf(f)}
                icon={
                  pendingReceiptUrls[i] ? <ImageIcon size={16} /> : <FileText size={16} />
                }
                name={f.name}
                meta={fmtSize(f.size)}
                pending
                onPreview={
                  pendingReceiptUrls[i] ? () => setLightboxSrc(pendingReceiptUrls[i]!) : undefined
                }
                onRemove={() => onRemovePendingReceipt(i)}
              />
            ))}
          </div>
        )}

        <PickButton
          label={receiptFiles.length + pendingReceipts.length > 0 ? "เพิ่มหลักฐาน" : "เลือกไฟล์หลักฐาน"}
          onClick={() => receiptInputRef.current?.click()}
        />
      </SlotShell>

      <ImageLightbox
        open={!!lightboxSrc}
        src={lightboxSrc ?? ""}
        onClose={() => setLightboxSrc(null)}
      />
    </div>
  );
}
