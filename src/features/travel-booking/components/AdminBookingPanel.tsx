"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  BedDouble,
  Car,
  CheckCircle2,
  FileText,
  Loader2,
  Paperclip,
  Plus,
  RotateCcw,
  Save,
  ThumbsDown,
  Ticket,
  Trash2,
  X,
} from "lucide-react";
import { Dialog } from "@/components/ui";
import { ImageLightbox } from "@/features/accounting/components/ImageLightbox";
import { useTravelBookingOptionIcons } from "@/features/travel-booking/hooks/useOptionIcons";
import { InfoStrip, tripInfo, typeInfo, type InfoGroup } from "@/features/travel-booking/components/BookingInfoStrip";
import { BOOKING_TYPE_REFTYPE } from "@/features/travel-booking/constants";
import { REQUIRED_BOOKING_RULES } from "@/features/travel-booking/lib/booking-requirements";
import {
  sanitizeBookingAmount,
  suggestedTotal,
  totalMismatch,
  MAX_BOOKING_AMOUNT,
} from "@/features/travel-booking/lib/booking-amounts";
import { bookingFieldsLocked } from "@/features/travel-booking/lib/booking-lock";
import { onFileAttached, onFileRemoved } from "@/features/travel-booking/lib/booking-file-sync";
import {
  sanitizeBookingNo,
  MAX_BOOKING_NO_LENGTH,
} from "@/features/travel-booking/lib/booking-no";
import {
  readBookingFields,
  BOOKING_FIELDS_FAILURE_TEXT,
  type BookingFieldsFailure,
} from "@/features/travel-booking/lib/read-booking-fields";
import type {
  BookingDetail,
  BookingType,
  TravelBookingFileMeta,
  TravelBookingRequest,
} from "@/features/travel-booking/types";

const TYPE_ICON: Record<BookingType, ReactNode> = {
  room: <BedDouble size={15} />,
  ticket: <Ticket size={15} />,
  rent: <Car size={15} />,
};

const fieldStyle = {
  background: "var(--bg-input)",
  color: "var(--text-primary)",
  border: "1px solid var(--border-input)",
} as const;

/** A figure as the input should show it: blank for "nobody recorded this", never "0". */
function numText(v: number | null | undefined): string {
  return v != null ? String(v) : "";
}

function FieldCaption({ children }: { children: ReactNode }) {
  return (
    <label
      className="block text-[11px] font-semibold mb-1 uppercase tracking-wide"
      style={{ color: "var(--text-muted)" }}
    >
      {children}
    </label>
  );
}

/**
 * One money field. Four of the five are identical apart from their caption, and
 * writing them out four times is how one of them ends up without the `disabled`
 * that locks it while the read is running.
 */
function BahtField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <FieldCaption>{label}</FieldCaption>
      <input
        type="number"
        step="0.01"
        min="0"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-lg px-3 py-2 text-[13px] outline-none tabular-nums text-right disabled:opacity-60 disabled:cursor-not-allowed"
        style={fieldStyle}
        placeholder="0.00"
      />
    </div>
  );
}

/** One booking row counts as done when it has a number, a price and at least one attachment. */
function isRowComplete(detail: BookingDetail): boolean {
  return !!detail.bookingNo?.trim() && detail.priceExVat != null && detail.files.length > 0;
}

/** A booking type is done when it has at least one row and none of its rows is half-filled. */
function isTypeComplete(rows: BookingDetail[]): boolean {
  return rows.length > 0 && rows.every(isRowComplete);
}


/**
 * Admin fill-in panel (spec §7/§8.1) — rendered on the detail page only for account-area
 * viewers while the request is on the Admin booking step (`Status === 'ManagerApproved'` **and**
 * `CurrentStepCode === 'ADMIN'` — the status alone also covers accounting's sign-off, where
 * every control below is refused by the server). One group per REQUIRED booking (room/ticket/
 * rent, gated by `REQUIRED_BOOKING_RULES` against the request's Needs*Booking flags).
 *
 * A group holds as many rows as the trip needs (two hotels, two tickets, …) — "เพิ่ม…" adds
 * another. Each row saves BookingNo + PriceExVat and takes its own attachments; attaching
 * works straight away, without saving first, because the row is created on demand (see
 * `BookingRowCard.ensureDetailId`). The bottom "ทำรายการเสร็จ" button is disabled until every
 * required group is complete — the server (`completeRequest`) re-validates the same gate, so
 * this is a UX pre-check, not the source of truth.
 */
