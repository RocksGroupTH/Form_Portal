"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import {
  AlertTriangle,
  BedDouble,
  Car,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  FileText,
  Loader2,
  Paperclip,
  Plus,
  RotateCcw,
  Save,
  ThumbsDown,
  Ticket,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { Dialog } from "@/components/ui";
import {
  AttachmentViewer,
  attachmentKind,
  type AttachmentKind,
  type AttachmentSource,
} from "@/components/ui/AttachmentViewer";
import { useTravelBookingOptionIcons } from "@/features/travel-booking/hooks/useOptionIcons";
import { InfoStrip, tripInfo, typeInfo, type InfoGroup } from "@/features/travel-booking/components/BookingInfoStrip";
import { GooglePinView } from "@/features/travel-booking/components/GooglePinView";
import { BOOKING_TYPE_REFTYPE } from "@/features/travel-booking/constants";
import { REQUIRED_BOOKING_RULES } from "@/features/travel-booking/lib/booking-requirements";
import {
  sanitizeBookingAmount,
  suggestedTotal,
  totalMismatch,
  MAX_BOOKING_AMOUNT,
} from "@/features/travel-booking/lib/booking-amounts";
import {
  BOOKING_CURRENCY_NOTE,
  bookingCurrencyOptions,
  bookingCurrencyWord,
  effectiveBookingCurrency,
  referenceRateNote,
} from "@/features/travel-booking/lib/booking-currency";
import { THB, toBaht } from "@/lib/acc/currency";
import { rateAsOfYmd } from "@/lib/acc/currency-display";
import { bookingFieldsLocked, type SavedBookingEntry } from "@/features/travel-booking/lib/booking-lock";
import { bookingRowDirty } from "@/features/travel-booking/lib/booking-dirty";
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
import type { AccBrandOption } from "@/features/accounting/types";

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
 *
 * `unit` is the currency code, and **only ever set for a foreign request**. A
 * baht field renders exactly the markup it rendered before this feature — same
 * `px-3`, no adornment — because a brand with no currency configured has to
 * leave this panel pixel-identical. `฿`/`บาท` is not added for baht for the same
 * reason. It was called `BahtField` until a request could hold ringgit.
 */
