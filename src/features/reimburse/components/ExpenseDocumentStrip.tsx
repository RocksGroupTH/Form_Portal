"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileSpreadsheet, FileText, Loader2, Maximize2, Paperclip, Plus, X } from "lucide-react";
import { FullScreenModal } from "@/components/ui/FullScreenModal";
import type { ReimburseFileMeta } from "@/features/reimburse/types";
import { isAcceptedDocument } from "@/features/reimburse/lib/document-accept";
import { AttachmentViewer, attachmentKind, type AttachmentKind, type AttachmentSource } from "./AttachmentViewer";

/**
 * AP-4's one attachment control: a framed drop zone with the attachments
 * *inside* it, in a single scrolling row that ends in an add tile.
 *
 * It replaces both the separate "เอกสารแนบ" card and the per-row scan button,
 * because both were places to attach a file and a form with two of those makes
 * the requester decide something that does not matter. Attaching here is what
 * creates expense rows; see `ReimburseForm`.
 *
 * **One row that scrolls, not a wrapping grid.** Wrapping grows the block's
 * height with every file, which pushes the expense rows down the page while
 * somebody is typing into them. The row's height is fixed whether there is one
 * attachment or twenty; "ดูเต็มจอ" is what the twenty case is for.
 *
 * The tile shape is AP-1's (`ExpenseRows`) — a 14×14 button, the amber
 * "ยังไม่บันทึก" band on anything not yet uploaded, a remove badge clipped to
 * the corner, and a dashed add tile at the end. Two forms showing attachments
 * two different ways is a cost paid by everybody who uses both.
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

/**
 * What the picker offers — a convenience, not a control. `accept` filters the
 * file dialog; `isAcceptedDocument` does the same for a drop, and the
 * magic-byte check on the upload route is what actually decides.
 */
const ATTACHMENT_ACCEPT =
  "image/*,application/pdf,.pdf,.xlsx,.xls,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.ms-excel.sheet.macroEnabled.12";

