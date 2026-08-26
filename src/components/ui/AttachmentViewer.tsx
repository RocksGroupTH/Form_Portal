"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Loader2, X } from "lucide-react";
import { ImageLightbox } from "@/features/accounting/components/ImageLightbox";
import { loadXlsx } from "@/lib/xlsx";

/**
 * Open any AP-4 attachment without leaving the page — an image, a PDF, or the
 * AP-4.1 Excel workbook, whether it has been uploaded yet or not.
 *
 * **Nothing here relaxes the server's download headers, and nothing should.**
 * `attachmentResponseHeaders` deliberately serves everything non-raster as
 * `Content-Disposition: attachment` with `nosniff` and a sandbox CSP, which is
 * why a stored PDF downloads instead of rendering. The fix for "I want to look
 * at it" is to fetch the bytes and render them here, inside our own origin's
 * page, rather than to ask the server to hand a browser something it will
 * execute. A reviewer who "simplifies" this into an `<iframe src={url}>`
 * pointed at the download route has undone the guard, not the workaround.
 *
 * Three kinds, three treatments:
 *
 * - **image** — handed to `ImageLightbox`, the viewer AP-1 and AP-17 already
 *   use, so zoom and pan behave identically across the three forms.
 * - **pdf** — a blob URL in an `<object>`, letting the browser's own PDF viewer
 *   do the work. **No `sandbox`** — see the comment at that element; the
 *   attribute made the pane blank and could not have been kept meaningfully.
 * - **excel** — parsed with `xlsx-js-style` (already a dependency; plain `xlsx`
 *   is the one with the advisories) and rendered as a plain table. A workbook
 *   is data to check, not a document to lay out, so the first sheet as text is
 *   the whole job.
 */

export type AttachmentKind = "image" | "pdf" | "excel" | "other";

export interface AttachmentSource {
  /** Shown as the modal's title. */
  name: string;
  /** A not-yet-uploaded pick. Takes precedence over `url`. */
  file?: File;
  /** A stored file's download URL. */
  url?: string;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|heic|heif|bmp)$/i;
const PDF_EXT = /\.pdf$/i;
const EXCEL_EXT = /\.(xlsx|xlsm|xls)$/i;

/**
 * What to do with a file, from its declared type and then its name.
 *
 * The name is consulted second, not first, but it is consulted: SharePoint
 * hands back `application/octet-stream` often enough that type alone would send
 * a perfectly ordinary `.xlsx` down the "cannot preview" path.
 */
export function attachmentKind(fileName: string, contentType?: string | null): AttachmentKind {
  const t = (contentType ?? "").toLowerCase();
  if (t.startsWith("image/")) return "image";
  if (t === "application/pdf") return "pdf";
  if (t.includes("spreadsheet") || t.includes("excel")) return "excel";
  if (IMAGE_EXT.test(fileName)) return "image";
  if (PDF_EXT.test(fileName)) return "pdf";
  if (EXCEL_EXT.test(fileName)) return "excel";
  return "other";
}

interface AttachmentViewerProps {
  open: boolean;
  source: AttachmentSource | null;
  kind: AttachmentKind;
  onClose: () => void;
}