function AmountField({
  label,
  value,
  onChange,
  disabled,
  unit,
  baht,
  bahtNote,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
  unit?: string | null;
  /**
   * This field in baht, or null to render nothing under it.
   *
   * Null covers three different situations and deliberately looks the same in
   * all three: a baht request, where the line would restate the figure above it;
   * an empty field, where there is nothing to convert; and no usable rate, where
   * the honest answer is silence rather than a figure at 1:1.
   *
   * **Zero is not null.** A ส่วนลด of 0 renders `≈ 0.00 บาท`, because a gap in a
   * column of four reads as "this one could not be converted" and invites exactly
   * the question the line exists to answer.
   */
  baht?: number | null;
  /**
   * A qualifier after the baht figure — `(อัตราอ้างอิง)` on the total alone.
   *
   * It is on one of the four rather than all four because a bare `≈` on a money
   * screen reads as what a bank will settle at, and none of these are: every rate
   * here is an ECB mid-market reference rate and no screen may call it a Bank of
   * Thailand rate. Repeating it under all four would be four copies of one
   * caption on a row already carrying the rate in full above it; putting it on
   * the total puts it on the figure that is actually recorded.
   */
  bahtNote?: string;
}) {
  return (
    <div>
      <FieldCaption>{label}</FieldCaption>
      <div className="relative">
        <input
          type="number"
          step="0.01"
          min="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          // A three-letter code needs room a bare figure does not; baht keeps
          // the padding it has always had.
          className={`w-full rounded-lg py-2 text-[13px] outline-none tabular-nums text-right disabled:opacity-60 disabled:cursor-not-allowed ${
            unit ? "pl-3 pr-11" : "px-3"
          }`}
          style={fieldStyle}
          placeholder="0.00"
        />
        {unit && (
          <span
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-bold pointer-events-none"
            style={{ color: "var(--text-muted)" }}
          >
            {unit}
          </span>
        )}
      </div>
      {/* Right-aligned to sit under the figure it converts rather than under the
          caption, and `tabular-nums` so four of them line up down the row. */}
      {baht != null && (
        <p
          className="m-0 mt-1 text-[10.5px] tabular-nums text-right"
          style={{ color: "var(--text-muted)" }}
        >
          ≈ {baht.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท
          {bahtNote ? ` ${bahtNote}` : ""}
        </p>
      )}
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
 * another. Each row saves BookingNo + PriceExVat and takes its own attachments; picking a file
 * only holds it on the card, and "บันทึกข้อมูลการจอง" is what writes the row and then uploads
 * the files it is holding (see `BookingRowCard.handleSave`). Nothing reaches SharePoint before
 * that press. The bottom "ทำรายการเสร็จ" button is disabled until every
 * required group is complete — the server (`completeRequest`) re-validates the same gate, so
 * this is a UX pre-check, not the source of truth.
 *
 * It is **also** disabled while any row is carrying unsaved edits, and that half has no
 * server counterpart at all: the server sees only what was saved, so a booking signed off
 * against figures still sitting in somebody's input boxes is invisible to it. Each card
 * answers `bookingRowDirty` for itself and reports up through `onDirtyChange`; the panel
 * counts, and says in Thai why the button is off rather than leaving a dead control.
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

  /* ── The request's currency ──
   *
   * **The brand's currencies AND the destination's, starting on baht.** AP-17's
   * fill-in form carries no money field at all: the amounts are typed here, weeks
   * later, by a booking desk reading an invoice. So the toggle offers everything
   * that invoice could plausibly be in — the company's own books and the place
   * the trip went — and starts on baht, which almost all of them are, foreign
   * trips included, because they are commonly booked through a Thai agent.
   * `booking-currency.ts` owns the rule and says why each arm alone was wrong.
   *
   * A baht-only brand on a Thai trip yields an empty option list, and then
   * nothing here renders and nothing below changes: `currency` is `THB`, every
   * `unit` is null, and the panel is the one that shipped before any of this.
   *
   * ── The brand is fetched; the destination is not ──
   *
   * `request.countryCode` is in props, but the brand's `BrandCurrency` rows are
   * not: they live in `Rocks_Portal_Form` only and reaching them costs two pools
   * and three queries (`listBrandRegistry`). Computing the list server-side in
   * `getTravelBookingRequest` would put that cost on **every** AP-17 detail view,
   * including the requester's own, where this panel never renders — so the fetch
   * stays here, on the one screen that needs it.
   *
   * **`null` while it is in flight, and the direction of that is safe.** Before
   * 2026-09-02 an unidentified brand had to be a distinct third state, because
   * the default was the brand's own currency and posting `THB` in that window
   * would have silently recorded a foreign invoice as baht. The default is baht
   * now, so the window's default IS the intended answer.
   *
   * What a null brand still costs is the **offer**, not the default, and for the
   * union's headline case it costs all of it: KSI → Bangkok has the destination
   * arm contributing nothing, so a null `brandOption` yields `[]` and the toggle
   * does not render at all rather than rendering a shorter list. For the
   * milliseconds of a fetch that is invisible. It is **not** always milliseconds:
   * `.catch(() => {})` below leaves it null for the component's life, as does a
   * brand since de-granted from `AccFormBrand`, which the options route filters
   * on and `listBrandRegistry()` does not. A genuinely foreign invoice is then
   * unrecordable as foreign, with nothing on screen saying why.
   *
   * Accepted rather than fixed, because the direction is the safe one: the panel
   * can only ever offer a **subset** of what `resolveBookingFx` accepts, so
   * nothing the desk can pick is refused, and the failure is a missing option
   * rather than a wrong record. The opposite direction — offering more than the
   * server takes — is the one that costs money, and that one now raises rather
   * than downgrading; see `BOOKING_CURRENCY_STALE_ERROR`.
   */
  const countryCode = request.countryCode;
  const brandCode = request.brandCode;
  const [brandOption, setBrandOption] = useState<AccBrandOption | null>(null);
  useEffect(() => {
    if (!brandCode) return;
    // A local `cancelled` inside the effect, fresh per run — not a ref set on
    // mount, which StrictMode's mount → cleanup → mount would leave false for
    // the component's life (see `aliveRef` below for where that bit).
    let cancelled = false;
    fetch("/api/request/travel-booking/options/brands")
      .then((r) => r.json())
      .then((j: { ok?: boolean; data?: AccBrandOption[] }) => {
        if (cancelled || !j?.ok || !Array.isArray(j.data)) return;
        setBrandOption(j.data.filter((b) => b.brandCode === brandCode)[0] ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [brandCode]);

  const currencyOptions = useMemo(
    () => bookingCurrencyOptions(brandOption, countryCode),
    [brandOption, countryCode],
  );
  /** What the header already records, normalised. `""` means nobody has yet. */
  const storedCurrency = (request.currency ?? "").trim().toUpperCase();
  const [pickedCurrency, setPickedCurrency] = useState<string | null>(null);
  /* Reconciled against both arms rather than used raw, so a stale page — or a
     request whose country or brand grant has since changed — can never leave the
     desk posting a code the server will not accept. Every refusal lands on THB,
     which `resolveBookingFx` short-circuits without opening a pool. */
  const currency = effectiveBookingCurrency(pickedCurrency ?? storedCurrency, brandOption, countryCode);
  const currencyUnit = currency !== THB ? currency : null;
  /* The rate the SERVER recorded, and only while it still belongs to the
     currency now on screen. A bare number goes wrong the moment the toggle
     moves: switch MYR → THB and a bare rate would caption `1 THB = 8.25 บาท`,
     a made-up figure on a money screen. */
  const exchangeRate =
    storedCurrency !== "" && storedCurrency === currency && request.exchangeRate && request.exchangeRate > 0
      ? request.exchangeRate
      : null;
  /* Which day's rate that is (migration 130). It follows `exchangeRate` through
     the same gate rather than being read off the request directly: a date left
     standing beside a rate that has just been ruled out by the toggle would
     caption a figure that is no longer on screen. */
  const exchangeRateAsOf = exchangeRate === null ? null : request.rateAsOf;

  /* ── The preview rate ──
   *
   * `exchangeRate` above is the rate the SERVER recorded, and it exists only
   * once this request has been saved in the currency now on screen. Until then
   * the desk types 100 / 7 / 107 GBP and sees no baht figure anywhere — the
   * state this fetch exists for. The conversion is the whole reason accounting
   * needs the currency recorded, and asking somebody to save first in order to
   * see it is asking them to commit blind.
   *
   * **The same route AP-1's form already uses**, `/api/request/accounting/fx-rate`
   * (`useTravelExpenseForm.ts:436-441`) — one endpoint, not a second with its own
   * behaviour. Its `/api/request/accounting` prefix classifies AP-1 in
   * `ROUTE_RULES`, which is harmless because the route reads no database at all;
   * its own header says so. AP-2 duplicated it instead, and that is the drift not
   * to repeat.
   *
   * **Display only, and the client still never posts a rate.** `resolveBookingFx`
   * fetches its own on every save, which `booking-currency-guard.test.ts` pins —
   * so this is a reading and the stored figure is the server's. The two can
   * differ if the provider moves between them, which is why everything derived
   * from either is prefixed `≈` and captioned `(อัตราอ้างอิง)`.
   *
   * A baht request passes `null` as the key and makes no request at all, so an
   * ordinary Thai booking is untouched. One fetch per panel, not per row: the
   * currency is the request's, so every card on the request shares this.
   */
  const { data: fxData } = useSWR<{ rate: number; asOf?: string | null }>(
    currencyUnit ? `/api/request/accounting/fx-rate?currency=${currencyUnit}` : null,
    async (url: string) => {
      const res = await fetch(url);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Request failed");
      return json.data;
    },
    { revalidateOnFocus: false },
  );
  const previewRate =
    fxData && Number.isFinite(fxData.rate) && fxData.rate > 0 ? fxData.rate : null;
  /* **The stored rate wins where there is one.** It is what these figures were
     actually recorded at; the preview only fills the gap before the first save.
     Preferring the preview would have the card change its baht figure after a
     save for a reason no reader could see. Null from both means the line does not
     render at all — the same refusal `toBaht` makes, and never a figure at 1:1. */
  const shownRate = exchangeRate ?? previewRate;
  /* Which day's rate that is. The ECB publishes on working days only, so a
     Saturday preview shows Friday's, and the caption is where that is visible. */
  const shownRateAsOf =
    exchangeRate !== null
      ? exchangeRateAsOf
      : previewRate === null
        ? null
        : rateAsOfYmd(fxData?.asOf ?? null);

  const [completing, setCompleting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ detailId: number; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  /* One viewer for the whole panel, not one per chip — a modal rendered inside a
     list item is a modal per item. The chips only report which file was clicked. */
  const [viewing, setViewing] = useState<{ source: AttachmentSource; kind: AttachmentKind } | null>(
    null,
  );

  /* Bounce the request instead of booking it — back to the requester, or rejected outright. */
  const [bounce, setBounce] = useState<"return" | "reject" | null>(null);
  const [bounceComment, setBounceComment] = useState("");
  const [bouncing, setBouncing] = useState(false);

  /**
   * Which rows are carrying unsaved edits, keyed on the row's own identity.
   *
   * The Complete button is here and the edits are three components down, so each
   * card reports its own answer up and the panel only ever counts. A plain object
   * rather than a `Set` because the update has to be immutable to re-render and
   * `new Set(prev)` needs downlevel iteration under this ES5 target.
   *
   * **The key is `BookingTypeGroup`'s own `rowKey`**, prefixed by type — the same
   * identity that keeps a card mounted when its draft slot becomes a saved row, so
   * a save does not look like one row leaving and another arriving.
   *
   * `reportRowDirty` is `useCallback`'d with no dependencies so a card's reporting
   * effect is driven by its own dirtiness and nothing else, and the updater returns
   * `prev` untouched when the answer has not changed, so a report that says the
   * same thing again costs no render.
   */
  const [dirtyRows, setDirtyRows] = useState<Record<string, true>>({});
  const reportRowDirty = useCallback((key: string, dirty: boolean) => {
    setDirtyRows((prev) => {
      if (dirty === (prev[key] === true)) return prev;
      const next = { ...prev };
      // Clearing the entry rather than storing `false` is what makes an unmounted
      // row stop counting: a card that has gone leaves nothing behind, so a
      // deleted row cannot hold the Complete button disabled with nothing on
      // screen explaining why.
      if (dirty) next[key] = true;
      else delete next[key];
      return next;
    });
  }, []);
  const anyRowDirty = Object.keys(dirtyRows).length > 0;

  const missingLabels = requiredRules
    .filter((r) => !isTypeComplete(rowsByType.get(r.type) ?? []))
    .map((r) => r.label);
  const allComplete = missingLabels.length === 0;

  async function handleComplete() {
    if (!requestId) return;
    // The button is disabled for this, but the check is repeated here because a
    // press that slipped through would sign the booking off against figures that
    // exist only on somebody's screen — see `booking-dirty.ts`.
    if (anyRowDirty) return;
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

        {/* Where the trip actually goes. The strip above lists it as text —
            InfoStrip's InfoItem is { label, value: string } and cannot hold a
            map — so the pin sits under it. Renders nothing for a trip whose
            place was filed before coordinates were captured (migration 135);
            those cannot be backfilled, so the desk sees the address alone,
            exactly as it did before. */}
        <GooglePinView
          places={request.workLocations.map((w) => ({
            name: w.name,
            lat: w.lat,
            lng: w.lng,
          }))}
          height={200}
        />

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
              currency={currency}
              currencyOptions={currencyOptions}
              brandCode={brandCode}
              countryCode={countryCode}
              exchangeRate={exchangeRate}
              exchangeRateAsOf={exchangeRateAsOf}
              shownRate={shownRate}
              shownRateAsOf={shownRateAsOf}
              onCurrencyChange={setPickedCurrency}
              onChanged={onChanged}
              onRowDirty={reportRowDirty}
              onRequestDelete={(detailId) => setPendingDelete({ detailId, label: rule.label })}
              onViewFile={(f) =>
                setViewing({
                  source: { name: f.fileName, url: `/api/request/travel-booking/files/${f.id}` },
                  kind: attachmentKind(f.fileName, f.contentType),
                })
              }
              /* A pick that has not been uploaded yet, so the viewer takes the `File`
                 itself rather than a URL — `AttachmentSource` accepts either, the same
                 way IdCardUpload hands it its pending card image. */
              onViewPending={(f) =>
                setViewing({
                  source: { name: f.name, file: f },
                  kind: attachmentKind(f.name, f.type),
                })
              }
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

        {/* Why the Complete button is off. A disabled control with no explanation is
            the thing to avoid, and this one is off for a reason nobody can see from
            the button: an edit typed into a card further up the page. Kept separate
            from the "ยังกรอกไม่ครบ" strip above — the two can be true at once, and
            they ask for different things to be done. */}
        {anyRowDirty && (
          <div
            className="rounded-xl px-4 py-3 flex items-start gap-2"
            style={{ background: "var(--bg-info-yellow)", border: "1px solid var(--border-info-yellow)" }}
          >
            <AlertTriangle size={15} style={{ color: "var(--text-info-yellow)", marginTop: 1 }} className="shrink-0" />
            <p className="text-[12.5px] m-0" style={{ color: "var(--text-info-yellow)" }}>
              มีรายการที่แก้ไขแล้วยังไม่ได้บันทึก — ปิดงานไม่ได้จนกว่าจะกด “บันทึกข้อมูลการจอง”
              ในรายการนั้น หรือกด “ใช้ข้อมูลที่บันทึกไว้ล่าสุด” เพื่อย้อนกลับไปข้อมูลที่บันทึกไว้
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1" style={{ borderTop: "1px solid var(--border-light)" }}>
          <button
            type="button"
            onClick={handleComplete}
            title={
              anyRowDirty
                ? "มีรายการที่ยังไม่ได้บันทึก"
                : !allComplete
                  ? "ยังกรอกข้อมูลการจองไม่ครบ"
                  : undefined
            }
            disabled={completing || !allComplete || anyRowDirty}
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

      <AttachmentViewer
        open={viewing != null}
        source={viewing?.source ?? null}
        kind={viewing?.kind ?? "other"}
        onClose={() => setViewing(null)}
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
  currency,
  currencyOptions,
  brandCode,
  countryCode,
  exchangeRate,
  exchangeRateAsOf,
  shownRate,
  shownRateAsOf,
  onCurrencyChange,
  onChanged,
  onRowDirty,
  onRequestDelete,
  onViewFile,
  onViewPending,
}: {
  type: BookingType;
  label: string;
  icon: ReactNode;
  requestId: number;
  info: InfoGroup[];
  rows: BookingDetail[];
  /**
   * The request's currency, already reconciled against what this request may
   * hold. Never null in practice — `effectiveBookingCurrency` always answers a
   * code — but the nullable shape stays, because the alternative to "not known"
   * is assuming baht, which is the record that must never be written by accident.
   */
  currency: string | null;
  /** Empty when neither the brand nor the destination offers anything: no toggle. */
  currencyOptions: string[];
  /** The company the request is filed under — half of what decides the currency toggle. */
  brandCode: string | null;
  /** The trip.s destination, which decides the currency toggle. Null before `CountryCode` existed. */
  countryCode: string | null;
  /** The rate the server recorded, or null. Display only. */
  exchangeRate: number | null;
  /**
   * Which day's rate that is, `YYYY-MM-DD` (migration 130), or null.
   *
   * It travels beside `exchangeRate` rather than being read off the request in
   * here, so it is gated by the same currency test: a date shown beside a rate
   * the toggle has just ruled out would caption a figure no longer on screen.
   */
  exchangeRateAsOf: string | null;
  /**
   * The rate to CONVERT WITH — the stored one where there is one, otherwise the
   * preview fetched for the currency on screen. Null when neither can be had, and
   * then no baht figure renders anywhere rather than one at 1:1.
   */
  shownRate: number | null;
  /** Which day `shownRate` is from, `YYYY-MM-DD`, or null. */
  shownRateAsOf: string | null;
  onCurrencyChange: (code: string) => void;
  onChanged: () => void;
  /** Report one row's unsaved-edits answer to the panel, which owns Complete. */
  onRowDirty: (key: string, dirty: boolean) => void;
  onRequestDelete: (detailId: number) => void;
  onViewFile: (file: TravelBookingFileMeta) => void;
  onViewPending: (file: File) => void;
}) {
  const [draftOpen, setDraftOpen] = useState(false);

  /**
   * Which draft slot created which saved row — and therefore which React key
   * each row card carries.
   *
   * **This is what keeps the AI read — and the held files — alive.** Saving the
   * empty slot creates the row (`handleSave` → `persist`), the parent refetches, and
   * the row then arrives in `rows` while the slot closes. Keyed naively — `"draft"`
   * for the slot, `detail.id` for a saved row — React sees one card leave and
   * another arrive, unmounts the first, and every piece of its state goes with it:
   * the in-flight read, the note saying it is running, the figures it was about to
   * fill in, and any picked file still waiting to be uploaded. The read then
   * resolves into a component nobody is looking at, and a file whose upload failed
   * has nowhere left to be retried from.
   *
   * So the row inherits the key of the slot that created it, and each press of
   * "เพิ่ม" opens a slot with a *new* number rather than re-using `"draft"`.
   * One card, mounted from the first save until the panel closes; no key ever
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
  /* The dirty registry is keyed on the same identity as the React key, prefixed by
     type so two groups' `row-7` cannot be one entry. Same reason `rowKey` exists at
     all: a draft slot keeps its identity when it becomes a saved row, so a save is
     not read as one row leaving the register and another joining it. */
  const reportDirty = useCallback(
    (key: string, dirty: boolean) => onRowDirty(`${type}:${key}`, dirty),
    [type, onRowDirty],
  );

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
            dirtyKey={rowKey(detail.id)}
            type={type}
            requestId={requestId}
            detail={detail}
            position={idx + 1}
            total={total}
            currency={currency}
            currencyOptions={currencyOptions}
            brandCode={brandCode}
            countryCode={countryCode}
            exchangeRate={exchangeRate}
            exchangeRateAsOf={exchangeRateAsOf}
            shownRate={shownRate}
            shownRateAsOf={shownRateAsOf}
            onCurrencyChange={onCurrencyChange}
            onChanged={onChanged}
            onDirtyChange={reportDirty}
            onDelete={() => onRequestDelete(detail.id)}
            onViewFile={onViewFile}
            onViewPending={onViewPending}
          />
        ))}

        {showDraft && (
          <BookingRowCard
            key={`slot-${draftSlot}`}
            dirtyKey={`slot-${draftSlot}`}
            type={type}
            requestId={requestId}
            detail={undefined}
            position={rows.length + 1}
            total={total}
            currency={currency}
            currencyOptions={currencyOptions}
            brandCode={brandCode}
            countryCode={countryCode}
            exchangeRate={exchangeRate}
            exchangeRateAsOf={exchangeRateAsOf}
            shownRate={shownRate}
            shownRateAsOf={shownRateAsOf}
            onCurrencyChange={onCurrencyChange}
            onChanged={onChanged}
            onDirtyChange={reportDirty}
            onCreated={(id) => slotOfRow.current.set(id, draftSlot)}
            onDelete={rows.length > 0 ? () => setDraftOpen(false) : undefined}
            onViewFile={onViewFile}
            onViewPending={onViewPending}
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
 * One `AccTravelBookingDetail` row. `detail` is undefined for a not-yet-created row, and
 * **"บันทึกข้อมูลการจอง" is the only thing that creates it** — picking a file used to create it
 * too, through an `ensureDetailId` that is now gone, which meant a card nobody ever saved still
 * left a booking-detail row behind and its bytes in SharePoint. `createdIdRef` remembers the new
 * id until the parent's refetch lands, so a second save on the same card edits that row instead
 * of creating another one.
 */
function BookingRowCard({
  dirtyKey,
  type,
  requestId,
  detail,
  position,
  total,
  currency,
  currencyOptions,
  brandCode,
  countryCode,
  exchangeRate,
  exchangeRateAsOf,
  shownRate,
  shownRateAsOf,
  onCurrencyChange,
  onChanged,
  onDirtyChange,
  onCreated,
  onDelete,
  onViewFile,
  onViewPending,
}: {
  /** This card's identity in the panel's dirty registry — the parent's `rowKey`. */
  dirtyKey: string;
  type: BookingType;
  requestId: number;
  detail: BookingDetail | undefined;
  position: number;
  total: number;
  /**
   * The currency these four figures are in. **Per request, not per row** — it
   * lives on `AccRequest` and every row of the request shares it, which is why
   * the toggle changes the panel's state rather than this card's.
   *
   * **Null means "not known here"**, not baht: the save then posts no currency
   * and the server re-derives one from the stored destination. The panel no
   * longer produces that state — the country is in props — but the null stays
   * expressible, because the alternative to "not known" is assuming baht, which
   * is the record that must never be written by accident.
   */
  currency: string | null;
  /** Empty for a domestic or country-less trip: the toggle is not rendered. */
  currencyOptions: string[];
  /** Named in the currency caption — where the value came from, not a control. */
  /** The company the request is filed under — half of what decides the currency toggle. */
  brandCode: string | null;
  /** The trip.s destination, which decides the currency toggle. Null before `CountryCode` existed. */
  countryCode: string | null;
  exchangeRate: number | null;
  /** Which day's rate that is, `YYYY-MM-DD` (migration 130). See the panel. */
  exchangeRateAsOf: string | null;
  /**
   * The rate to CONVERT WITH — the stored one where there is one, otherwise the
   * preview fetched for the currency on screen. Null when neither can be had, and
   * then no baht figure renders anywhere rather than one at 1:1.
   */
  shownRate: number | null;
  /** Which day `shownRate` is from, `YYYY-MM-DD`, or null. */
  shownRateAsOf: string | null;
  onCurrencyChange: (code: string) => void;
  onChanged: () => void;
  /** Tell the panel whether this row is carrying unsaved edits. */
  onDirtyChange: (key: string, dirty: boolean) => void;
  /** Told the id the very first save minted, so the parent can keep this card's key. */
  onCreated?: (id: number) => void;
  onDelete?: () => void;
  onViewFile: (file: TravelBookingFileMeta) => void;
  /** Open a picked-but-not-yet-uploaded file in the same viewer the stored ones use. */
  onViewPending: (file: File) => void;
}) {
  const [bookingNo, setBookingNo] = useState(detail?.bookingNo ?? "");
  const [priceExVat, setPriceExVat] = useState(numText(detail?.priceExVat));
  const [vat, setVat] = useState(numText(detail?.vatAmount));
  const [discount, setDiscount] = useState(numText(detail?.discountAmount));
  const [totalAmount, setTotalAmount] = useState(numText(detail?.totalAmount));
  const [saving, setSaving] = useState(false);
  /**
   * Files picked on this card and not sent anywhere yet.
   *
   * They are held here until "บันทึกข้อมูลการจอง" is pressed, which is what the
   * requirement asks for: the bytes go to SharePoint on save, not on pick.
   */
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  /** True only while `handleSave` is posting the held files. */
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

  /* Null for baht, so every adornment, caption and extra line below disappears
     on a request whose brand has no currency configured. */
  const currencyUnit = currency === THB ? null : currency;
  const currencyWord = bookingCurrencyWord(currency);
  /* The four figures stay in the request's own currency. This is the reading
     beside them, and it exists only once the SERVER has recorded a rate: the
     client never calls the FX provider, so before the first save there is
     nothing honest to show.

     **This one is still computed, and deliberately so.** The detail page and the
     report both read migration 136's stored `TotalAmountBaht` instead; this
     cannot, because `nTotal` is what the desk is TYPING. A stored column holds
     the last saved figure, so reading it here would caption a number the person
     is in the middle of changing. Live preview and settled record are different
     questions, and the stored column answers only the second.

     Nothing double-converts as a result: this multiplies the live foreign input,
     never the stored baht column, and the two are never mixed.

     `toBaht` and not a bare multiplication, so an unusable rate produces no line
     rather than a wrong one — the same refusal the save applies server-side. */
  const totalInBaht =
    currencyUnit !== null && shownRate !== null && nTotal !== null
      ? toBaht(nTotal, shownRate)
      : null;
  /* The same conversion for the figure the ARITHMETIC produces, which is what
     the desk is looking at while it types — `computedTotal` is price + VAT −
     discount, recomputed on every keystroke, where `nTotal` is the ราคารวม field
     as filled in. They are the same number on a well-formed invoice and differ
     exactly when `mismatch` is true, which is when seeing both in baht is worth
     most. */
  const computedInBaht =
    currencyUnit !== null && shownRate !== null && computedTotal != null
      ? toBaht(computedTotal, shownRate)
      : null;
  /* Each field in baht, under the field itself.

     **Each is converted from its own figure, and the column can therefore be a
     satang off when read as a sum.** `toBaht` rounds to 2dp, so three separately
     rounded addends can miss the rounded total: at the rate in front of the desk
     today, 45.0110, `46.06 + 3.22 − 0` gives 2,073.21 + 144.94 = 2,218.15 while
     the total 49.28 converts to 2,218.14. Reachable with entirely ordinary
     figures, and bounded at one or two satang.

     **Deriving the total's baht by summing the parts instead would be worse, and
     is the fix not to make.** `recomputeBookingBaht` stores
     `ROUND(TotalAmount * @rate, 2)` — the total converted directly — and
     `report-service` sums that stored column. A card that showed a summed figure
     would disagree with the database and with the report, which is a real
     discrepancy rather than a displayed satang. So the total's baht stays the
     conversion of the total, every figure carries `≈`, and the parts are readings
     of their own fields rather than terms of an equation. */
  const inBaht = (n: number | null) =>
    currencyUnit !== null && shownRate !== null && n !== null ? toBaht(n, shownRate) : null;
  const priceInBaht = inBaht(nPrice);
  const vatInBaht = inBaht(nVat);
  const discountInBaht = inBaht(nDiscount);

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
  /* Held picks count as attachments here. `bookingFieldsLocked` unlocks on `hasFile`,
     so counting only the stored ones would leave the fields shut after a pick — and
     shut for good, because the press that would store the file is the press that
     needs the fields typed into first. The same count feeds `booking-file-sync`, so
     a pick is the row's "first file" when nothing is stored yet, and removing the
     last one — held or stored — still clears the figures. */
  /* What the last successful save wrote, until the parent's refetch supersedes it. */
  const [savedSnapshot, setSavedSnapshot] = useState<SavedBookingEntry | null>(null);
  const attachedCount = files.length + pendingFiles.length;
  const hasFile = attachedCount > 0;
  /* `detail` is the parent's copy and lags a successful save by a refetch. Without
     the local snapshot a brand-new row re-locks for that gap — held files cleared,
     `detail` still undefined — and shows "แนบไฟล์ใบยืนยันการจองก่อน" one beat after
     the save that attached the file. The snapshot is what was just persisted, so the
     rule sees a row that records something, which it does; `detail` takes over the
     moment it arrives. */
  const locked = bookingFieldsLocked({ saved: detail ?? savedSnapshot, hasFile, reading });

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
      // The two codes are what let the route ask which currency the document is
      // in at all; `currency` is what decides whether the answer belongs in these
      // fields. Both sides build their set from the same pair through the same
      // `bookingCurrencyOptions`, so the set the model may answer from and the
      // set these fields accept cannot disagree.
      const read = await readBookingFields(file, { brandCode, countryCode, claimCurrency: currency });
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

  /**
   * Anything Admin still has to act on: edits typed but not saved yet — a held file
   * being one of them — or a row missing a number / price / attachment.
   *
   * The comparison itself is `bookingRowDirty`, which owns it for both readers: this
   * badge and the panel's Complete gate. It is read against **`detail ?? savedSnapshot`**,
   * the same value the field lock uses and for the same reason — `detail` is the
   * parent's copy and lags a successful save by a refetch, so comparing against it
   * alone would report a row as edited for the one beat after its own save, and
   * hold Complete off with nothing to press but Save again.
   */
  const unsaved = bookingRowDirty({
    saved: detail ?? savedSnapshot,
    current: { bookingNo, priceExVat, vat, discount, totalAmount },
    pendingFileCount: pendingFiles.length,
  });
  const needsAttention = unsaved || !complete;
  const attentionLabel = unsaved ? "ยังไม่ได้บันทึก" : "ยังไม่ครบ";

  /**
   * Report this row's answer to the panel, and take it out of the register when the
   * card goes.
   *
   * One effect with a cleanup, not a mount flag and a cleanup-only ref: this file
   * documents that trap a few lines up (`aliveRef`), and it does not apply here.
   * StrictMode's mount → cleanup → mount runs the cleanup, which deregisters, and
   * then the effect again, which re-reports — so the register ends the sequence
   * holding exactly what this row says. The cleanup is what stops a **deleted** row
   * from leaving Complete disabled forever with nothing on screen to explain it.
   */
  useEffect(() => {
    onDirtyChange(dirtyKey, unsaved);
    return () => onDirtyChange(dirtyKey, false);
  }, [dirtyKey, unsaved, onDirtyChange]);

  /**
   * Put the row back to what was last saved. **Local only — no fetch, no DELETE.**
   *
   * Stored files stay stored; only picks this card is still holding are dropped,
   * because they are not part of the saved state and are what "unsaved" mostly
   * means here. A row with nothing saved empties, which leaves it exactly as a
   * fresh slot is — `bookingFieldsLocked` re-locks it once the held picks are gone,
   * which is the correct state for a row nobody has started.
   */
  function handleRevert() {
    const saved = detail ?? savedSnapshot;
    setBookingNo(saved?.bookingNo ?? "");
    setPriceExVat(numText(saved?.priceExVat));
    setVat(numText(saved?.vatAmount));
    setDiscount(numText(saved?.discountAmount));
    setTotalAmount(numText(saved?.totalAmount));
    setPendingFiles([]);
    setReadNote(null);
    toast.success(saved ? "ย้อนกลับไปใช้ข้อมูลที่บันทึกไว้ล่าสุดแล้ว" : "ล้างข้อมูลที่กรอกไว้แล้ว");
  }

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
        // `MAX_BOOKING_AMOUNT` is a ceiling on the figure as typed, whatever the
        // currency — `sanitizeBookingAmount` is deliberately unchanged by this
        // feature (it has nine call sites, all in the request's own currency).
        // The word after it therefore has to name the currency being typed, not
        // baht, or the message describes a rule that is not the one applied.
        toast.error(`${label}: กรอกเป็นตัวเลขไม่ติดลบ และไม่เกิน ${MAX_BOOKING_AMOUNT.toLocaleString()} ${currencyWord}`);
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
          // The currency only. The rate is the server's to fetch and write —
          // AP-2 lets the browser post one and nothing verifies it there.
          currency,
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

  /**
   * Post the held files against a row that now certainly exists. Returns the message
   * to show on failure, or null when they all landed.
   *
   * Same endpoint and same `FormData` shape the pick used to build — `refType`,
   * `bookingDetailId`, one repeated `files` part per file. Nothing about how the
   * server admits these bytes changes; only when they are sent.
   */
  async function uploadPending(id: number, picked: File[]): Promise<string | null> {
    const fd = new FormData();
    fd.append("refType", BOOKING_TYPE_REFTYPE[type]);
    fd.append("bookingDetailId", String(id));
    for (const f of picked) fd.append("files", f);
    try {
      const res = await fetch(`/api/request/travel-booking/requests/${requestId}/files`, {
        method: "POST",
        body: fd,
      });
      const json: { ok: boolean; error?: string } = await res.json();
      return json.ok ? null : (json.error ?? "อัปโหลดไฟล์ไม่สำเร็จ");
    } catch {
      return "อัปโหลดไฟล์ไม่สำเร็จ";
    }
  }

  /**
   * Write the row, then send whatever files this card is holding for it.
   *
   * The order is forced rather than chosen: the upload route wants a
   * `bookingDetailId`, and until the row is persisted there is not one. `persist`
   * reports its own failure and returns null, and nothing is uploaded in that case.
   *
   * **A failed upload does not clear `pendingFiles`, and does not claim success.**
   * The row is saved and the files are not, so pressing Save again is the retry —
   * a safe one, because the second press updates the same row rather than creating
   * another. Toasting "บันทึกแล้ว" over a half-done save is what would leave
   * somebody believing their confirmation is in SharePoint when it is not.
   */
  async function handleSave() {
    setSaving(true);
    const id = await persist(detail?.id ?? createdIdRef.current);
    if (id == null) {
      setSaving(false);
      return;
    }
    setSavedSnapshot({
      bookingNo: bookingNo.trim() || null,
      priceExVat: nPrice,
      vatAmount: nVat,
      discountAmount: nDiscount,
      totalAmount: nTotal,
    });
    const picked = pendingFiles;
    if (picked.length === 0) {
      setSaving(false);
      toast.success("บันทึกข้อมูลการจองแล้ว");
      onChanged();
      return;
    }
    setUploading(true);
    const failure = await uploadPending(id, picked);
    setUploading(false);
    setSaving(false);
    if (failure) {
      toast.error(`บันทึกข้อมูลการจองแล้ว แต่แนบไฟล์ไม่สำเร็จ: ${failure} — กดบันทึกอีกครั้งเพื่อลองแนบใหม่`);
      // The figures did land, so the parent still refetches. The held files stay on
      // this card, which survives that refetch because it is keyed on the slot that
      // created it — see `slotOfRow` in `BookingTypeGroup`.
      onChanged();
      return;
    }
    setPendingFiles([]);
    toast.success("บันทึกข้อมูลการจองและแนบไฟล์แล้ว");
    onChanged();
  }

  /**
   * Take a pick onto the card. **Nothing is uploaded here, and no row is created.**
   *
   * The AI read still runs on the pick, deliberately: `readBookingFields` takes the
   * `File` and needs no upload, and the whole point of the read is that the five
   * fields fill while the person is looking at them. Deferring it to Save would put
   * the answer on screen after the moment it was useful.
   */
  function handlePick(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const picked = Array.from(fileList);

    // No type check here. This slot takes any file, and the server's
    // `checkAttachment` is what decides — it reads the bytes, which `file.type`
    // only claims. A browser-side copy of that rule is how AP-1's widening was
    // missed: the route already accepted the file and this refused it before it
    // was ever posted.

    // Skipped when a read is already in flight: each call is billed and a
    // second could only race the first. On a later file it is skipped again
    // unless something is still blank — a second attachment is another page of
    // the same booking, not a new booking.
    //
    // A row's FIRST file is different: it clears the five fields and the read
    // then owns them. The figures describe the confirmation, so a new
    // confirmation replaces them rather than filling in around figures left
    // from a document that is no longer attached. "First" counts held picks as
    // well as stored files — `attachedCount` — so a second pick on an unsaved card
    // does not wipe what the first pick's read has just produced.
    const attach = onFileAttached({ existingFileCount: attachedCount });
    if (attach.clearFirst) clearFields();
    if (!readingRef.current && (attach.clearFirst || anyFieldEmpty())) {
      void prefillFrom(picked[0], attach.readReplaces);
    }

    setPendingFiles((prev) => prev.concat(picked));
  }

  /**
   * Drop a held pick. **No DELETE** — the server has never heard of this file, so
   * there is nothing to ask it to remove.
   *
   * The clear rule is the stored one's: losing the last attachment, held or stored,
   * leaves the figures describing a document nobody can open.
   */
  function handleRemovePending(index: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
    if (onFileRemoved({ remainingFileCount: attachedCount - 1 })) {
      clearFields();
      setReadNote(null);
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
      if (onFileRemoved({ remainingFileCount: attachedCount - 1 })) {
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
          {/* Three quarters wide when the currency toggle sits beside it, the
              whole row when there is no toggle. Conditional rather than always
              3/4: a baht-only brand on a Thai trip must keep the full-width
              field it has always had, not a field with an empty quarter next to
              it. On mobile both are `col-span-2` of two columns, so they stack
              and the toggle lands under the number rather than beside it. */}
          <div className={currencyOptions.length > 0 ? "col-span-2 sm:col-span-3" : "col-span-2 sm:col-span-4"}>
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
          {/* สกุลเงิน, beside the booking number — the two facts the desk reads
              off the top of an invoice, in the order it reads them.

              Rendered ONLY where there is something to choose between:
              `currencyOptions` is empty for a baht-only brand on a Thai trip, and
              that card then looks exactly as it did before the feature shipped —
              full-width number field, no disabled one-option control, no
              placeholder.

              The value is the REQUEST's, not this row's: it lives on
              `AccRequest` and every booking row of the request shares it, which
              is what the note below the row says out loud. It is not chosen by
              the requester at any point — AP-17's fill-in form has no money field
              — so what the desk gets is baht, already selected, and the brand's
              or the destination's currency as the deliberate opt-in for an
              invoice that really is foreign.

              `disabled={locked}` shares the fields' rule rather than inventing
              one — and it earns its keep during a read: `locked` is true while
              one is in flight, and moving the currency underneath it would
              re-label figures the model is in the middle of writing. There is no
              status arm here and none is wanted; the panel itself renders only at
              ManagerApproved/ADMIN, so all of this is already unreachable once
              accounting has signed off. */}
          {currencyOptions.length > 0 && (
            <div className="col-span-2 sm:col-span-1">
              <FieldCaption>สกุลเงิน</FieldCaption>
              {/* `min-h` matches the input beside it so the pills sit on the same
                  baseline as the number field rather than riding above it. */}
              <div className="flex flex-wrap items-center gap-1.5 min-h-[38px]">
                {currencyOptions.map((code) => {
                  const active = currency === code;
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => onCurrencyChange(code)}
                      disabled={locked}
                      className="px-3 py-1.5 rounded-lg text-[12.5px] font-bold cursor-pointer transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                      style={{
                        borderWidth: 1,
                        borderStyle: "solid",
                        borderColor: active ? "var(--nav-active-text)" : "var(--border-card)",
                        background: active ? "var(--nav-active-bg)" : "var(--bg-card-alt)",
                        color: active ? "var(--nav-active-text)" : "var(--text-secondary)",
                      }}
                    >
                      {code}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* The rate and the note moved out of the toggle when it moved beside
              the number: a quarter-width column cannot hold a sentence. They span
              the row instead, directly under both, which is also where a reader
              looks for a caption about the field above. */}
          {currencyOptions.length > 0 && (
            <div className="col-span-2 sm:col-span-4 -mt-1">
              {/* `shownRate`, not the stored one: the rate stated here has to be
                  the rate the baht figures below were divided by, or the desk
                  can check the arithmetic and find it wrong. Before the first
                  save that is the preview; after it, the server's. */}
              {shownRate !== null && currencyUnit && (
                <p className="m-0 text-[11.5px] tabular-nums" style={{ color: "var(--text-muted)" }}>
                  {referenceRateNote(currencyUnit, shownRate, shownRateAsOf)}
                  {exchangeRate === null && " — ยังไม่ได้บันทึก อัตราจะถูกบันทึกอีกครั้งตอนกดบันทึก"}
                </p>
              )}
              <p className="m-0 mt-0.5 text-[11.5px]" style={{ color: "var(--text-muted)" }}>
                {BOOKING_CURRENCY_NOTE}
              </p>
            </div>
          )}

          <AmountField label="ราคา (ก่อน VAT)" value={priceExVat} onChange={setPriceExVat} disabled={locked} unit={currencyUnit} baht={priceInBaht} />
          <AmountField label="ภาษี (VAT)" value={vat} onChange={setVat} disabled={locked} unit={currencyUnit} baht={vatInBaht} />
          <AmountField label="ส่วนลด" value={discount} onChange={setDiscount} disabled={locked} unit={currencyUnit} baht={discountInBaht} />
          {/* `totalInBaht` is reused rather than recomputed here: it is the same
              conversion of the same figure, and two spellings of one number is
              how they start to differ. It is also, deliberately, `toBaht(nTotal)`
              and never the three figures beside it added up — see the note on
              `inBaht` above for why summing would be the worse answer. */}
          <AmountField label="ราคารวม" value={totalAmount} onChange={setTotalAmount} disabled={locked} unit={currencyUnit} baht={totalInBaht} bahtNote="(อัตราอ้างอิง)" />
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
          ราคารวมที่คำนวณได้ (ราคา + VAT − ส่วนลด): {computedTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {currencyWord}
          {computedInBaht !== null &&
            ` ≈ ${computedInBaht.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`}
          {mismatch && " — ไม่ตรงกับราคารวมที่กรอกไว้ ตรวจสอบกับเอกสารอีกครั้ง"}
        </p>
      )}

      {/* The standalone "ราคารวมคิดเป็นเงินบาท" line that stood here is gone.
          Every one of the four fields now carries its own baht figure directly
          under the number it converts, `totalInBaht` among them, so this line was
          the third appearance of one figure on one card — after the field itself
          and the computed-total line above. Its `(อัตราอ้างอิง)` qualifier moved
          onto the ราคารวม field with it and is not lost. */}

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
            handlePick(e.target.files);
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
              onViewFile={onViewFile}
            />
          ))}
          {pendingFiles.map((f, i) => (
            <PendingFileChip
              key={`${i}-${f.name}-${f.lastModified}`}
              file={f}
              onRemove={() => handleRemovePending(i)}
              onView={() => onViewPending(f)}
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

        {/* One quiet line saying what the dashed squares mean. The chips carry the
            state; this says what to do about it. */}
        {pendingFiles.length > 0 && (
          <p className="m-0 mt-2 text-[11.5px] flex items-center gap-1.5" style={{ color: "var(--text-info-yellow)" }}>
            <Clock size={12} className="shrink-0" />
            ไฟล์ {pendingFiles.length} ไฟล์ยังไม่ได้อัปโหลด — จะส่งขึ้นระบบเมื่อกด “บันทึกข้อมูลการจอง”
          </p>
        )}
      </div>

      {/* Save last — the row is filled top-to-bottom (number → price → files), so the commit
          action belongs at the end. It is also what uploads: a picked file waits on the card
          until this is pressed, so the row and its attachments are written by one action. */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12.5px] font-bold cursor-pointer disabled:opacity-60"
          style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)", color: "var(--text-secondary)" }}
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          {uploading ? "กำลังแนบไฟล์..." : saving ? "กำลังบันทึก..." : "บันทึกข้อมูลการจอง"}
        </button>

        {/* Beside Save and only while there is something to undo — the other half of
            what the Complete gate asks for. A control offering to discard nothing is
            noise, so it is not rendered on a clean row rather than shown disabled.

            No Dialog: this throws away local edits and nothing else, which is not
            what the two confirms in this file are for — those delete rows and bytes
            on the server. A toast says what happened, in the same voice as Save's. */}
        {unsaved && (
          <button
            type="button"
            onClick={handleRevert}
            /* Refused mid-read: the call in flight writes the five fields when it
               lands, so reverting underneath it would put back figures the person
               had just asked to be rid of. The fields are shut for that moment
               anyway — see `bookingFieldsLocked`. */
            disabled={saving || reading}
            title={
              detail ?? savedSnapshot
                ? "ทิ้งการแก้ไขในรายการนี้ แล้วกลับไปใช้ข้อมูลที่บันทึกไว้ล่าสุด"
                : "ล้างข้อมูลที่กรอกไว้ในรายการนี้"
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12.5px] font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: "transparent",
              border: "1px solid var(--border-info-yellow)",
              color: "var(--text-info-yellow)",
            }}
          >
            <Undo2 size={13} />
            {detail ?? savedSnapshot ? "ใช้ข้อมูลที่บันทึกไว้ล่าสุด" : "ล้างข้อมูลที่กรอก"}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * A picked file that is not stored anywhere yet.
 *
 * Deliberately the same 80×80 tile as `AdminFileChip`, with two differences: a
 * dashed border in the panel's "needs attention" colour, and a footer badge. Somebody
 * has to be able to tell which of these squares is actually in SharePoint without
 * reading anything — they are otherwise identical, and the difference is whether the
 * file survives closing the page.
 *
 * The thumbnail's object URL is made in an effect whose cleanup revokes exactly the
 * URL that run created — no ref set on mount, so strict mode's mount → cleanup →
 * mount simply makes a second URL and revokes the first.
 */
function PendingFileChip({
  file,
  onRemove,
  onView,
}: {
  file: File;
  onRemove: () => void;
  onView: () => void;
}) {
  const kind = attachmentKind(file.name, file.type);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== "image") return;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
      setPreviewUrl(null);
    };
  }, [file, kind]);

  return (
    <div className="relative w-20 h-20">
      <button
        type="button"
        onClick={onView}
        title={file.name + " — ยังไม่ได้อัปโหลด"}
        className={
          kind === "image" && previewUrl
            ? "relative w-full h-full rounded-xl overflow-hidden cursor-pointer p-0 border"
            : "relative w-full h-full rounded-xl overflow-hidden cursor-pointer p-0 border flex flex-col items-center justify-center gap-1"
        }
        style={{
          borderStyle: "dashed",
          borderColor: "var(--border-info-yellow)",
          background: "var(--bg-card)",
        }}
      >
        {kind === "image" && previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt={file.name} className="w-full h-full object-cover" draggable={false} />
        ) : (
          <>
            {kind === "excel" ? (
              <FileSpreadsheet size={22} style={{ color: "var(--text-muted)" }} />
            ) : (
              <FileText size={22} style={{ color: "var(--text-muted)" }} />
            )}
            <span className="text-[9px] px-1 truncate w-full text-center" style={{ color: "var(--text-muted)" }}>
              {file.name}
            </span>
          </>
        )}
        {/* Says which square is only on this page — the same badge language the card's
            own "ยังไม่ได้บันทึก" uses, one size down so it sits beside it rather than
            against it.

            **Inside the button, not beside it.** As a sibling it was a square-cornered
            bar laid over a rounded tile, so the bottom two corners read as square while
            the top stayed round. In here the button's own `overflow-hidden` clips it to
            the same `rounded-xl`, which also keeps the two radii from having to be
            kept in step by hand. `pointer-events-none` keeps the tile clickable. */}
        <span
          className="absolute bottom-0 inset-x-0 flex items-center justify-center gap-0.5 text-[8.5px] font-bold py-0.5 pointer-events-none"
          style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)" }}
        >
          <Clock size={9} /> ยังไม่อัปโหลด
        </span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label="เอาไฟล์ออก"
        title="เอาไฟล์ออก"
        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center cursor-pointer border-none"
        style={{ background: "var(--btn-danger-bg)", color: "var(--btn-danger-text)", border: "1px solid var(--btn-danger-border)" }}
      >
        <X size={11} />
      </button>
    </div>
  );
}

/**
 * Thumbnail + remove badge. **Every kind opens the shared in-page viewer** — the
 * one AP-1 and AP-4 use — so "view" means view. A PDF used to be an
 * `<a target="_blank">` pointed at the download route, where
 * `attachmentResponseHeaders` serves it `Content-Disposition: attachment`: the
 * tab downloaded the file and closed, which is not viewing it.
 *
 * `attachmentKind` derives the kind from the declared type and then the name;
 * a bare `contentType.startsWith("image/")` was what this had, and SharePoint
 * hands back `application/octet-stream` often enough for that to be wrong.
 */
function AdminFileChip({
  file,
  onRemove,
  removing,
  onViewFile,
}: {
  file: TravelBookingFileMeta;
  onRemove: () => void;
  removing: boolean;
  onViewFile: (file: TravelBookingFileMeta) => void;
}) {
  const url = `/api/request/travel-booking/files/${file.id}`;
  const kind = attachmentKind(file.fileName, file.contentType);

  return (
    <div className="relative w-20 h-20">
      <button
        type="button"
        onClick={() => onViewFile(file)}
        title={file.fileName}
        className={
          kind === "image"
            ? "w-full h-full rounded-xl overflow-hidden cursor-pointer p-0 border"
            : "w-full h-full rounded-xl overflow-hidden cursor-pointer p-0 border flex flex-col items-center justify-center gap-1"
        }
        style={{ borderColor: "var(--border-card)", background: "var(--bg-card)" }}
      >
        {kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={file.fileName} className="w-full h-full object-cover" draggable={false} />
        ) : (
          <>
            {kind === "excel" ? (
              <FileSpreadsheet size={22} style={{ color: "var(--text-muted)" }} />
            ) : (
              <FileText size={22} style={{ color: "var(--text-muted)" }} />
            )}
            <span className="text-[9px] px-1 truncate w-full text-center" style={{ color: "var(--text-muted)" }}>
              {file.fileName}
            </span>
          </>
        )}
      </button>
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