/** One thing to look at, whether it is stored or still in the browser. */
interface Entry {
  key: string;
  name: string;
  kind: AttachmentKind;
  source: AttachmentSource;
  /** A picture to show in the tile, or null for a typed icon. */
  previewUrl: string | null;
  pending: boolean;
  reading: boolean;
  onRemove: () => void;
  /** True while the server is being asked to delete this one. */
  removing: boolean;
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
  const inputRef = useRef<HTMLInputElement>(null);
  const [viewing, setViewing] = useState<{ source: AttachmentSource; kind: AttachmentKind } | null>(
    null,
  );
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);

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

  const entries: Entry[] = [
    ...storedFiles.map((f) => ({
      key: `s-${f.id}`,
      name: f.fileName,
      kind: attachmentKind(f.fileName, f.contentType),
      source: { name: f.fileName, url: f.url } as AttachmentSource,
      previewUrl: attachmentKind(f.fileName, f.contentType) === "image" ? f.url : null,
      pending: false,
      reading: false,
      onRemove: () => void onRemoveStored(f.id),
      removing: removingId === f.id,
    })),
    ...pending.map((p, i) => ({
      key: `p-${p.localId}`,
      name: p.file.name,
      kind: attachmentKind(p.file.name, p.file.type),
      source: { name: p.file.name, file: p.file } as AttachmentSource,
      previewUrl: previewUrls[i],
      pending: true,
      reading: !!p.reading,
      onRemove: () => onRemovePending(p.localId),
      removing: false,
    })),
  ];

  const openViewer = (e: Entry) => setViewing({ source: e.source, kind: e.kind });

  const takeFiles = useCallback(
    (files: File[]) => {
      const accepted = files.filter((f) => isAcceptedDocument(f.name, f.type));
      if (accepted.length > 0) onPick(accepted);
    },
    [onPick],
  );

  /**
   * Dragging over a child fires `dragleave` on the parent, so a plain boolean
   * flickers the highlight off as the pointer crosses a tile. Counting enter
   * and leave is the standard fix; the ref rather than state because it is
   * bookkeeping nothing renders from.
   */
  const dragDepth = useRef(0);

  const dropHandlers = disabled
    ? {}
    : {
        onDragEnter: (e: React.DragEvent) => {
          e.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        },
        onDragOver: (e: React.DragEvent) => {
          // Without this the browser navigates to the file instead of dropping.
          e.preventDefault();
        },
        onDragLeave: (e: React.DragEvent) => {
          e.preventDefault();
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) {
            dragDepth.current = 0;
            setDragging(false);
          }
        },
        onDrop: (e: React.DragEvent) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          takeFiles(Array.from(e.dataTransfer?.files ?? []));
        },
      };

  return (
    <div
      {...dropHandlers}
      className="rounded-xl px-3.5 py-3 flex flex-col gap-2.5 min-w-0 transition-colors"
      style={{
        border: `1px dashed ${
          dragging ? "var(--nav-active-text)" : hasError ? "var(--color-danger)" : "var(--border-card)"
        }`,
        background: dragging ? "var(--nav-active-bg)" : "var(--bg-card-alt)",
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ATTACHMENT_ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          takeFiles(e.target.files ? Array.from(e.target.files) : []);
          // Cleared so re-picking the same file still fires `change`.
          e.target.value = "";
        }}
      />

      <div className="flex items-center gap-2 min-w-0">
        <Paperclip size={15} className="shrink-0" style={{ color: "var(--nav-active-text)" }} />
        <span className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>
          เอกสารแนบ
        </span>
        <span className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>
          {entries.length > 0
            ? `${entries.length} ไฟล์ · ลากไฟล์มาวางได้`
            : "ลากไฟล์มาวาง หรือกดปุ่ม + — ระบบจะอ่านข้อมูลมาสร้างรายการให้"}
        </span>
        <span className="flex-1" />
        {entries.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold cursor-pointer border-none"
            style={{ background: "var(--bg-card)", color: "var(--nav-active-text)" }}
          >
            <Maximize2 size={13} /> ดูเต็มจอ
          </button>
        )}
      </div>

      {/* One row, scrolling inside itself. `shrink-0` on each tile is what makes
          flexbox scroll rather than squash them; the asymmetric padding is
          headroom for the remove badge, which sits outside each tile and would
          otherwise be clipped. */}
      <div className="flex flex-nowrap items-center gap-2.5 overflow-x-auto pt-1.5 -mt-1.5 pb-1 pr-1.5">
        {entries.map((e) => (
          <div key={e.key} className="relative w-14 h-14 shrink-0">
            <Tile
              title={`${e.name}${e.pending ? " — ยังไม่บันทึก" : ""} · คลิกเพื่อเปิดดู`}
              previewUrl={e.previewUrl}
              kind={e.kind}
              pending={e.pending}
              reading={e.reading}
              onClick={() => openViewer(e)}
            />
            <RemoveBadge label={`เอาไฟล์ ${e.name} ออก`} busy={e.removing} onClick={e.onRemove} />
          </div>
        ))}

        {/* Always last, always the same size as a tile: one control, one shape,
            whether the row holds nothing or nine. */}
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          aria-label="แนบเอกสารเพิ่ม"
          title={disabled ? "กำลังอ่านเอกสาร..." : "แนบเอกสารเพิ่ม"}
          className="w-14 h-14 shrink-0 rounded-xl flex items-center justify-center cursor-pointer acc-add-row disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            border: "1px dashed var(--border-card)",
            background: "var(--bg-card)",
            color: "var(--text-secondary)",
          }}
        >
          {disabled ? <Loader2 size={18} className="animate-spin" /> : <Plus size={20} />}
        </button>
      </div>

      <FullScreenModal open={expanded} onClose={() => setExpanded(false)} title="เอกสารแนบ">
        {entries.length === 0 ? (
          <p className="text-[13px] m-0" style={{ color: "var(--text-faint)" }}>
            — ยังไม่มีไฟล์ —
          </p>
        ) : (
          // A grid here rather than a row: the whole screen is the point, and
          // full names are what makes twenty attachments navigable at all.
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {entries.map((e) => (
              <button
                key={e.key}
                type="button"
                onClick={() => {
                  openViewer(e);
                  setExpanded(false);
                }}
                className="rounded-xl p-2.5 flex flex-col items-center gap-2 cursor-pointer text-left border"
                style={{ borderColor: "var(--border-card)", background: "var(--bg-card)" }}
              >
                <span className="relative w-full aspect-square rounded-lg overflow-hidden flex items-center justify-center" style={{ background: "var(--bg-card-alt)", color: "var(--nav-active-text)" }}>
                  {e.previewUrl ? (
                    <img src={e.previewUrl} alt="" className="w-full h-full object-cover" draggable={false} />
                  ) : e.kind === "excel" ? (
                    <FileSpreadsheet size={34} />
                  ) : (
                    <FileText size={34} />
                  )}
                </span>
                <span
                  className="w-full text-[11.5px] font-semibold break-words line-clamp-2"
                  style={{ color: "var(--text-primary)" }}
                  title={e.name}
                >
                  {e.name}
                </span>
                {e.pending && (
                  <span className="text-[10px] font-bold" style={{ color: "var(--color-warning)" }}>
                    ยังไม่บันทึก
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </FullScreenModal>

      <AttachmentViewer
        open={viewing !== null}
        source={viewing?.source ?? null}
        kind={viewing?.kind ?? "other"}
        onClose={() => setViewing(null)}
      />
    </div>
  );
}

function Tile({
  title,
  previewUrl,
  kind,
  pending,
  reading,
  onClick,
}: {
  title: string;
  previewUrl: string | null;
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
      {previewUrl ? (
        <img src={previewUrl} alt="" className="w-full h-full object-cover" draggable={false} />
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