export function AttachmentViewer({ open, source, kind, onClose }: AttachmentViewerProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [sheetHtml, setSheetHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !source) return;

    // A local `let`, fresh on every run of the effect, rather than a ref set on
    // mount. React strict mode runs effects twice in development, and a ref
    // cleared by the first cleanup stays cleared for the component's life.
    let cancelled = false;
    let created: string | null = null;

    setBlobUrl(null);
    setSheetHtml(null);
    setError(null);
    setLoading(true);

    (async () => {
      try {
        const bytes = source.file
          ? await source.file.arrayBuffer()
          : await (async () => {
              if (!source.url) throw new Error("no source");
              const res = await fetch(source.url);
              if (!res.ok) throw new Error(String(res.status));
              return res.arrayBuffer();
            })();
        if (cancelled) return;

        if (kind === "excel") {
          // Imported here rather than at module scope: the parser is ~1 MB of
          // JavaScript, and most people filling this form never open a
          // workbook. `sheet_to_html` escapes cell text itself.
          const XLSX = await loadXlsx();
          const wb = XLSX.read(bytes, { type: "array" });
          const first = wb.SheetNames[0];
          if (cancelled) return;
          if (!first) {
            setError("ไฟล์นี้ไม่มีชีตข้อมูล");
          } else {
            setSheetHtml(XLSX.utils.sheet_to_html(wb.Sheets[first]));
          }
        } else {
          const type = kind === "pdf" ? "application/pdf" : (source.file?.type || "application/octet-stream");
          created = URL.createObjectURL(new Blob([bytes], { type }));
          if (cancelled) {
            URL.revokeObjectURL(created);
            created = null;
            return;
          }
          setBlobUrl(created);
        }
      } catch {
        if (!cancelled) setError("เปิดไฟล์นี้ไม่ได้ — ลองดาวน์โหลดแทน");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      // Revoked on close as well as on replacement: a blob URL holds the whole
      // file in memory until it is, and these are receipts photographed on a
      // phone.
      if (created) URL.revokeObjectURL(created);
    };
  }, [open, source, kind]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !source) return null;

  // Images keep the viewer the other two forms use, so zoom and pan are the
  // same gesture everywhere in the app.
  if (kind === "image") {
    return blobUrl ? (
      <ImageLightbox open src={blobUrl} alt={source.name} onClose={onClose} />
    ) : (
      <Shell name={source.name} onClose={onClose}>
        <Centre>{error ?? <Loader2 size={22} className="animate-spin" />}</Centre>
      </Shell>
    );
  }

  return (
    <Shell name={source.name} onClose={onClose} openUrl={blobUrl}>
      {loading && (
        <Centre>
          <Loader2 size={22} className="animate-spin" />
        </Centre>
      )}
      {!loading && error && <Centre>{error}</Centre>}
      {!loading && !error && kind === "pdf" && blobUrl && (
        // `<object>`, and **no `sandbox`**. It was `<iframe sandbox="allow-same-origin">`
        // and rendered a blank white pane: a browser's built-in PDF viewer is
        // itself a scripted component, so a sandbox without `allow-scripts`
        // stops it loading at all. Adding `allow-scripts` beside
        // `allow-same-origin` is the documented way to have no sandbox while
        // looking like you do, so the attribute is gone rather than weakened.
        //
        // What actually protects us is unchanged and is not this attribute:
        // the bytes were fetched by us and wrapped in a Blob **we** typed
        // `application/pdf`, so the frame cannot be talked into rendering HTML;
        // and the server still serves the stored file as
        // `Content-Disposition: attachment` under `nosniff`, which is the guard
        // this component exists to work with rather than around.
        <object
          data={blobUrl}
          type="application/pdf"
          aria-label={source.name}
          style={{ width: "100%", height: "100%", background: "var(--bg-card-alt)" }}
        >
          {/* Shown by the browser only when it will not embed a PDF at all —
              iOS Safari, and any policy that blocks plugins. Without it that
              case is the same blank pane this replaced. */}
          <Centre>
            <span className="flex flex-col items-center gap-2">
              เบราว์เซอร์นี้แสดง PDF ในหน้านี้ไม่ได้
              <OpenInTab url={blobUrl} />
            </span>
          </Centre>
        </object>
      )}
      {!loading && !error && kind === "excel" && sheetHtml && (
        <div
          className="acc-sheet-preview overflow-auto w-full h-full p-4 text-[13px]"
          style={{ background: "var(--bg-card)", color: "var(--text-primary)" }}
          // `sheet_to_html` escapes the cell text it emits, and the bytes were
          // fetched from our own attachment route.
          dangerouslySetInnerHTML={{ __html: sheetHtml }}
        />
      )}
      {!loading && !error && kind === "other" && (
        <Centre>ไฟล์ชนิดนี้เปิดดูในหน้านี้ไม่ได้ — กรุณาดาวน์โหลด</Centre>
      )}
    </Shell>
  );
}

function Centre({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="w-full h-full flex items-center justify-center text-[13px]"
      style={{ color: "var(--text-muted)" }}
    >
      {children}
    </div>
  );
}

/**
 * "Open in a new tab", pointed at the blob this component already made.
 *
 * Deliberately the blob and not the file's download URL: the blob is what the
 * viewer is showing, it exists for a file that has not been uploaded yet, and
 * the stored URL would come back `Content-Disposition: attachment` and
 * download rather than open — which is the behaviour this whole component
 * exists to give people an alternative to.
 */
function OpenInTab({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold no-underline"
      style={{ background: "var(--bg-card-alt)", color: "var(--nav-active-text)" }}
    >
      <ExternalLink size={13} /> เปิดในแท็บใหม่
    </a>
  );
}

function Shell({
  name,
  onClose,
  openUrl,
  children,
}: {
  name: string;
  onClose: () => void;
  /** Present once the bytes have been fetched; absent while loading or on error. */
  openUrl?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.85)", animation: "overlayFadeIn 0.15s ease-out" }}
      onClick={onClose}
    >
      <div
        className="rounded-xl overflow-hidden flex flex-col"
        style={{
          width: "min(1000px, 94vw)",
          height: "min(760px, 88vh)",
          background: "var(--bg-card)",
          border: "1px solid var(--border-card)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center gap-3 px-4 py-2.5 shrink-0"
          style={{ borderBottom: "1px solid var(--border-light)" }}
        >
          <span
            className="text-[13px] font-semibold truncate flex-1"
            style={{ color: "var(--text-heading)" }}
            title={name}
          >
            {name}
          </span>
          {openUrl && <OpenInTab url={openUrl} />}
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิด"
            className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border-none shrink-0"
            style={{ background: "var(--bg-card-alt)", color: "var(--text-muted)" }}
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 min-h-0">{children}</div>
      </div>
    </div>
  );
}
