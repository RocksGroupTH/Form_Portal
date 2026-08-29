"use client";

import React, { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Paperclip, X, Loader2, FileText, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui";
import {
  AttachmentViewer,
  attachmentKind,
  type AttachmentKind,
  type AttachmentSource,
} from "@/components/ui/AttachmentViewer";
import {
  readReceiptAmount,
  RECEIPT_FAILURE_TEXT,
  type ReceiptFailure,
} from "@/features/accounting/lib/read-receipt-amount";
import { isBaht, THB } from "@/lib/acc/currency";
import { fmtAmountWithCurrency } from "@/lib/acc/currency-display";
import {
  lineMoney,
  resolveLineCurrency,
  typedLineFigure,
  type LineCurrencyContext,
} from "@/features/accounting/lib/claim-currency";
import type { TravelExpenseItem, PendingFile } from "@/features/accounting/types";
import type { TravelItemType } from "@/features/accounting/constants";

/**
 * A receipt tile's contents: the picture where there is one, an icon where
 * there is not.
 *
 * `previewUrl` is null for anything that is not an image — a stored PDF's URL
 * and a workbook's blob URL both render as a broken image, which is what the
 * tiles showed for the first minute after this slot was widened to take any
 * file. The icon is the same pair AP-4's document strip uses, so the two forms'
 * attachments read alike.
 */
function Thumb({
  previewUrl,
  kind,
  alt,
}: {
  previewUrl: string | null;
  kind: AttachmentKind;
  alt: string;
}) {
  if (previewUrl) {
    return <img src={previewUrl} alt={alt} className="w-full h-full object-cover" draggable={false} />;
  }
  return kind === "excel" ? <FileSpreadsheet size={22} /> : <FileText size={22} />;
}

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
  /**
   * Marks this block so `focusFirstMissing` can scroll to it by name. Matches
   * the readiness key without its `day-N-` prefix (`fare`, `fare-0`, …). The
   * same `[data-field]` mechanism AP-17's form uses.
   */
  dataField?: string;
  /**
   * What each line's money controls may offer, computed once for the whole
   * request by `useTravelExpenseForm`.
   *
   * **Absent, or `options` empty, is the Thailand case and must render exactly
   * what this block rendered before migration 129**: one amount input with a
   * `฿` adornment, no dropdown, no converted figure, no note. Every conditional
   * below is behind that one test, so the promise is checkable rather than
   * hoped for.
   */
  lineCurrency?: LineCurrencyContext;
  /**
   * The claim's brand, forwarded to the receipt read.
   *
   * **Not display, and not optional in practice.** The route resolves what this
   * brand may claim in server-side and only then asks the model which currency
   * the document is in; with no brand code it admits baht alone and every
   * foreign receipt silently stays baht. Nothing else here uses it.
   */
  brandCode?: string | null;
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
  dataField,
  lineCurrency,
  brandCode,
}: ExpenseRowsProps) {
  const rowItems = items.filter((it) => it.itemType === type);
  const allItems = items;
  // The single Thailand test. `[]` when no context was passed at all, which is
  // what every call site outside AP-1's foreign path produces.
  const currencyOptions = lineCurrency?.options ?? [];
  const previewRate = lineCurrency?.rate ?? null;

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

  /**
   * The typed figure, re-expressed as the four fields a line carries.
   *
   * On a Thai claim `lineMoney` takes its identity branch and this is the
   * `{ amount }` patch it always was, plus three nulls that were already null.
   * On a foreign line it also fills `foreignAmount` and previews the baht, so
   * the day and claim totals — which sum `amount` — stay live while somebody
   * types. The server recomputes all four on save from its own rate.
   */
  const handleAmountChange = (filteredIdx: number, raw: string) => {
    const gi = globalIndex(filteredIdx);
    if (gi < 0) return;
    const item = allItems[gi];
    const cur = resolveLineCurrency(item.currency, currencyOptions);
    onUpdate(gi, lineMoney(parseFloat(raw) || 0, cur, previewRate));
  };

  /** Same rule, keeping the figure as typed and changing only what it is in. */
  const handleCurrencyChange = (filteredIdx: number, code: string) => {
    const gi = globalIndex(filteredIdx);
    if (gi < 0) return;
    const item = allItems[gi];
    const typed = typedLineFigure(item, currencyOptions);
    onUpdate(gi, lineMoney(typed, resolveLineCurrency(code, currencyOptions), previewRate));
  };

  const handleRemove = (filteredIdx: number) => {
    const gi = globalIndex(filteredIdx);
    if (gi >= 0) onRemove(gi);
  };

  return (
    <div className="w-full" data-field={dataField}>
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
          background: "var(--bg-card-alt)",
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
            currencyOptions={currencyOptions}
            brandCode={brandCode}
            highlightMissingReceipt={highlightMissingReceipt}
            onAmountChange={(val) => handleAmountChange(filteredIdx, val)}
            onCurrencyChange={(code) => handleCurrencyChange(filteredIdx, code)}
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
              if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
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
          {/* Baht, unconditionally — `amount` is baht on every line, whatever
              currency it was typed in, which is the whole point of converting on
              the way in (migration 129). The block total on a Thai claim is
              therefore the same figure and the same word it has always been. */}
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
  /**
   * What this line's currency dropdown may offer. **Empty means Thailand** — no
   * dropdown, no converted figure, and the `฿` adornment this row has always
   * had.
   */
  currencyOptions: string[];
  /** Forwarded to the read so the route can resolve what this brand may claim in. */
  brandCode?: string | null;
  highlightMissingReceipt?: boolean;
  onAmountChange: (val: string) => void;
  onCurrencyChange: (code: string) => void;
  onRemove: () => void;
  onPendingAdd: (file: PendingFile) => void;
  onPendingRemove: (localId: string) => void;
  onUploadedRemove: (fileId: number) => void;
}

function ExpenseRow({
  item,
  requestId,
  currencyOptions,
  brandCode,
  highlightMissingReceipt = false,
  onAmountChange,
  onCurrencyChange,
  onRemove,
  onPendingAdd,
  onPendingRemove,
  onUploadedRemove,
}: ExpenseRowProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [viewing, setViewing] = useState<{ source: AttachmentSource; kind: AttachmentKind } | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);
  // Pending confirmation for destructive actions on already-saved data.
  const [confirm, setConfirm] = useState<{ kind: "file"; fileId: number } | { kind: "row" } | null>(null);
  const [confirming, setConfirming] = useState(false);
  /**
   * How the receipt read is going, for the note under the row. It never gates
   * the input: the amount field is editable from the moment a file is attached,
   * whatever the read is doing. An earlier cut swapped the input out for a
   * spinner, which locked the requester out of their own field for as long as
   * the call took — up to the route's 30s timeout.
   */
  const [readNote, setReadNote] = useState<"reading" | ReceiptFailure | null>(null);

  /* ── What this line is in ──
   *
   * `showsCurrency` is the single Thailand test, and everything the currency
   * work added to this row sits behind it. `lineCurrency` resolves a line with
   * no recorded currency to the country's own — see `effectiveLineCurrency` for
   * why that, and not baht. */
  const showsCurrency = currencyOptions.length > 0;
  const lineCurrency = resolveLineCurrency(item.currency, currencyOptions);
  const isForeignLine = showsCurrency && !isBaht(lineCurrency);
  /** The figure the input shows and the requester typed — never the baht. */
  const typedAmount = typedLineFigure(item, currencyOptions);
  /**
   * The baht this line contributes, or null to show `—`.
   *
   * Read off `item.amount` rather than recomputed, because after a save that is
   * the figure the **server** wrote at the rate it fetched — the authority. The
   * one case with nothing honest to show is a figure typed while no rate was
   * available at all: `lineMoney` leaves `amount` at 0 there rather than
   * previewing the unconverted number, and a `0.00 บาท` beside a `20` would
   * read as a converted figure rather than as a missing one.
   */
  const convertedBaht = !isForeignLine
    ? null
    : typedAmount > 0 && !(Number(item.amount) > 0)
      ? null
      : Number(item.amount) || 0;

  const uploaded = item.files ?? [];
  const pending = item.pendingFiles ?? [];
  const totalFiles = uploaded.length + pending.length;
  const needsReceipt = highlightMissingReceipt && typedAmount > 0 && totalFiles === 0;
  // A row is "saved" once it has a DB id (persisted by a previous save/submit).
  const isSaved = item.id != null;
  /**
   * The amount is asked for only once there is a receipt behind it — attaching
   * is what unlocks the field, and the server has always refused an amount
   * without one (`validateForSubmit`).
   *
   * The `amount > 0` arm is for rows saved before this: a draft written when
   * the field came first still holds its figure, and hiding it would take money
   * off a form its owner had already filled in.
   */
  const showAmount = totalFiles > 0 || typedAmount > 0 || readNote === "reading";

  // The read resolves seconds after the attach. These keep its write honest
  // against a row that has since been filled in by hand, or removed altogether.
  const amountRef = useRef(typedAmount);
  amountRef.current = typedAmount;
  const aliveRef = useRef(true);
  useEffect(() => {
    // Set on mount, not just cleared on unmount. StrictMode runs effects
    // mount → cleanup → mount in development, so a cleanup-only version leaves
    // this false for the rest of the component's life: every read then returned
    // early, the note stayed on "กำลังอ่านยอด" forever and no amount was ever
    // filled in. `reactStrictMode` is unset in next.config.mjs, which means on.
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);
  // The read is billed per call, so one at a time per row. `reading` is state
  // and lags a render behind; a ref is what a second file picked in the same
  // tick actually sees.
  const readingRef = useRef(false);

  /** Read the receipt's total and offer it — never over a figure already there. */
  const prefillAmountFrom = async (file: File) => {
    readingRef.current = true;
    setReadNote("reading");
    try {
      // `brandCode` is what lets the route ask which currency the document is
      // in at all; `claimCurrency` is what decides whether the answer belongs
      // in this field. An absent `currency` prop means baht on this form — the
      // reader's null means "not known", which is AP-17's case and not ours.
      const read = await readReceiptAmount(file, {
        brandCode,
        claimCurrency: lineCurrency,
      });
      if (!aliveRef.current) return;
      if (read.amount != null) {
        // Skipped when a figure arrived while this was in flight — typed by
        // hand, which outranks the read. Not a failure; say nothing.
        if (!(Number(amountRef.current) > 0)) onAmountChange(String(read.amount));
        setReadNote(null);
        return;
      }
      // The reason is carried through so the note can name the right remedy:
      // a blank receipt, a key an operator must replace, and an outage are
      // three different things to be told.
      setReadNote(read.failure ?? "error");
    } catch {
      if (aliveRef.current) setReadNote("error");
    } finally {
      readingRef.current = false;
    }
  };

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

    // No type check here. This slot takes any file since 2026-08-26, and the
    // server's `checkAttachment` is what decides — it reads the bytes, which
    // `file.type` only claims. A browser-side copy of that rule is how the
    // widening was missed: the route already accepted the PDF, and this refused
    // it before it was ever posted.
    // Hold in memory; the form uploads it on save / submit (no need to save a draft first).
    onPendingAdd({
      localId: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      file,
      // Only for images. A blob URL for a PDF or a workbook renders as a broken
      // image in the tile; the thumbnail falls back to an icon when this is
      // blank, and `AttachmentViewer` reads the `File` itself rather than this.
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
    });
    if (fileInputRef.current) fileInputRef.current.value = "";

    // Fill the amount from the receipt, in the background — the field is
    // revealed either way, so a slow or failed read costs nothing.
    //
    // Skipped when a figure is already there or a read is in flight: each call
    // is billed, and a second one could only overwrite the first's answer or
    // race it. Attaching more images to a row that already has its amount is
    // free.
    // Every file, whatever it is. `/receipt-amount` rasterises a PDF and
    // flattens a workbook server-side, so the read is worth attempting on all
    // of them; a kind it genuinely cannot use comes back as a null amount and
    // the field simply opens blank.
    if (!readingRef.current && !(Number(amountRef.current) > 0)) void prefillAmountFrom(file);
  };

  /**
   * The money input, as a fragment.
   *
   * A variable rather than two copies of the markup: on a Thai claim it is
   * dropped straight into the same fixed-width `relative` box it has always sat
   * in — so the adornment and the reading overlay still position against that
   * box and the rendered DOM is unchanged — and on a foreign claim it goes into
   * a `relative` cell beside the dropdown instead. Two copies would drift, and
   * this is the control the receipt read writes into.
   */
  const amountField = (
    <>
      {/* Locked while the read is in flight, and released the moment it lands
          either way — a figure, or a failure that says to type it in. Typing
          over an answer that is one second away only creates a race about whose
          number wins. */}
      <input
        type="number"
        min="0"
        step="any"
        placeholder={showsCurrency ? "จำนวนเงินต้นทาง" : "จำนวนเงิน"}
        value={typedAmount || ""}
        onChange={(e) => onAmountChange(e.target.value)}
        disabled={readNote === "reading"}
        // With a dropdown beside it the code is already on screen, so the field
        // carries no adornment and keeps its ordinary right padding. Baht keeps
        // the `฿` and the padding it has always had, so nothing moves on an
        // ordinary Thai claim.
        className={`w-full rounded-lg pl-3 py-2 text-[15px] font-bold outline-none tabular-nums text-right ${
          showsCurrency ? "pr-3" : "pr-7"
        }`}
        style={inputStyle}
      />
      {!showsCurrency && (
        <span
          className="absolute right-3 top-1/2 -translate-y-1/2 text-[14px] font-bold pointer-events-none"
          style={{ color: "var(--text-muted)" }}
        >
          ฿
        </span>
      )}
      {/* Covers the whole field rather than a hairline at its edge, so the state
          is unmistakable at a glance. Laid over a disabled input of the same
          size instead of replacing it, so nothing below shifts when the read
          finishes. `acc-progress` is a 40% band that sweeps across — the same
          animation the loading popup uses. */}
      {readNote === "reading" && (
        <div
          className="absolute inset-0 rounded-lg overflow-hidden pointer-events-none"
          style={{ background: "color-mix(in srgb, var(--color-action) 10%, var(--bg-input))" }}
        >
          <div
            className="acc-progress h-full"
            style={{ background: "color-mix(in srgb, var(--color-action) 26%, transparent)" }}
          />
          <span
            className="absolute inset-0 flex items-center justify-center gap-1.5 text-[11.5px] font-semibold"
            style={{ color: "var(--color-action)" }}
          >
            <Loader2 size={12} className="animate-spin" />
            กำลังอ่านยอด...
          </span>
        </div>
      )}
    </>
  );

  return (
    <div
      className="flex flex-col gap-1.5 px-3 py-2.5 rounded-xl"
      style={{
        background: "var(--bg-card)",
        border: needsReceipt ? "1px solid var(--color-danger)" : "1px solid var(--border-card)",
        boxShadow: needsReceipt ? "0 0 0 1px var(--color-danger)" : undefined,
      }}
    >
      {/*
        One line, read left to right in the order the work happens: attach the
        receipt, then the amount appears beside it, then remove the row. It used
        to be two lines with the attach control at the bottom left and the
        amount at the top right — diagonally opposite, so the eye had to travel
        between a control and the thing it unlocks, across a large dead centre.
      */}
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          // No `accept`: this slot takes any file since 2026-08-26. A claim's
          // evidence is not always a photo, and `accept="image/*"` made the OS
          // picker hide the PDF invoice somebody was trying to attach — so they
          // attached a screenshot of it instead. The server's own guard still
          // applies the size limits; it is `attachmentResponseHeaders` that
          // keeps serving safe.
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Receipts — uploaded + pending; click to open zoomable lightbox.
            Takes the free width (`flex-1 min-w-0`) and scrolls inside itself
            rather than wrapping, so the row's height never changes as pictures
            are added and nothing below it moves. `shrink-0` on each tile is
            what stops flexbox squashing them instead of scrolling; the
            asymmetric padding is headroom for the delete badge, which sits
            outside each tile and would otherwise be clipped.

            Rendered unconditionally: the attach tile at the end is the only way
            to add a picture, so an empty row shows the strip holding just that
            tile — one control, one shape, whether the row has no image or nine. */}
        <div className="flex-1 min-w-0 flex flex-nowrap items-center gap-2 overflow-x-auto pt-1.5 -mt-1.5 pb-1 pr-1.5">
          {uploaded.map((f) => (
            <div key={`u-${f.id}`} className="relative w-14 h-14 shrink-0">
              <button
                type="button"
                onClick={() =>
                  setViewing({
                    source: { name: f.fileName, url: f.url },
                    kind: attachmentKind(f.fileName, f.contentType),
                  })
                }
                className="w-full h-full rounded-xl overflow-hidden cursor-pointer p-0 border flex items-center justify-center"
                style={{ borderColor: "var(--border-card)", background: "var(--bg-card)", color: "var(--nav-active-text)" }}
                title={`${f.fileName} — คลิกเพื่อเปิดดู`}
              >
                <Thumb
                  previewUrl={attachmentKind(f.fileName, f.contentType) === "image" ? f.url : null}
                  kind={attachmentKind(f.fileName, f.contentType)}
                  alt={f.fileName}
                />
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
                  style={{ background: "var(--btn-danger-bg)", color: "var(--btn-danger-text)", border: "1px solid var(--btn-danger-border)", opacity: removingId === f.id ? 0.6 : 1 }}
                >
                  {removingId === f.id ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
                </button>
              )}
            </div>
          ))}
          {pending.map((p) => (
            <div key={`p-${p.localId}`} className="relative w-14 h-14 shrink-0">
              {/* `relative` is load-bearing: it makes this button the badge's
                  containing block, which is what lets `overflow-hidden` clip
                  the badge to the tile's corner. The badge used to sit outside
                  the button, so nothing clipped it and its square bottom
                  corners overhung the rounded tile. Giving the badge its own
                  `rounded-b-xl` is not the fix — a 12px radius on a 14px-tall
                  strip curves into a capsule; the corner has to come from the
                  tile. */}
              <button
                type="button"
                onClick={() =>
                  setViewing({
                    source: { name: p.file.name, file: p.file },
                    kind: attachmentKind(p.file.name, p.file.type),
                  })
                }
                className="relative w-full h-full rounded-xl overflow-hidden cursor-pointer p-0 border flex items-center justify-center"
                style={{ borderColor: "var(--color-warning)", background: "var(--bg-card)", color: "var(--nav-active-text)" }}
                title={`${p.file.name} — ยังไม่บันทึก · คลิกเพื่อเปิดดู`}
              >
                <Thumb
                  previewUrl={p.previewUrl || null}
                  kind={attachmentKind(p.file.name, p.file.type)}
                  alt={p.file.name}
                />
                {/* Pending badge */}
                <span
                  className="absolute bottom-0 left-0 right-0 text-[8px] font-bold text-center leading-tight py-0.5"
                  style={{ background: "color-mix(in srgb, var(--color-warning) 85%, transparent)", color: "#fff" }}
                >
                  ยังไม่บันทึก
                </span>
              </button>
              {/* Remove pending */}
              <button
                type="button"
                onClick={() => onPendingRemove(p.localId)}
                aria-label="เอารูปออก"
                title="เอารูปออก"
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center cursor-pointer border-none"
                style={{ background: "var(--btn-danger-bg)", color: "var(--btn-danger-text)", border: "1px solid var(--btn-danger-border)" }}
              >
                <X size={11} />
              </button>
            </div>
          ))}

          {/* Add — last in the strip, so it steps right as pictures are added.
              Same 64px box as a thumbnail so the row reads as one line of
              tiles rather than a row with a control stuck on the end. */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label={totalFiles > 0 ? "แนบรูปเพิ่ม" : "แนบรูปใบเสร็จ"}
            title={
              totalFiles > 0
                ? "แนบรูปใบเสร็จเพิ่ม (รูปภาพเท่านั้น)"
                : "แนบรูปใบเสร็จ (รูปภาพเท่านั้น)"
            }
            className="relative w-14 h-14 shrink-0 rounded-xl flex items-center justify-center cursor-pointer acc-add-row"
            style={{
              // A tint against the row's white, so the control reads as a
              // control at a glance and the dashed border only has to say
              // "add" rather than carry the whole job of being visible.
              // Matches "เพิ่มรายการ" above — the two are the same kind of
              // thing and should not look like two different ideas.
              border: "1px dashed var(--border-card)",
              background: "var(--bg-card-alt)",
              color: "var(--text-secondary)",
            }}
          >
            <Paperclip size={18} />
          </button>
        </div>

        {/* Amount — revealed by the attach, prefilled from the receipt.
            Deliberately not gated on the read: once there is a receipt the
            requester can type the figure, and the read either beats them to it
            or does not.

            On a Thai claim (`showsCurrency` false) this is one input in a fixed
            box, exactly as it has always been: the `฿` adornment, the same
            widths, the same padding, no dropdown and no second line. Everything
            else is inside a `showsCurrency` branch. */}
        <div className={`relative shrink-0 ${showsCurrency ? "w-48 sm:w-60" : "w-32 sm:w-44"}`}>
          {showAmount ? (
            showsCurrency ? (
              <div className="flex flex-col items-stretch gap-1">
                <div className="flex items-center gap-1.5">
                  <div className="relative flex-1 min-w-0">{amountField}</div>
                  {/* Locked alongside the input while the read is running: the
                      read was asked whether the document is in *this* currency,
                      so changing it mid-flight would have the answer admitted
                      against a question nobody asked. */}
                  <select
                    aria-label="สกุลเงินของรายการนี้"
                    value={lineCurrency}
                    onChange={(e) => onCurrencyChange(e.target.value)}
                    disabled={readNote === "reading"}
                    className="shrink-0 rounded-lg px-1.5 py-2 text-[13px] font-bold outline-none cursor-pointer"
                    style={inputStyle}
                  >
                    {currencyOptions.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </div>
                {/* The baht this line is worth. A THB line shows nothing — it is
                    already baht, and `= 20.00 บาท` beside a `20` would be noise.
                    `—` while no rate is known: the figure is never guessed, and
                    the save refuses on its own if its own fetch also fails. */}
                {isForeignLine && (
                  <span
                    className="text-[12px] font-semibold text-right tabular-nums"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {convertedBaht === null ? "= —" : `= ${fmtAmountWithCurrency(convertedBaht, THB)}`}
                  </span>
                )}
              </div>
            ) : (
              amountField
            )
          ) : (
            /* Sits where the input will be, so the empty slot explains itself
               rather than looking like something failed to render. */
            <p
              className="m-0 py-2 text-[12.5px] text-right leading-tight"
              style={{ color: "var(--text-muted)" }}
            >
              แนบใบเสร็จก่อน
            </p>
          )}
        </div>

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

      {needsReceipt && (
        <p className="text-[12px] font-medium" style={{ color: "var(--color-danger)" }}>
          ต้องแนบรูปใบเสร็จสำหรับรายการที่กรอกจำนวนเงิน
        </p>
      )}

      {/* How the read is going. A note beside a working field — never in place
          of one. Both lines say the same thing in the end: type it yourself. */}
      {/* No note while reading: the field says so itself now, and the line that
          used to sit here told people to type in a box that is locked. */}
      {/* Self-clearing: once there is a figure the note is stale, however it
          got there. Re-attaching the image is the retry. */}
      {readNote != null && readNote !== "reading" && !(typedAmount > 0) && (
        <p className="m-0 text-[12px]" style={{ color: "var(--text-muted)" }}>
          {RECEIPT_FAILURE_TEXT[readNote]}
        </p>
      )}

      <AttachmentViewer
        open={viewing != null}
        source={viewing?.source ?? null}
        kind={viewing?.kind ?? "other"}
        onClose={() => setViewing(null)}
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
            style={{ background: "var(--btn-danger-bg)", color: "var(--btn-danger-text)", border: "1px solid var(--btn-danger-border)", opacity: confirming ? 0.7 : 1 }}
          >
            {confirming && <Loader2 size={13} className="animate-spin" />}
            {confirm?.kind === "row" ? "ยืนยัน ลบรายการ" : "ยืนยัน ลบรูป"}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
