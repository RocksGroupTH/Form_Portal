/**
 * Client half of the AP-1 receipt read: downscale the attached photo, post it
 * to `/api/request/accounting/receipt-amount`, and hand back the amount the
 * server decided on — or null.
 *
 * **The downscale is not cosmetic.** A phone photo is several megapixels; image
 * tokens scale with area, and the request is billed per call. `toDownscaledCanvas`
 * already caps the long edge at 1600px and handles the decodes a raw `File`
 * fails on (EXIF-rotated camera JPEGs, HEIC the browser can render but the API
 * will not accept). Re-encoding the canvas as JPEG is also what guarantees the
 * media type the route requires, whatever the phone produced.
 *
 * Never throws. Every failure comes back as `amount: null` and the caller shows
 * an empty, editable field — but it also comes back **saying why**, because one
 * line of copy cannot serve all four cases honestly. "ไม่สำเร็จ" reads as
 * "your receipt is no good" even when the fault is a revoked key on our side,
 * which is exactly what happened to AP-17's ID-card dialog on 2026-08-24.
 */
import { sameCurrency } from "@/lib/acc/currency";
import { toDownscaledCanvas } from "@/lib/image/downscale";

export type ReceiptFailure =
  /** The call worked; this image has no total we can trust. */
  | "not-found"
  /**
   * The figure is real, and it is in a different currency from the claim.
   *
   * Prefilling it would put a ringgit total into a baht field and total it as
   * baht — the defect this read carried until it asked which currency the
   * document was in. Converting instead is not the alternative: a claim's rows
   * are held in the claim's own currency and converted once, on the header.
   */
  | "currency-mismatch"
  /** Our side is not configured — a missing or revoked key (503). */
  | "unavailable"
  /** Upstream trouble or no network. Retrying later might work. */
  | "error";

/**
 * A `Record`, not a lookup with a default: adding a failure kind without copy
 * for it becomes a compile error rather than a blank note on the form.
 */
export const RECEIPT_FAILURE_TEXT: Record<ReceiptFailure, string> = {
  "not-found": "อ่านยอดจากรูปนี้ไม่เจอ — กรอกจำนวนเงินเองได้เลย",
  "currency-mismatch": "ใบเสร็จนี้เป็นคนละสกุลเงินกับคำขอ — กรอกจำนวนเงินเองได้เลย",
  unavailable: "ระบบอ่านใบเสร็จยังไม่พร้อมใช้งาน — กรอกจำนวนเงินเองได้เลย",
  error: "อ่านใบเสร็จไม่ได้ตอนนี้ — กรอกจำนวนเงินเองได้เลย",
};

export interface ReceiptRead {
  amount: number | null;
  /**
   * The currency `amount` is in, as the **server** decided it — never as the
   * caller suggested. Null when nothing was admitted.
   */
  currency: string | null;
  /** Always set when `amount` is null. */
  failure?: ReceiptFailure;
}

export interface ReceiptReadOptions {
  /**
   * The claim's brand. Sent as `?brandCode=`, and the route resolves what that
   * brand may claim in **server-side** — a currency posted from here would let
   * a hand-shaped request have one accepted that the brand does not offer.
   *
   * Without it the route sees no brand, admits baht alone, and every foreign
   * receipt silently stays baht: the whole defect. `ExpenseRows` therefore
   * carries a `brandCode` prop for no other purpose.
   */
  brandCode?: string | null;
  /**
   * The currency the claim is being entered in. Null or absent means **not
   * known here**, and the mismatch check is skipped rather than assuming baht —
   * AP-17's panel has a real window where its brand is still unidentified.
   * AP-1's form always knows, and passes `THB` rather than nothing.
   */
  claimCurrency?: string | null;
}

/** Enough for a receipt's digits at 1600px; well below the API's 5 MB image cap. */
const JPEG_QUALITY = 0.85;

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
}

/** Images are re-encoded; a PDF or a workbook is posted as it is. */
function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || /.(png|jpe?g|gif|webp|heic|heif)$/i.test(file.name);
}

/**
 * What to post.
 *
 * **Only images are downscaled.** Re-encoding a PDF through a canvas would
 * throw away every page but the first, and the route rasterises them server-side
 * for exactly that reason; a workbook is not an image at all. For a photo the
 * downscale is a cost control — image tokens scale with area and the call is
 * billed — and it is also what turns a phone's HEIC into a media type the API
 * accepts. AP-4's `read-receipt-fields.ts` splits on the same line.
 *
 * Null means the browser could not decode an image it was handed.
 */
async function toUploadBlob(file: File): Promise<{ blob: Blob; name: string } | null> {
  if (!isImageFile(file)) return { blob: file, name: file.name };
  const canvas = await toDownscaledCanvas(file);
  if (!canvas) return null;
  const blob = await canvasToJpeg(canvas);
  return blob ? { blob, name: "receipt.jpg" } : null;
}

export async function readReceiptAmount(
  file: File,
  options?: ReceiptReadOptions,
): Promise<ReceiptRead> {
  // A file the browser cannot decode yields no amount for the same reason a
  // blank receipt does — from where the requester sits it is this file, and the
  // remedy is to type the figure. Reported as `not-found` rather than inventing
  // another line of copy for it.
  const upload = await toUploadBlob(file);
  if (!upload) return { amount: null, currency: null, failure: "not-found" };

  const form = new FormData();
  form.append("file", upload.blob, upload.name);

  // A query parameter rather than a form field, so the route can read it before
  // it reads the body — which is what lets the rate limit run before the brand
  // lookup does any database work.
  const brandCode = (options?.brandCode ?? "").trim();
  const url =
    "/api/request/accounting/receipt-amount" +
    (brandCode ? `?brandCode=${encodeURIComponent(brandCode)}` : "");

  try {
    const res = await fetch(url, { method: "POST", body: form });
    const json = await res.json().catch(() => null);
    if (!json?.ok) {
      // 503 is `statusForVisionError`'s "only an operator can fix this" — a
      // missing or revoked key. Telling the requester to try again would be
      // advice that can never work.
      return {
        amount: null,
        currency: null,
        failure: res.status === 503 ? "unavailable" : "error",
      };
    }

    const amount = json.data?.amount;
    const currency = typeof json.data?.currency === "string" ? json.data.currency : null;
    if (typeof amount !== "number") return { amount: null, currency: null, failure: "not-found" };

    // The figure is real but belongs to another currency, so it is not this
    // claim's figure. Skipped where the claim's currency is not known here —
    // see `claimCurrency`.
    const claimCurrency = options?.claimCurrency;
    if (claimCurrency != null && !sameCurrency(currency, claimCurrency)) {
      return { amount: null, currency, failure: "currency-mismatch" };
    }
    return { amount, currency };
  } catch {
    // Offline, DNS, a proxy eating the request.
    return { amount: null, currency: null, failure: "error" };
  }
}
