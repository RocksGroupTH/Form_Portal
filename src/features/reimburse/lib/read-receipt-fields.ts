/**
 * Client half of the AP-4 document read: post one attached file to
 * `/api/request/reimburse/receipt-item` and hand back the expense rows the
 * server decided on.
 *
 * The failure vocabulary mirrors AP-1's `read-receipt-amount.ts`, because the
 * two are the same operation. Three things differ, all of them because AP-4
 * reads whole documents rather than a figure off a photo:
 *
 * - **rows, plural.** A photo or a PDF yields at most one; a workbook yields
 *   one per line, because the AP-4.1 sheet is a table.
 * - **only images are downscaled.** A PDF and a workbook are posted as they
 *   are — re-encoding a PDF through a canvas would throw away the pages the
 *   server rasterises, and a workbook is not an image at all.
 * - **its own endpoint and rate-limit bucket.** See the route for why.
 *
 * Never throws. Every failure comes back with no rows **and a reason**, because
 * one line of copy cannot serve all three cases honestly — "ไม่สำเร็จ" reads as
 * "your document is no good" even when the fault is a revoked key on our side.
 */
import { toDownscaledCanvas } from "@/lib/image/downscale";
import type { ReceiptFields } from "./receipt-fields";

/** A read row: the sanitized document fields, plus the account the server matched. */
export interface ReadRow extends ReceiptFields {
  /**
   * `ErpAccounts.AccountNo`, or null.
   *
   * Only ever one the **server** matched against its own candidate list — a
   * model asked to pick from a list can still answer with a number that is not
   * on it, and an invented G/L account is a misposted expense.
   */
  accountNo: string | null;
}

export type ReceiptFieldsFailure =
  /** The call worked; nothing on this document could be trusted. */
  | "not-found"
  /** Our side is not configured — a missing or revoked key (503). */
  | "unavailable"
  /** Upstream trouble or no network. Retrying later might work. */
  | "error";

/**
 * A `Record`, not a lookup with a default: adding a failure kind without copy
 * for it becomes a compile error rather than a blank note on the form.
 */
export const RECEIPT_FIELDS_FAILURE_TEXT: Record<ReceiptFieldsFailure, string> = {
  "not-found": "อ่านข้อมูลจากไฟล์นี้ไม่ได้ — กรอกเองได้เลย",
  unavailable: "ระบบอ่านเอกสารยังไม่พร้อมใช้งาน — กรอกเองได้เลย",
  error: "อ่านเอกสารไม่ได้ตอนนี้ — กรอกเองได้เลย",
};

export interface ReceiptFieldsRead {
  /** One entry per expense line found. Empty when `failure` is set. */
  rows: ReadRow[];
  /** Always set when no row came back. */
  failure?: ReceiptFieldsFailure;
}

/** Enough for a receipt's digits at 1600px; well below the API's 5 MB image cap. */
const JPEG_QUALITY = 0.85;

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(file.name);
}

/**
 * Images only.
 *
 * **The downscale is not cosmetic.** A phone photo is several megapixels; image
 * tokens scale with area, and the call is billed. `toDownscaledCanvas` caps the
 * long edge at 1600px and handles the decodes a raw `File` fails on
 * (EXIF-rotated camera JPEGs, HEIC the browser renders but the API refuses).
 * Re-encoding as JPEG is also what guarantees a media type the route accepts,
 * whatever the phone produced.
 *
 * Returns null when the browser cannot decode the file — reported as
 * `not-found`, because from where the requester sits it is this image and the
 * remedy is to type the row.
 */
async function toUploadBlob(file: File): Promise<{ blob: Blob; name: string } | null> {
  if (!isImageFile(file)) return { blob: file, name: file.name };
  const canvas = await toDownscaledCanvas(file);
  if (!canvas) return null;
  const blob = await canvasToJpeg(canvas);
  return blob ? { blob, name: "receipt.jpg" } : null;
}

export async function readReceiptFields(
  file: File,
  /** The claim's brand — decides which accounts are offered as suggestions. */
  brandCode?: string | null,
): Promise<ReceiptFieldsRead> {
  const upload = await toUploadBlob(file);
  if (!upload) return { rows: [], failure: "not-found" };

  const form = new FormData();
  form.append("file", upload.blob, upload.name);

  try {
    // The brand rides in the query string, not the body: `guardVisionRequest`
    // consumes the body with its own `formData()`, and a request body can only
    // be read once.
    const qs = brandCode ? `?brand=${encodeURIComponent(brandCode)}` : "";
    const res = await fetch(`/api/request/reimburse/receipt-item${qs}`, {
      method: "POST",
      body: form,
    });
    const json = await res.json().catch(() => null);
    if (!json?.ok) {
      // 503 is `statusForVisionError`'s "only an operator can fix this" — a
      // missing or revoked key. Telling the requester to try again would be
      // advice that can never work.
      return { rows: [], failure: res.status === 503 ? "unavailable" : "error" };
    }

    // Re-narrowed rather than trusted: this is a network boundary, and these
    // values land in rows that decide a payout. The server already ran
    // `sanitizeReceiptFields`; this only refuses a malformed *envelope*.
    const raw: unknown = json.data?.rows;
    const rows: ReadRow[] = Array.isArray(raw)
      ? raw.map((d: Record<string, unknown>) => ({
          expenseDate: typeof d?.expenseDate === "string" ? d.expenseDate : null,
          description: typeof d?.description === "string" ? d.description : null,
          amount: typeof d?.amount === "number" ? d.amount : null,
          vat: typeof d?.vat === "number" ? d.vat : null,
          withholdingTax: typeof d?.withholdingTax === "number" ? d.withholdingTax : null,
          documentNo: typeof d?.documentNo === "string" ? d.documentNo : null,
          branchName: typeof d?.branchName === "string" ? d.branchName : null,
          vendorTaxId: typeof d?.vendorTaxId === "string" ? d.vendorTaxId : null,
          vendorName: typeof d?.vendorName === "string" ? d.vendorName : null,
          vendorAddress: typeof d?.vendorAddress === "string" ? d.vendorAddress : null,
          // Only ever an account the server matched against its own candidate
          // list; anything else already came back null.
          accountNo: typeof d?.accountNo === "string" ? d.accountNo : null,
        }))
      : [];

    return rows.length > 0 ? { rows } : { rows, failure: "not-found" };
  } catch {
    // Offline, DNS, a proxy eating the request.
    return { rows: [], failure: "error" };
  }
}
