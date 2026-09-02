/**
 * Client half of the AP-17 booking read: post the attached confirmation to
 * `/api/request/travel-booking/booking-fields` and hand back the five fields
 * the server decided on.
 *
 * The failure vocabulary mirrors AP-1's `read-receipt-amount.ts` and AP-4's
 * `read-receipt-fields.ts`, because the three are the same operation with
 * different questions. One line of copy cannot serve all three cases honestly —
 * "ไม่สำเร็จ" reads as *your file is no good* even when the fault is a revoked
 * key on our side, which is exactly what happened to AP-17's ID-card dialog on
 * 2026-08-24.
 *
 * **Never throws, and a failure never blocks the row.** Unlike the ID-card
 * check on this same form, this read is a convenience: it fills fields that the
 * booking desk can always type themselves. There is no safety property being
 * protected by refusing, and a desk that cannot enter a booking number because
 * Anthropic is down is a desk that cannot work — so every path here returns,
 * and the caller unlocks the fields on the way out.
 */
import { sameCurrency } from "@/lib/acc/currency";
import { toDownscaledCanvas } from "@/lib/image/downscale";

/** The five fields one booking row carries. Every one is independently nullable. */
export interface BookingFields {
  bookingNo: string | null;
  priceExVat: number | null;
  vat: number | null;
  discount: number | null;
  total: number | null;
}

export type BookingFieldsFailure =
  /** The call worked; nothing on this file could be trusted. */
  | "not-found"
  /**
   * The figures are real, and they are in a different currency from the one
   * this request records.
   *
   * Filling them would put ringgit figures into fields captioned in baht, on
   * the screen accounting signs off against — the defect this read carried
   * until it asked which currency the document was in. Converting instead is
   * not the alternative: the four figures are stored in the request's own
   * currency and stated in baht from the recorded rate.
   */
  | "currency-mismatch"
  /** Our side is not configured — a missing or revoked key (503). */
  | "unavailable"
  /** Upstream trouble or no network. Retrying later might work. */
  | "error";

/**
 * A `Record`, not a lookup with a default: adding a failure kind without copy
 * for it becomes a compile error rather than a blank note on the form.
 *
 * Every line ends the same way — **type it in yourself** — because every line
 * sits beside fields that are, by then, accepting typing. Copy that tells
 * somebody to fill in a box which is not editable is the specific fault this
 * wording exists to avoid.
 */
export const BOOKING_FIELDS_FAILURE_TEXT: Record<BookingFieldsFailure, string> = {
  "not-found": "อ่านข้อมูลจากไฟล์นี้ไม่เจอ — กรอกเองได้เลย",
  "currency-mismatch": "เอกสารนี้เป็นคนละสกุลเงินกับคำขอ — กรอกเองได้เลย",
  unavailable: "ระบบอ่านเอกสารยังไม่พร้อมใช้งาน — กรอกเองได้เลย",
  error: "อ่านเอกสารไม่ได้ตอนนี้ — กรอกเองได้เลย",
};

export interface BookingFieldsRead {
  /** Every field null when `failure` is set. */
  fields: BookingFields;
  /**
   * The currency the four figures are in, as the **server** decided it — never
   * as the caller suggested. Null when no figure was admitted.
   */
  currency: string | null;
  /** Set whenever nothing usable came back. */
  failure?: BookingFieldsFailure;
}

export interface BookingFieldsReadOptions {
  /**
   * Whose books the request is on, and where the trip goes. Sent as
   * `?brandCode=` and `?countryCode=`, and the route derives the currencies it
   * will admit from the pair **server-side** — a currency posted from here would
   * let a hand-shaped request have one accepted that neither its brand nor its
   * destination uses.
   *
   * Both are needed because the toggle offers the union of both, and the model
   * must be asked about exactly the set the desk can then record. Sending one
   * alone narrows the question and a foreign invoice comes back reported as
   * baht — which is what happened for one commit on 2026-09-02, when this sent
   * only the country.
   */
  brandCode?: string | null;
  countryCode?: string | null;
  /**
   * The currency this request records its booking figures in. Null or absent
   * means **not known here**, and the mismatch check is then skipped rather than
   * assuming baht.
   *
   * `AdminBookingPanel` always has an answer, though not always the final one:
   * it reconciles the stored choice against the destination in props plus the
   * brand it fetches, so while that fetch is in flight the answer can be baht
   * where it will shortly be the brand's currency. That costs a discarded read,
   * never a wrong figure — a mismatch drops the whole answer. The nullable shape
   * stays because skipping the check is the right answer for a caller that
   * genuinely cannot say, and because silently defaulting to baht is exactly the
   * failure this parameter exists to catch.
   */
  claimCurrency?: string | null;
}

