"use client";

import React, { useRef, useState } from "react";
import {
  Download,
  FileSpreadsheet,
  FileText,
  ImageIcon,
  Loader2,
  Paperclip,
  Trash2,
  Upload,
} from "lucide-react";
import {
  AttachmentViewer,
  attachmentKind,
  type AttachmentKind,
  type AttachmentSource,
} from "./AttachmentViewer";
import type { ReimburseFileMeta } from "@/features/reimburse/types";

/**
 * AP-4's attachments — one slot, many files, any accepted kind.
 *
 * It was two slots until 2026-08-25: the AP-4.1 workbook on its own, required,
 * accepting only spreadsheets, and the receipts, required, accepting only
 * images and PDF. Both are now the single
 * "หลักฐานประกอบการเบิกค่าใช้จ่ายจริง" list, and the rule at submit is
 * **at least one file** rather than one of each.
 *
 * Two consequences worth knowing:
 *
 * - **`AccReimburse.ExcelFileId` is read but never written.** A request filed
 *   under the old rule still has one, so its workbook arrives as `excelFile`
 *   and is listed alongside everything else. Hiding it would leave a stored
 *   file with no way to see or remove it. The delete route clears the pointer
 *   when that file goes.
 * - **Nothing was relaxed about *what* may be uploaded.** The route still
 *   sniffs magic bytes through `checkAttachment`; the widening is from two
 *   narrow lists to the one full list of kinds the guard can vouch for.
 *
 * Uploads go to `/api/request/reimburse/requests/[id]/files`, which needs a
 * saved request, so a file chosen on an unsaved form is held in memory and
 * uploaded by the next save — the shape AP-1 and AP-17 use too. The multipart
 * field is **`files`** (plural); the form owns that call, this component only
 * collects.
 */

/**
 * What the picker offers. It mirrors the server's `RECEIPT_KINDS`, and is a
 * convenience only — `accept` is a filter in the file dialog, not a control.
 * The magic-byte check on the route is the control.
 */
const ATTACHMENT_ACCEPT =
  "image/*,application/pdf,.pdf,.xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.ms-excel.sheet.macroEnabled.12";

function fmtSize(bytes: number | null | undefined): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The icon for a row, now that one list holds all three kinds — it is the only
 * thing telling a photo from a workbook at a glance.
 *
 * `attachmentKind` is the viewer's own classifier, reused rather than a second
 * set of extension patterns: a file the icon calls a spreadsheet and the viewer
 * calls something else would be the two disagreeing on screen.
 */
function fileIcon(contentType: string | null | undefined, name: string): React.ReactNode {
  switch (attachmentKind(name, contentType)) {
    case "image":
      return <ImageIcon size={16} />;
    case "excel":
      return <FileSpreadsheet size={16} />;
    default:
      return <FileText size={16} />;
  }
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
      {/* Downloading survives the viewer, and has to. The name above opens the
          preview once `onPreview` is given, so without this button a stored PDF
          — which used to be a plain link — would no longer be savable at all. */}
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`ดาวน์โหลด ${name}`}
          title="ดาวน์โหลด"
          className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center no-underline"
          style={{ background: "var(--bg-card-alt)", color: "var(--text-muted)" }}
        >
          <Download size={14} />
        </a>
      )}
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
  pendingReceipts,
  onAddReceipts,
  onRemovePendingReceipt,
  onDeleteStored,
  receiptError,
}: {
  /**
   * A request filed under the old two-slot rule, whose AP-4.1 workbook is
   * pointed at by `AccReimburse.ExcelFileId`.
   *
   * Listed with everything else rather than in a slot of its own. Nothing
   * writes that column any more, but dropping the value from the UI would hide
   * a file that is still stored, still counts towards the submit gate, and
   * still needs a way to be removed — the delete route clears the pointer when
   * it goes.
   */
  excelFile: ReimburseFileMeta | null;
  receiptFiles: ReimburseFileMeta[];
  /** Chosen but not yet uploaded — a saved request id is needed first. */
  pendingReceipts: File[];
  onAddReceipts: (files: File[]) => void;
  onRemovePendingReceipt: (index: number) => void;
  /** Delete an already-uploaded file; resolves true once the server confirms. */
  onDeleteStored: (fileId: number) => Promise<boolean>;
  receiptError?: boolean;
}) {
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);

  // The workbook first when there is one: it is the older file, and on a
  // resumed request it is what the requester attached before the photos.
  const storedFiles = excelFile ? [excelFile, ...receiptFiles] : receiptFiles;

  /**
   * What the viewer is showing, and how to render it.
   *
   * One piece of state for every slot: a stored PDF, a pending workbook and an
   * uploaded photo are the same question — "let me look at this" — and the
   * viewer resolves the bytes itself, so nothing here has to mint an object URL
   * per row the way the image-only preview used to.
   */
  const [viewing, setViewing] = useState<{ source: AttachmentSource; kind: AttachmentKind } | null>(
    null,
  );

  const viewStored = (f: ReimburseFileMeta) =>
    setViewing({
      source: { name: f.fileName, url: f.url },
      kind: attachmentKind(f.fileName, f.contentType),
    });

  const viewPending = (f: File) =>
    setViewing({ source: { name: f.name, file: f }, kind: attachmentKind(f.name, f.type) });

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
      {/* ── One slot: the AP-4.1 workbook and the receipt photos together ── */}
      <SlotShell
        icon={<Upload size={16} />}
        title="หลักฐานประกอบการเบิกค่าใช้จ่ายจริง (รูปถ่ายใบเสร็จ/ใบกำกับภาษี)"
        hint="แนบได้หลายไฟล์ — รูปภาพ, PDF หรือ Excel"
        hasError={receiptError}
      >
        <input
          ref={receiptInputRef}
          type="file"
          accept={ATTACHMENT_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            const picked = e.target.files ? Array.from(e.target.files) : [];
            if (picked.length > 0) onAddReceipts(picked);
            e.target.value = "";
          }}
        />

        {(storedFiles.length > 0 || pendingReceipts.length > 0) && (
          <div className="flex flex-col gap-2">
            {storedFiles.map((f) => (
              <FileRow
                key={f.id}
                icon={fileIcon(f.contentType, f.fileName)}
                name={f.fileName}
                meta={fmtSize(f.fileSize)}
                // Both: the name opens the viewer, the icon still downloads.
                href={f.url}
                onPreview={() => viewStored(f)}
                onRemove={() => handleRemoveStored(f.id)}
                removing={removingId === f.id}
              />
            ))}
            {pendingReceipts.map((f, i) => (
              <FileRow
                key={pendingKeyOf(f)}
                icon={fileIcon(f.type, f.name)}
                name={f.name}
                meta={fmtSize(f.size)}
                pending
                onPreview={() => viewPending(f)}
                onRemove={() => onRemovePendingReceipt(i)}
              />
            ))}
          </div>
        )}

        <PickButton
          label={storedFiles.length + pendingReceipts.length > 0 ? "เพิ่มไฟล์" : "เลือกไฟล์"}
          onClick={() => receiptInputRef.current?.click()}
        />
      </SlotShell>

      <AttachmentViewer
        open={viewing !== null}
        source={viewing?.source ?? null}
        kind={viewing?.kind ?? "other"}
        onClose={() => setViewing(null)}
      />
    </div>
  );
}
