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
 * line of copy cannot serve all three cases honestly. "ไม่สำเร็จ" reads as
 * "your receipt is no good" even when the fault is a revoked key on our side,
 * which is exactly what happened to AP-17's ID-card dialog on 2026-08-24.
 *
 * ── The currency is an answer, not a filter ──
 *
 * The read used to be told which currency the line was in and to **withhold**
 * the amount when the document disagreed (`currency-mismatch`). That was right
 * while a read could not change the line: prefilling a ringgit total into a
 * field the line called baht would have converted it as baht. It is the wrong
 * shape now, because the read fills the currency in too — a MYR receipt on a
 * line still reading THB sets the line to MYR rather than refusing.
 *
 * And when the document's currency **cannot be told**, the amount is still
 * handed back, with `currency: null`. That is the requested behaviour and it is
 * a legitimate outcome rather than a failure: the figure was legible, the
 * currency was not, so the requester states it. Nothing is converted and no
 * baht is claimed until they do.
 */
import { toDownscaledCanvas } from "@/lib/image/downscale";

export type ReceiptFailure =
  /** The call worked; this image has no total we can trust. */
  | "not-found"
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
  unavailable: "ระบบอ่านใบเสร็จยังไม่พร้อมใช้งาน — กรอกจำนวนเงินเองได้เลย",
  error: "อ่านใบเสร็จไม่ได้ตอนนี้ — กรอกจำนวนเงินเองได้เลย",
};

export interface ReceiptRead {
  amount: number | null;
  /**
   * The currency `amount` is in, as the **server** decided it — never as the
   * caller suggested.
   *
   * **Null beside a real amount is the expected blank case**, not an absence of
   * data: the document was legible and its currency was not. The caller leaves
   * the line's currency unset and makes the requester choose. It is also null
   * whenever nothing was admitted at all.
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
   *
   * The brand is deliberately wider than one line's two options — it is what
   * the model is allowed to *say*. Narrowing that answer to what this
   * particular line may be in is `resolveLineCurrency`'s job at the caller,
   * because only the caller knows which country the trip was to.
   */
  brandCode?: string | null;
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

    // A null `currency` here is the blank case and travels as it is — the
    // caller leaves the line unpriced and asks. Nothing is guessed, and in
    // particular nothing falls back to baht: that is the exact defect this read
    // carried before it asked which currency the document was in.
    return { amount, currency };
  } catch {
    // Offline, DNS, a proxy eating the request.
    return { amount: null, currency: null, failure: "error" };
  }
}
