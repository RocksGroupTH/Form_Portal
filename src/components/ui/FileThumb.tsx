"use client";

import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { attachmentKind } from "@/components/ui/AttachmentViewer";

/**
 * One attachment as a square tile: the picture itself where it is one, a typed
 * icon where it is not, the file name underneath and a download corner.
 *
 * **Presentational and form-agnostic on purpose.** AP-17 and AP-3 each grew
 * their own copy of this (`FileThumb` in `TravelBookingDetail.tsx`, `FileThumbs`
 * in `ClearAdvanceDetail.tsx`), tied to their own file types and their own
 * route prefixes. This one takes strings, so AP-4 could use it without a third
 * copy appearing. The two existing copies are deliberately left alone — they
 * belong to other forms' work — but they are the reason this lives here rather
 * than beside AP-4.
 *
 * `attachmentKind(fileName, contentType)` decides the tile, name first and
 * declared type second: SharePoint answers `application/octet-stream` often
 * enough that trusting the header alone mislabels an ordinary `.pdf`.
 *
 * **Clicking opens the viewer, it does not navigate.** `onView` is expected to
 * open `AttachmentViewer`, which fetches the bytes and renders them from a Blob
 * inside our own origin. A plain link to the download route would serve
 * `Content-Disposition: attachment` with `nosniff` — the tab downloads and
 * closes, and "view" does not view. AP-17 learned that one the hard way.
 */
export function FileThumb({
  fileName,
  contentType,
  url,
  onView,
}: {
  fileName: string;
  contentType?: string | null;
  /** The download route for this file. Used by the corner link only. */
  url: string;
  onView: () => void;
}) {
  const kind = attachmentKind(fileName, contentType);

  return (
    <div className="w-[92px] shrink-0 flex flex-col gap-1">
      <div className="relative w-[92px] h-[92px]">
        <button
          type="button"
          onClick={onView}
          title={fileName}
          aria-label={`ดู ${fileName}`}
          className="w-full h-full rounded-xl overflow-hidden cursor-zoom-in border p-0 flex flex-col items-center justify-center gap-1"
          style={{ borderColor: "var(--border-card)", background: "var(--bg-card-alt)" }}
        >
          {kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={fileName} className="w-full h-full object-cover" />
          ) : kind === "excel" ? (
            <FileSpreadsheet size={22} style={{ color: "var(--text-muted)" }} />
          ) : (
            <FileText size={22} style={{ color: "var(--text-muted)" }} />
          )}
        </button>

        {/* Its own element, not nested in the button above: a button inside a
            button is invalid HTML and the inner one stops being reachable by
            keyboard. `stopPropagation` is not needed for that reason — they are
            siblings — but the anchor still sits over the tile, so the tile's
            own click must not also fire. */}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          aria-label={`ดาวน์โหลด ${fileName}`}
          title="ดาวน์โหลด"
          className="absolute top-1 right-1 w-6 h-6 rounded-lg flex items-center justify-center no-underline"
          style={{ background: "var(--bg-card)", color: "var(--text-muted)", boxShadow: "var(--shadow-card)" }}
        >
          <Download size={12} />
        </a>
      </div>

      {/* Under the tile rather than over it: laid across a photo the name is
          unreadable on a light receipt and hides part of what it names. */}
      <span
        className="text-[10.5px] leading-tight text-center truncate"
        style={{ color: "var(--text-muted)" }}
        title={fileName}
      >
        {fileName}
      </span>
    </div>
  );
}