export function AdminBookingPanel({
  request,
  onChanged,
}: {
  request: TravelBookingRequest;
  onChanged: () => void;
}) {
  const requestId = request.id;
  const optionIcons = useTravelBookingOptionIcons();
  const requiredRules = useMemo(
    () => REQUIRED_BOOKING_RULES.filter((r) => r.needed(request)),
    [request],
  );
  const rowsByType = useMemo(() => {
    const map = new Map<BookingType, BookingDetail[]>();
    for (const d of request.bookingDetails) {
      const list = map.get(d.bookingType);
      if (list) list.push(d);
      else map.set(d.bookingType, [d]);
    }
    return map;
  }, [request.bookingDetails]);

  const [completing, setCompleting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ detailId: number; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  /* Bounce the request instead of booking it — back to the requester, or rejected outright. */
  const [bounce, setBounce] = useState<"return" | "reject" | null>(null);
  const [bounceComment, setBounceComment] = useState("");
  const [bouncing, setBouncing] = useState(false);

  const missingLabels = requiredRules
    .filter((r) => !isTypeComplete(rowsByType.get(r.type) ?? []))
    .map((r) => r.label);
  const allComplete = missingLabels.length === 0;

  async function handleComplete() {
    if (!requestId) return;
    setCompleting(true);
    try {
      const res = await fetch(`/api/request/travel-booking/admin/requests/${requestId}/complete`, {
        method: "POST",
      });
      const json: { ok: boolean; error?: string } = await res.json();
      if (!json.ok) {
        toast.error(json.error ?? "ปิดงานไม่สำเร็จ");
        return;
      }
      toast.success("ทำรายการเสร็จสิ้น");
      onChanged();
    } catch {
      toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
    } finally {
      setCompleting(false);
    }
  }

  async function handleConfirmDelete() {
    if (!requestId || !pendingDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/request/travel-booking/admin/requests/${requestId}/booking?detailId=${pendingDelete.detailId}`,
        { method: "DELETE" },
      );
      const json: { ok: boolean; error?: string } = await res.json();
      if (!json.ok) {
        toast.error(json.error ?? "ลบรายการจองไม่สำเร็จ");
        return;
      }
      toast.success("ลบรายการจองแล้ว");
      setPendingDelete(null);
      onChanged();
    } catch {
      toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
    } finally {
      setDeleting(false);
    }
  }

  async function handleBounce() {
    if (!requestId || !bounce) return;
    if (!bounceComment.trim()) {
      toast.error("กรุณาระบุเหตุผล");
      return;
    }
    setBouncing(true);
    try {
      const res = await fetch(`/api/request/travel-booking/requests/${requestId}/${bounce}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: bounceComment.trim() }),
      });
      const json: { ok: boolean; error?: string } = await res.json();
      if (!json.ok) {
        toast.error(json.error ?? "ดำเนินการไม่สำเร็จ");
        return;
      }
      toast.success(bounce === "return" ? "ส่งกลับให้ผู้ขอแก้ไขแล้ว" : "ไม่อนุมัติคำขอแล้ว");
      setBounce(null);
      setBounceComment("");
      onChanged();
    } catch {
      toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
    } finally {
      setBouncing(false);
    }
  }

  if (!requestId) return null;

  return (
    <div
      className="rounded-2xl overflow-hidden mb-4"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-sm)" }}
    >
      <div
        className="flex items-center gap-2.5 px-5 py-3"
        style={{ borderBottom: "1px solid var(--border-card)", background: "var(--bg-card-header)" }}
      >
        <span
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
        >
          <Paperclip size={15} />
        </span>
        <h2 className="text-[13px] font-bold flex-1 min-w-0" style={{ color: "var(--text-heading)" }}>
          Admin — กรอกข้อมูลการจอง
        </h2>
      </div>

      <div className="px-5 py-4 flex flex-col gap-4">
        {/* Trip facts needed to place any booking — saves scrolling down to the request detail. */}
        <InfoStrip groups={tripInfo(request)} />

        {requiredRules.length === 0 ? (
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            คำขอนี้ไม่ต้องจองห้องพัก/ตั๋วโดยสาร/รถเช่า — กดปุ่มด้านล่างเพื่อปิดงานได้เลย
          </p>
        ) : (
          requiredRules.map((rule) => (
            <BookingTypeGroup
              key={rule.type}
              type={rule.type}
              label={rule.label}
              icon={TYPE_ICON[rule.type]}
              requestId={requestId}
              info={typeInfo(request, rule.type, optionIcons)}
              rows={rowsByType.get(rule.type) ?? []}
              onChanged={onChanged}
              onRequestDelete={(detailId) => setPendingDelete({ detailId, label: rule.label })}
              onImageClick={(src, alt) => setLightbox({ src, alt })}
            />
          ))
        )}

        {!allComplete && (
          <div
            className="rounded-xl px-4 py-3 flex items-start gap-2"
            style={{ background: "var(--bg-info-yellow)", border: "1px solid var(--border-info-yellow)" }}
          >
            <AlertTriangle size={15} style={{ color: "var(--text-info-yellow)", marginTop: 1 }} className="shrink-0" />
            <p className="text-[12.5px] m-0" style={{ color: "var(--text-info-yellow)" }}>
              ยังกรอกไม่ครบ: {missingLabels.join(", ")}
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1" style={{ borderTop: "1px solid var(--border-light)" }}>
          <button
            type="button"
            onClick={handleComplete}
            disabled={completing || !allComplete}
            className="mt-2 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-bold cursor-pointer border-none text-white disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: "var(--positive, #15b357)" }}
          >
            {completing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {completing ? "กำลังปิดงาน..." : "ทำรายการเสร็จ (Complete)"}
          </button>

          {/* Bounce back instead of booking — e.g. the trip details are wrong or unbookable. */}
          <button
            type="button"
            onClick={() => { setBounce("return"); setBounceComment(""); }}
            className="mt-2 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-bold cursor-pointer"
            style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}
          >
            <RotateCcw size={14} /> ส่งกลับแก้ไข
          </button>
          <button
            type="button"
            onClick={() => { setBounce("reject"); setBounceComment(""); }}
            className="mt-2 inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-bold cursor-pointer"
            style={{ color: "var(--color-danger)", border: "1px solid rgba(220,38,38,0.25)", background: "rgba(220,38,38,0.06)" }}
          >
            <ThumbsDown size={14} /> ไม่อนุมัติ
          </button>
        </div>
      </div>

      <Dialog
        open={pendingDelete != null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null);
        }}
        title="ลบรายการจอง"
        uniformSurface
      >
        <p className="text-[13px] mb-6" style={{ color: "var(--text-secondary)" }}>
          ลบรายการ <strong style={{ color: "var(--text-heading)" }}>{pendingDelete?.label}</strong> นี้ใช่หรือไม่?
          ไฟล์แนบของรายการนี้จะถูกลบไปด้วย
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setPendingDelete(null)}
            disabled={deleting}
            className="text-[13px] font-medium px-4 py-2 rounded-lg cursor-pointer"
            style={{ color: "var(--text-secondary)", background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={handleConfirmDelete}
            disabled={deleting}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium px-4 py-2 rounded-lg cursor-pointer border-none text-white"
            style={{ background: "var(--btn-danger-bg)", color: "var(--btn-danger-text)", border: "1px solid var(--btn-danger-border)", opacity: deleting ? 0.7 : 1 }}
          >
            {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            {deleting ? "กำลังลบ..." : "ยืนยัน ลบ"}
          </button>
        </div>
      </Dialog>

      <Dialog
        open={bounce != null}
        onOpenChange={(open) => {
          if (!open && !bouncing) setBounce(null);
        }}
        title={bounce === "return" ? "ส่งกลับให้ผู้ขอแก้ไข — ระบุเหตุผล" : "ไม่อนุมัติคำขอ — ระบุเหตุผล"}
        uniformSurface
      >
        <div className="flex flex-col gap-3 mb-5">
          <p className="text-[13px] m-0" style={{ color: "var(--text-secondary)" }}>
            {bounce === "return"
              ? "คำขอจะกลับไปเป็นสถานะ “ส่งกลับแก้ไข” ให้ผู้ขอปรับข้อมูลแล้วส่งใหม่ตั้งแต่ขั้นผู้จัดการ"
              : "คำขอจะถูกปิดเป็น “ไม่อนุมัติ” และไม่สามารถแก้ไขต่อได้"}
          </p>
          <textarea
            value={bounceComment}
            onChange={(e) => setBounceComment(e.target.value)}
            rows={3}
            placeholder={bounce === "return" ? "ระบุสิ่งที่ต้องแก้ไข..." : "ระบุเหตุผลที่ไม่อนุมัติ..."}
            className="w-full rounded-lg px-3 py-2 text-[13px] outline-none resize-y"
            style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setBounce(null)}
            disabled={bouncing}
            className="text-[13px] font-medium px-4 py-2 rounded-lg cursor-pointer"
            style={{ color: "var(--text-secondary)", background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={handleBounce}
            disabled={bouncing}
            className="inline-flex items-center gap-1.5 text-[13px] font-bold px-4 py-2 rounded-lg cursor-pointer"
            style={
              bounce === "return"
                ? { background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)", opacity: bouncing ? 0.7 : 1 }
                : { background: "var(--btn-danger-bg)", color: "var(--btn-danger-text)", border: "1px solid var(--btn-danger-border)", opacity: bouncing ? 0.7 : 1 }
            }
          >
            {bouncing ? <Loader2 size={13} className="animate-spin" /> : null}
            {bouncing ? "กำลังดำเนินการ..." : bounce === "return" ? "ยืนยัน ส่งกลับแก้ไข" : "ยืนยัน ไม่อนุมัติ"}
          </button>
        </div>
      </Dialog>

      <ImageLightbox
        open={lightbox != null}
        src={lightbox?.src ?? ""}
        alt={lightbox?.alt}
        onClose={() => setLightbox(null)}
      />
    </div>
  );
}

/**
 * One booking type — its saved rows plus, when asked for, one unsaved slot. The slot is always
 * open while the type has no rows at all, so there is something to type into / attach to.
 */
function BookingTypeGroup({
  type,
  label,
  icon,
  requestId,
  info,
  rows,
  onChanged,
  onRequestDelete,
  onImageClick,
}: {
  type: BookingType;
  label: string;
  icon: ReactNode;
  requestId: number;
  info: InfoGroup[];
  rows: BookingDetail[];
  onChanged: () => void;
  onRequestDelete: (detailId: number) => void;
  onImageClick: (src: string, alt: string) => void;
}) {
  const [draftOpen, setDraftOpen] = useState(false);

  /**
   * Which draft slot created which saved row — and therefore which React key
   * each row card carries.
   *
   * **This is what keeps the AI read alive.** Attaching a file to the empty slot
   * creates the row (`ensureDetailId`), the parent refetches, and the row then
   * arrives in `rows` while the slot closes. Keyed naively — `"draft"` for the
   * slot, `detail.id` for a saved row — React sees one card leave and another
   * arrive, unmounts the first, and every piece of its state goes with it: the
   * in-flight read, the note saying it is running, and the figures it was about
   * to fill in. The read then resolves into a component nobody is looking at.
   *
   * So the row inherits the key of the slot that created it, and each press of
   * "เพิ่ม" opens a slot with a *new* number rather than re-using `"draft"`.
   * One card, mounted from the first attach until the panel closes; no key ever
   * moves from one card to another, so no already-landed row is remounted when
   * the next slot opens.
   */
  const [draftSlot, setDraftSlot] = useState(0);
  const slotOfRow = useRef(new Map<number, number>());
  const rowKey = (id: number) => {
    const slot = slotOfRow.current.get(id);
    return slot === undefined ? `row-${id}` : `slot-${slot}`;
  };

  /* Close the slot only once the new row actually shows up in the refetched request —
     hiding it the moment the POST returns would blink the card out and back in. It is
     the row's arrival that closes the slot, not a count going up: a row appearing for
     any other reason should not shut a slot somebody deliberately opened. */
  const draftLanded = rows.some((r) => slotOfRow.current.get(r.id) === draftSlot);
  const showDraft = !draftLanded && (draftOpen || rows.length === 0);
  const total = rows.length + (showDraft ? 1 : 0);
  const complete = isTypeComplete(rows);

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-card)" }}>
      <div
        className="flex items-center justify-between gap-2 px-4 py-2.5"
        style={{ background: "var(--bg-card-header)", borderBottom: "1px solid var(--border-light)" }}
      >
        <span className="flex items-center gap-2 text-[12.5px] font-bold" style={{ color: "var(--text-heading)" }}>
          <span style={{ color: "var(--nav-active-text)" }}>{icon}</span>
          {label}
          {rows.length > 1 && (
            <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
              ({rows.length} รายการ)
            </span>
          )}
        </span>
        <span
          className="text-[10.5px] font-bold px-2 py-0.5 rounded-full shrink-0"
          style={
            complete
              ? { background: "var(--bg-info-green)", color: "var(--text-info-green)" }
              : { background: "var(--bg-badge)", color: "var(--text-muted)" }
          }
        >
          {complete ? "ครบถ้วน" : "ยังไม่ครบ"}
        </span>
      </div>

      <div className="px-4 py-3.5 flex flex-col gap-3">
        {/* What this particular booking has to match (nights, legs, rental window). */}
        <InfoStrip groups={info} />

        {rows.map((detail, idx) => (
          <BookingRowCard
            key={rowKey(detail.id)}
            type={type}
            requestId={requestId}
            detail={detail}
            position={idx + 1}
            total={total}
            onChanged={onChanged}
            onDelete={() => onRequestDelete(detail.id)}
            onImageClick={onImageClick}
          />
        ))}

        {showDraft && (
          <BookingRowCard
            key={`slot-${draftSlot}`}
            type={type}
            requestId={requestId}
            detail={undefined}
            position={rows.length + 1}
            total={total}
            onChanged={onChanged}
            onCreated={(id) => slotOfRow.current.set(id, draftSlot)}
            onDelete={rows.length > 0 ? () => setDraftOpen(false) : undefined}
            onImageClick={onImageClick}
          />
        )}

        <button
          type="button"
          /* A new slot number, never a re-used one — see `slotOfRow` above. */
          onClick={() => { setDraftSlot((s) => s + 1); setDraftOpen(true); }}
          disabled={showDraft}
          className="self-start inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12.5px] font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: "transparent", border: "1px dashed var(--border-card)", color: "var(--text-secondary)" }}
        >
          <Plus size={13} /> เพิ่ม{label}
        </button>
      </div>
    </div>
  );
}