const NOTHING: BookingFields = {
  bookingNo: null,
  priceExVat: null,
  vat: null,
  discount: null,
  total: null,
};

/** Enough for an invoice's digits at 1600px; well below the API's 5 MB image cap. */
const JPEG_QUALITY = 0.85;

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(file.name);
}

/**
 * What to post. **Only images are downscaled.**
 *
 * A booking confirmation is a PDF more often than a photo, and re-encoding one
 * through a canvas would throw away every page but the first — the route
 * rasterises them server-side for exactly that reason. A workbook is not an
 * image at all. For a photo the downscale is a cost control (image tokens scale
 * with area, the call is billed) and it is also what turns a phone's HEIC into
 * a media type the API accepts.
 *
 * Null means the browser could not decode an image it was handed.
 */
async function toUploadBlob(file: File): Promise<{ blob: Blob; name: string } | null> {
  if (!isImageFile(file)) return { blob: file, name: file.name };
  const canvas = await toDownscaledCanvas(file);
  if (!canvas) return null;
  const blob = await canvasToJpeg(canvas);
  return blob ? { blob, name: "booking.jpg" } : null;
}

export async function readBookingFields(
  file: File,
  options?: BookingFieldsReadOptions,
): Promise<BookingFieldsRead> {
  // A file the browser cannot decode yields nothing for the same reason a blank
  // page does — from where the booking desk sits it is this file, and the
  // remedy is to type the figures. Reported as `not-found` rather than
  // inventing another line of copy for it.
  const upload = await toUploadBlob(file);
  if (!upload) return { fields: NOTHING, currency: null, failure: "not-found" };

  const form = new FormData();
  form.append("file", upload.blob, upload.name);

  // A query parameter rather than a form field, so the route can read it before
  // it reads the body — which is what lets the rate limit run before the brand
  // lookup does any database work.
  const params = new URLSearchParams();
  const brandCode = (options?.brandCode ?? "").trim();
  const countryCode = (options?.countryCode ?? "").trim();
  if (brandCode) params.set("brandCode", brandCode);
  if (countryCode) params.set("countryCode", countryCode);
  const qs = params.toString();
  const url = "/api/request/travel-booking/booking-fields" + (qs ? `?${qs}` : "");

  try {
    const res = await fetch(url, { method: "POST", body: form });
    const json = await res.json().catch(() => null);
    if (!json?.ok) {
      // 503 is `statusForVisionError`'s "only an operator can fix this" — a
      // missing or revoked key. Telling the desk to try again would be advice
      // that can never work.
      return {
        fields: NOTHING,
        currency: null,
        failure: res.status === 503 ? "unavailable" : "error",
      };
    }

    // Re-narrowed rather than trusted: this is a network boundary. The server
    // already ran `sanitizeBookingNo` / `sanitizeBookingAmount`; this only
    // refuses a malformed *envelope*.
    const d = (json.data ?? {}) as Record<string, unknown>;
    const fields: BookingFields = {
      bookingNo: typeof d.bookingNo === "string" ? d.bookingNo : null,
      priceExVat: typeof d.priceExVat === "number" ? d.priceExVat : null,
      vat: typeof d.vat === "number" ? d.vat : null,
      discount: typeof d.discount === "number" ? d.discount : null,
      total: typeof d.total === "number" ? d.total : null,
    };
    const currency = typeof d.currency === "string" ? d.currency : null;

    const anyAmount =
      fields.priceExVat !== null ||
      fields.vat !== null ||
      fields.discount !== null ||
      fields.total !== null;
    // Real figures in a currency this request does not record are not this
    // request's figures. Skipped where the currency is not known here — see
    // `claimCurrency`. **The booking number goes with them**: the caller
    // applies nothing on a failure, and a five-field answer whose four money
    // fields are wrong is not one to half-apply.
    const claimCurrency = options?.claimCurrency;
    if (anyAmount && claimCurrency != null && !sameCurrency(currency, claimCurrency)) {
      return { fields: NOTHING, currency, failure: "currency-mismatch" };
    }

    const anything = fields.bookingNo !== null || anyAmount;
    // "The call worked and this document said nothing we could use" is a
    // different thing to tell somebody than "we could not ask", so it gets its
    // own reason even though the fields are identical.
    return anything
      ? { fields, currency }
      : { fields: NOTHING, currency: null, failure: "not-found" };
  } catch {
    // Offline, DNS, a proxy eating the request.
    return { fields: NOTHING, currency: null, failure: "error" };
  }
}
