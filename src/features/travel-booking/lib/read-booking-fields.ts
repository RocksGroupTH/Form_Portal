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
  unavailable: "ระบบอ่านเอกสารยังไม่พร้อมใช้งาน — กรอกเองได้เลย",
  error: "อ่านเอกสารไม่ได้ตอนนี้ — กรอกเองได้เลย",
};

export interface BookingFieldsRead {
  /** Every field null when `failure` is set. */
  fields: BookingFields;
  /** Set whenever nothing usable came back. */
  failure?: BookingFieldsFailure;
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

export async function readBookingFields(file: File): Promise<BookingFieldsRead> {
  // A file the browser cannot decode yields nothing for the same reason a blank
  // page does — from where the booking desk sits it is this file, and the
  // remedy is to type the figures. Reported as `not-found` rather than
  // inventing a fourth line of copy for it.
  const upload = await toUploadBlob(file);
  if (!upload) return { fields: NOTHING, failure: "not-found" };

  const form = new FormData();
  form.append("file", upload.blob, upload.name);

  try {
    const res = await fetch("/api/request/travel-booking/booking-fields", {
      method: "POST",
      body: form,
    });
    const json = await res.json().catch(() => null);
    if (!json?.ok) {
      // 503 is `statusForVisionError`'s "only an operator can fix this" — a
      // missing or revoked key. Telling the desk to try again would be advice
      // that can never work.
      return { fields: NOTHING, failure: res.status === 503 ? "unavailable" : "error" };
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

    const anything =
      fields.bookingNo !== null ||
      fields.priceExVat !== null ||
      fields.vat !== null ||
      fields.discount !== null ||
      fields.total !== null;
    // "The call worked and this document said nothing we could use" is a
    // different thing to tell somebody than "we could not ask", so it gets its
    // own reason even though the fields are identical.
    return anything ? { fields } : { fields: NOTHING, failure: "not-found" };
  } catch {
    // Offline, DNS, a proxy eating the request.
    return { fields: NOTHING, failure: "error" };
  }
}