/**
 * One `AccTravelBookingDetail` row. `detail` is undefined for a not-yet-created row: the very
 * first save OR the very first attachment creates it (`ensureDetailId`), so Admin never has to
 * save before attaching. `createdIdRef` remembers the new id until the parent's refetch lands,
 * so a second action on the same card edits that row instead of creating another one.
 */
function BookingRowCard({
  type,
  requestId,
  detail,
  position,
  total,
  onChanged,
  onCreated,
  onDelete,
  onImageClick,
}: {
  type: BookingType;
  requestId: number;
  detail: BookingDetail | undefined;
  position: number;
  total: number;
  onChanged: () => void;
  /** Told the id the very first save minted, so the parent can keep this card's key. */
  onCreated?: (id: number) => void;
  onDelete?: () => void;
  onImageClick: (src: string, alt: string) => void;
}) {
  const [bookingNo, setBookingNo] = useState(detail?.bookingNo ?? "");
  const [priceExVat, setPriceExVat] = useState(numText(detail?.priceExVat));
  const [vat, setVat] = useState(numText(detail?.vatAmount));
  const [discount, setDiscount] = useState(numText(detail?.discountAmount));
  const [totalAmount, setTotalAmount] = useState(numText(detail?.totalAmount));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const createdIdRef = useRef<number | null>(null);

  /**
   * How the read of the attached file is going.
   *
   * `"reading"` is the only value that locks anything, and it is left the moment
   * the call lands — **with a figure or with a failure, no difference**. This is
   * the one place AP-17 must not copy its own ID-card rule: that check fails
   * closed because an unverified national ID card is the thing it exists to
   * stop, and there is no equivalent here. A booking desk that cannot type a
   * booking number because Anthropic is down is a desk that cannot work, and
   * nothing is protected by making them wait.
   */
  const [readNote, setReadNote] = useState<"reading" | BookingFieldsFailure | null>(null);

  const detailId = detail?.id ?? createdIdRef.current;
  const files = detail?.files ?? [];
  const complete = !!detail && isRowComplete(detail);

  /* Every figure goes through the same admission test the server applies, so what the
     field means as it is typed is what will be stored. Blank reads as null, not as zero. */
  const nPrice = sanitizeBookingAmount(priceExVat);
  const nVat = sanitizeBookingAmount(vat);
  const nDiscount = sanitizeBookingAmount(discount);
  const nTotal = sanitizeBookingAmount(totalAmount);

  /* A suggestion and a flag, never a correction: what is stored is what the invoice says.
     A half-filled row is deliberately not a mismatch — see `booking-amounts.ts`. */
  const computedTotal = suggestedTotal(nPrice, nVat, nDiscount);
  const mismatch = totalMismatch(nPrice, nVat, nDiscount, nTotal);

  /**
   * The fields open only once there is a file behind them and the read of it has
   * finished. Attaching is what unlocks them — the same shape AP-1's expense row
   * uses, where the receipt is asked for before the money is.
   *
   * The rule is read against the **saved** row, not the live inputs, and it
   * exempts a row that already records something. Saving and uploading are
   * independent here, so a row can hold a booking number and a price with no
   * file — see `booking-lock.ts`, which owns the rule and the reason.
   */
  const reading = readNote === "reading";
  const hasFile = files.length > 0;
  const locked = bookingFieldsLocked({ saved: detail ?? null, hasFile, reading });

  /* The read resolves seconds after the attach. These keep its write honest against
     fields that have since been filled in by hand. */
  const valuesRef = useRef({ bookingNo, priceExVat, vat, discount, totalAmount });
  valuesRef.current = { bookingNo, priceExVat, vat, discount, totalAmount };
  const aliveRef = useRef(true);
  useEffect(() => {
    // Set on mount, not just cleared on unmount. StrictMode runs effects
    // mount → cleanup → mount in development, so a cleanup-only version leaves
    // this false for the rest of the component's life: every read then returns
    // early, the note sits on "กำลังอ่านข้อมูล" forever and no field is ever
    // filled. `reactStrictMode` is unset in next.config.mjs, which means on.
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);
  /* The read is billed per call, so one at a time per row. `reading` is state and lags
     a render behind; a ref is what a second file picked in the same tick actually sees. */
  const readingRef = useRef(false);

  /** Blank all five. Used when a row's first file arrives, and when its last one goes. */
  function clearFields() {
    setBookingNo("");
    setPriceExVat("");
    setVat("");
    setDiscount("");
    setTotalAmount("");
  }

  /**
   * Read the attachment and offer what it says.
   *
   * `replaces` is set for a row's first file, where the read owns the row: the
   * fields were blanked in the same tick, so `valuesRef` still holds the values
   * that were cleared and guarding against them would restore exactly what the
   * clear removed. Otherwise a person outranks the read — see booking-file-sync.
   */
  async function prefillFrom(file: File, replaces: boolean) {
    readingRef.current = true;
    setReadNote("reading");
    try {
      const read = await readBookingFields(file);
      if (!aliveRef.current) return;
      if (read.failure) {
        // The reason is carried through so the note names the right remedy: a
        // file with nothing on it, a key an operator must replace, and an
        // outage are three different things to be told. The fields open either
        // way — that is what the `finally` and this early return both preserve.
        setReadNote(read.failure);
        return;
      }
      // Whatever arrived while the call was in flight was typed by a person,
      // and a person outranks the read. Each field is judged on its own: three
      // filled by the read beside two typed by hand is the normal outcome.
      const v = valuesRef.current;
      const f = read.fields;
      const free = (current: string) => replaces || !current.trim();
      if (f.bookingNo && free(v.bookingNo)) setBookingNo(f.bookingNo);
      if (f.priceExVat != null && free(v.priceExVat)) setPriceExVat(String(f.priceExVat));
      if (f.vat != null && free(v.vat)) setVat(String(f.vat));
      if (f.discount != null && free(v.discount)) setDiscount(String(f.discount));
      if (f.total != null && free(v.totalAmount)) setTotalAmount(String(f.total));
      setReadNote(null);
    } catch {
      if (aliveRef.current) setReadNote("error");
    } finally {
      readingRef.current = false;
    }
  }

  /** True while any of the five is still blank — nothing left to fill means nothing to ask. */
  function anyFieldEmpty(): boolean {
    const v = valuesRef.current;
    return (
      !v.bookingNo.trim() ||
      !v.priceExVat.trim() ||
      !v.vat.trim() ||
      !v.discount.trim() ||
      !v.totalAmount.trim()
    );
  }

  /* Flag anything Admin still has to act on: edits typed but not saved yet, or a row that is
     missing a number / price / attachment. Figures are compared numerically so "50" vs "50.00"
     doesn't read as an unsaved edit. */
  const dirty =
    (sanitizeBookingNo(bookingNo) ?? "") !== (detail?.bookingNo?.trim() ?? "") ||
    nPrice !== (detail?.priceExVat ?? null) ||
    nVat !== (detail?.vatAmount ?? null) ||
    nDiscount !== (detail?.discountAmount ?? null) ||
    nTotal !== (detail?.totalAmount ?? null);
  const needsAttention = dirty || !complete;
  const attentionLabel = dirty ? "ยังไม่ได้บันทึก" : "ยังไม่ครบ";

  /** Create (detailId == null) or update the row from the current inputs. Toasts on failure. */
  async function persist(id: number | null): Promise<number | null> {
    // A figure typed but refused — not a number, negative, or past the ceiling —
    // is reported rather than quietly stored as NULL. The server applies the
    // same test and is the actual gate; this is so the person sees why.
    const figures: Array<[string, string, number | null]> = [
      ["ราคา (ก่อน VAT)", priceExVat, nPrice],
      ["ภาษี (VAT)", vat, nVat],
      ["ส่วนลด", discount, nDiscount],
      ["ราคารวม", totalAmount, nTotal],
    ];
    for (const [label, raw, value] of figures) {
      if (raw.trim() !== "" && value === null) {
        toast.error(`${label}: กรอกเป็นตัวเลขไม่ติดลบ และไม่เกิน ${MAX_BOOKING_AMOUNT.toLocaleString()} บาท`);
        return null;
      }
    }
    if (bookingNo.trim() !== "" && sanitizeBookingNo(bookingNo) === null) {
      toast.error(`เลขที่การจองยาวเกิน ${MAX_BOOKING_NO_LENGTH} ตัวอักษร`);
      return null;
    }
    try {
      const res = await fetch(`/api/request/travel-booking/admin/requests/${requestId}/booking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingType: type,
          detailId: id,
          bookingNo: sanitizeBookingNo(bookingNo),
          priceExVat: nPrice,
          vatAmount: nVat,
          discountAmount: nDiscount,
          totalAmount: nTotal,
        }),
      });
      const json: { ok: boolean; error?: string; data?: { id: number } } = await res.json();
      if (!json.ok || !json.data) {
        toast.error(json.error ?? "บันทึกข้อมูลการจองไม่สำเร็จ");
        return null;
      }
      // The parent keys this card on the slot that created the row, so the card
      // survives the refetch that turns a draft into a saved row — and with it,
      // any read still in flight. See `slotOfRow` in `BookingTypeGroup`.
      if (id == null) onCreated?.(json.data.id);
      createdIdRef.current = json.data.id;
      return json.data.id;
    } catch {
      toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
      return null;
    }
  }

  /** The row's id, creating the row first if it doesn't exist yet (attach-before-save). */
  async function ensureDetailId(): Promise<number | null> {
    const existing = detail?.id ?? createdIdRef.current;
    return existing != null ? existing : persist(null);
  }

  async function handleSave() {
    setSaving(true);
    const id = await persist(detail?.id ?? createdIdRef.current);
    setSaving(false);
    if (id == null) return;
    toast.success("บันทึกข้อมูลการจองแล้ว");
    onChanged();
  }

  async function handleUpload(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const picked = Array.from(fileList);

    // No type check here. This slot takes any file, and the server's
    // `checkAttachment` is what decides — it reads the bytes, which `file.type`
    // only claims. A browser-side copy of that rule is how AP-1's widening was
    // missed: the route already accepted the file and this refused it before it
    // was ever posted.

    // Read the first file for the five fields, in the background and in
    // parallel with the upload — the fields are locked until it lands either
    // way, so nothing is gained by waiting for SharePoint first.
    //
    // Skipped when a read is already in flight: each call is billed and a
    // second could only race the first. On a later file it is skipped again
    // unless something is still blank — a second attachment is another page of
    // the same booking, not a new booking.
    //
    // A row's FIRST file is different: it clears the five fields and the read
    // then owns them. The figures describe the confirmation, so a new
    // confirmation replaces them rather than filling in around figures left
    // from a document that is no longer attached.
    const attach = onFileAttached({ existingFileCount: files.length });
    if (attach.clearFirst) clearFields();
    if (!readingRef.current && (attach.clearFirst || anyFieldEmpty())) {
      void prefillFrom(picked[0], attach.readReplaces);
    }

    setUploading(true);
    try {
      const id = await ensureDetailId();
      if (id == null) return;
      const fd = new FormData();
      fd.append("refType", BOOKING_TYPE_REFTYPE[type]);
      fd.append("bookingDetailId", String(id));
      for (const f of picked) fd.append("files", f);
      const res = await fetch(`/api/request/travel-booking/requests/${requestId}/files`, {
        method: "POST",
        body: fd,
      });
      const json: { ok: boolean; error?: string } = await res.json();
      if (!json.ok) {
        toast.error(json.error ?? "อัปโหลดไฟล์ไม่สำเร็จ");
        return;
      }
      toast.success("แนบไฟล์แล้ว");
      onChanged();
    } catch {
      toast.error("อัปโหลดไฟล์ไม่สำเร็จ");
    } finally {
      setUploading(false);
    }
  }

  async function handleRemoveFile(fileId: number) {
    setRemovingId(fileId);
    try {
      const res = await fetch(
        `/api/request/travel-booking/requests/${requestId}/files?fileId=${fileId}`,
        { method: "DELETE" },
      );
      const json: { ok: boolean; error?: string } = await res.json();
      if (!json.ok) {
        toast.error(json.error ?? "ลบไฟล์ไม่สำเร็จ");
        return;
      }
      // The figures were read off the confirmation, so losing the last one
      // leaves them describing a document nobody can open.
      //
      // Whether the row then re-locks depends on what is SAVED, not on what is
      // now on screen: `bookingFieldsLocked` reads `detail`. A draft clears and
      // locks, back where it was before anything was attached. A row already
      // saved with figures clears and stays open — it has to, or removing a file
      // would strand the very data the last fix was about. Either way the
      // database keeps its values until Save is pressed, which the
      // "ยังไม่ได้บันทึก" badge is there to say.
      if (onFileRemoved({ remainingFileCount: files.length - 1 })) {
        clearFields();
        setReadNote(null);
      }
      onChanged();
    } catch {
      toast.error("ลบไฟล์ไม่สำเร็จ");
    } finally {
      setRemovingId(null);
    }
  }

  const inputId = `admin-file-${type}-${detailId ?? "new"}`;

  return (
    <div
      className="rounded-xl px-4 py-3.5 flex flex-col gap-3"
      style={{
        border: needsAttention ? "1px solid var(--border-info-yellow)" : "1px solid var(--border-light)",
      }}
    >
      {(total > 1 || needsAttention || onDelete) && (
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-[11.5px] font-bold" style={{ color: "var(--text-secondary)" }}>
            {total > 1 ? `รายการที่ ${position}` : ""}
            {needsAttention && (
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)" }}
              >
                {attentionLabel}
              </span>
            )}
          </span>
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              title="ลบรายการนี้"
              className="inline-flex items-center gap-1 text-[11.5px] font-medium px-2 py-1 rounded-lg cursor-pointer"
              style={{ color: "var(--color-danger)", background: "transparent", border: "1px solid rgba(220,38,38,0.25)" }}
            >
              <Trash2 size={12} /> ลบ
            </button>
          )}
        </div>
      )}

      {/* The five fields the invoice states, in the order it states them. `relative` is
          load-bearing: the reading overlay is laid over this whole block rather than over
          each input, so the state reads as one thing and nothing below shifts when it
          clears. One sweep, not five — AP-1 overlays a single field because it has one. */}
      <div className="relative">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="col-span-2 sm:col-span-4">
            <FieldCaption>เลขที่การจอง / Booking No.</FieldCaption>
            <input
              type="text"
              value={bookingNo}
              onChange={(e) => setBookingNo(e.target.value)}
              disabled={locked}
              maxLength={MAX_BOOKING_NO_LENGTH}
              className="w-full rounded-lg px-3 py-2 text-[13px] outline-none disabled:opacity-60 disabled:cursor-not-allowed"
              style={fieldStyle}
              placeholder="เช่น AGD-123456"
            />
          </div>
          <BahtField label="ราคา (ก่อน VAT)" value={priceExVat} onChange={setPriceExVat} disabled={locked} />
          <BahtField label="ภาษี (VAT)" value={vat} onChange={setVat} disabled={locked} />
          <BahtField label="ส่วนลด" value={discount} onChange={setDiscount} disabled={locked} />
          <BahtField label="ราคารวม" value={totalAmount} onChange={setTotalAmount} disabled={locked} />
        </div>

        {/* AP-1's treatment: a 40% band sweeping across a tinted panel, laid over
            disabled inputs of the same size rather than replacing them. */}
        {reading && (
          <div
            className="absolute inset-0 rounded-lg overflow-hidden pointer-events-none"
            style={{ background: "color-mix(in srgb, var(--color-action) 10%, var(--bg-input))" }}
          >
            <div
              className="acc-progress h-full"
              style={{ background: "color-mix(in srgb, var(--color-action) 26%, transparent)" }}
            />
            <span
              className="absolute inset-0 flex items-center justify-center gap-1.5 text-[12px] font-semibold"
              style={{ color: "var(--color-action)" }}
            >
              <Loader2 size={13} className="animate-spin" />
              กำลังอ่านข้อมูล...
            </span>
          </div>
        )}
      </div>

      {/* Why the fields are shut — gated on `locked`, not on `!hasFile`. A row that
          already holds saved figures is open despite having no file, and telling its
          owner the fields unlock after attaching would describe a lock that is not
          there. Never shown while the read runs either: the fields say that themselves,
          and a second line about a box that is refusing typing is the exact fault this
          wording avoids. */}
      {locked && !reading && !uploading && (
        <p className="m-0 text-[12px]" style={{ color: "var(--text-muted)" }}>
          แนบไฟล์ใบยืนยันการจองก่อน ระบบจะอ่านข้อมูลให้ แล้วจึงแก้ไขช่องต่าง ๆ ได้
        </p>
      )}

      {/* Open, but still missing its confirmation — `isTypeComplete` wants one before
          the booking can be completed, so the prompt stays. It just no longer claims
          the fields are waiting on it. */}
      {!locked && !hasFile && !reading && !uploading && (
        <p className="m-0 text-[12px]" style={{ color: "var(--text-muted)" }}>
          อย่าลืมแนบไฟล์ใบยืนยันการจอง
        </p>
      )}

      {/* How the read went. A note beside working fields — never in place of one. It
          clears itself once every figure is in, however each one got there. */}
      {readNote != null && readNote !== "reading" && anyFieldEmpty() && (
        <p className="m-0 text-[12px]" style={{ color: "var(--text-muted)" }}>
          {BOOKING_FIELDS_FAILURE_TEXT[readNote]}
        </p>
      )}

      {/* The arithmetic, as a check on the paper rather than a replacement for it. */}
      {computedTotal != null && (
        <p
          className="m-0 text-[11.5px] tabular-nums flex items-center gap-1.5"
          style={{ color: mismatch ? "var(--text-info-yellow)" : "var(--text-muted)" }}
        >
          {mismatch && <AlertTriangle size={12} className="shrink-0" />}
          ราคารวมที่คำนวณได้ (ราคา + VAT − ส่วนลด): {computedTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท
          {mismatch && " — ไม่ตรงกับราคารวมที่กรอกไว้ ตรวจสอบกับเอกสารอีกครั้ง"}
        </p>
      )}

      <div className="pt-2" style={{ borderTop: "1px solid var(--border-light)" }}>
        <label
          className="block text-[11px] font-semibold mb-1.5 uppercase tracking-wide"
          style={{ color: "var(--text-muted)" }}
        >
          ไฟล์แนบ (ใบยืนยันการจอง) — อย่างน้อย 1 ไฟล์
        </label>

        <input
          id={inputId}
          type="file"
          // No `accept`: this slot takes any file. A booking confirmation is not
          // always a photo or a PDF — travel agents send workbooks — and
          // `accept="image/*,application/pdf"` made the OS picker hide the file
          // somebody was trying to attach, so they attached a screenshot of it
          // instead. The server's `checkAttachment` reads the bytes and is the
          // gate; `attachmentResponseHeaders` is what keeps serving them safe.
          multiple
          className="hidden"
          onChange={(e) => {
            void handleUpload(e.target.files);
            e.target.value = "";
          }}
        />
        {/* Thumbnails and the picker share one wrapping row — the "add" tile is just the last
            square, so the strip keeps growing to the right as files come in. */}
        <div className="flex flex-wrap gap-2 mt-0.5">
          {files.map((f) => (
            <AdminFileChip
              key={f.id}
              file={f}
              onRemove={() => handleRemoveFile(f.id)}
              removing={removingId === f.id}
              onImageClick={onImageClick}
            />
          ))}
          <label
            htmlFor={inputId}
            title="แนบไฟล์ใบยืนยันการจอง"
            className="w-20 h-20 shrink-0 rounded-xl flex flex-col items-center justify-center gap-1 cursor-pointer transition-colors"
            style={{ border: "1px dashed var(--border-card)", background: "transparent", color: "var(--text-muted)" }}
          >
            {uploading ? <Loader2 size={17} className="animate-spin" /> : <Paperclip size={17} />}
            <span className="text-[9.5px] font-medium leading-tight text-center px-1">
              {uploading ? "กำลังอัปโหลด..." : "แนบไฟล์"}
            </span>
          </label>
        </div>
      </div>

      {/* Save last — the row is filled top-to-bottom (number → price → files), so the commit
          action belongs at the end. Attachments are saved on upload, not by this button. */}
      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="self-start inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12.5px] font-bold cursor-pointer disabled:opacity-60"
        style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)", color: "var(--text-secondary)" }}
      >
        {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
        {saving ? "กำลังบันทึก..." : "บันทึกข้อมูลการจอง"}
      </button>
    </div>
  );
}

/** Thumbnail + remove badge. Images open in the shared zoomable lightbox (same as the ID card);
    PDFs have nothing to zoom, so they still open in a new tab. */
function AdminFileChip({
  file,
  onRemove,
  removing,
  onImageClick,
}: {
  file: TravelBookingFileMeta;
  onRemove: () => void;
  removing: boolean;
  onImageClick: (src: string, alt: string) => void;
}) {
  const url = `/api/request/travel-booking/files/${file.id}`;
  const isImage = file.contentType.startsWith("image/");

  return (
    <div className="relative w-20 h-20">
      {isImage ? (
        <button
          type="button"
          onClick={() => onImageClick(url, file.fileName)}
          title={file.fileName}
          className="w-full h-full rounded-xl overflow-hidden cursor-pointer p-0 border"
          style={{ borderColor: "var(--border-card)", background: "var(--bg-card)" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={file.fileName} className="w-full h-full object-cover" draggable={false} />
        </button>
      ) : (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          title={file.fileName}
          className="w-full h-full rounded-xl overflow-hidden flex flex-col items-center justify-center gap-1 border no-underline"
          style={{ borderColor: "var(--border-card)", background: "var(--bg-card)" }}
        >
          <FileText size={22} style={{ color: "var(--text-muted)" }} />
          <span className="text-[9px] px-1 truncate w-full text-center" style={{ color: "var(--text-muted)" }}>
            {file.fileName}
          </span>
        </a>
      )}
      <button
        type="button"
        onClick={onRemove}
        disabled={removing}
        aria-label="ลบไฟล์"
        title="ลบไฟล์"
        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center cursor-pointer border-none"
        style={{ background: "var(--btn-danger-bg)", color: "var(--btn-danger-text)", border: "1px solid var(--btn-danger-border)", opacity: removing ? 0.6 : 1 }}
      >
        {removing ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
      </button>
    </div>
  );
}
