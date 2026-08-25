/**
 * Client half of the AP-4 row read: downscale the attached photo, post it to
 * `/api/request/reimburse/receipt-item`, and hand back the fields the server
 * decided on — each of them possibly null.
 *
 * The shape deliberately mirrors AP-1's `read-receipt-amount.ts`, including
 * the failure vocabulary, because the two are the same operation on different
 * schemas. What is **not** shared is the endpoint or the rate-limit bucket: see
 * the route for why those stay separate.
 *
 * **The downscale is not cosmetic.** A phone photo is several megapixels; image
 * tokens scale with area, and the call is billed. `toDownscaledCanvas` caps the
 * long edge at 1600px and handles the decodes a raw `File` fails on
 * (EXIF-rotated camera JPEGs, HEIC the browser renders but the API refuses).
 * Re-encoding as JPEG is also what guarantees a media type the route accepts,
 * whatever the phone produced.
 *
 * Never throws. Every failure comes back with all fields null **and a reason**,
 * because one line of copy cannot serve all three cases honestly — "ไม่สำเร็จ"
 * reads as "your receipt is no good" even when the fault is a revoked key on
 * our side.
 */
import { toDownscaledCanvas } from "@/lib/image/downscale";
import type { ReceiptFields } from "./receipt-fields";

export type ReceiptFieldsFailure =
  /** The call worked; nothing on this image could be trusted. */
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
  "not-found": "อ่านข้อมูลจากรูปนี้ไม่ได้ — กรอกเองได้เลย",
  unavailable: "ระบบอ่านใบเสร็จยังไม่พร้อมใช้งาน — กรอกเองได้เลย",
  error: "อ่านใบเสร็จไม่ได้ตอนนี้ — กรอกเองได้เลย",
};

export interface ReceiptFieldsRead {
  fields: ReceiptFields;
  /** Always set when nothing usable came back. */
  failure?: ReceiptFieldsFailure;
}

const EMPTY: ReceiptFields = {
  expenseDate: null,
  description: null,
  amount: null,
  vat: null,
  withholdingTax: null,
  documentNo: null,
  branchName: null,
};

/** Enough for a receipt's digits at 1600px; well below the API's 5 MB image cap. */
const JPEG_QUALITY = 0.85;

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
}

/** True when the server found nothing at all — used to pick the "not-found" note. */
function isEmpty(f: ReceiptFields): boolean {
  return (
    f.expenseDate === null &&
    f.description === null &&
    f.amount === null &&
    f.vat === null &&
    f.withholdingTax === null &&
    f.documentNo === null &&
    f.branchName === null
  );
}

export async function readReceiptFields(file: File): Promise<ReceiptFieldsRead> {
  // A file the browser cannot decode yields nothing for the same reason a
  // blank receipt does — from where the requester sits it is this image, and
  // the remedy is to type the row. Reported as `not-found` rather than
  // inventing a fourth line of copy for it.
  const canvas = await toDownscaledCanvas(file);
  if (!canvas) return { fields: EMPTY, failure: "not-found" };

  const blob = await canvasToJpeg(canvas);
  if (!blob) return { fields: EMPTY, failure: "not-found" };

  const form = new FormData();
  form.append("file", blob, "receipt.jpg");

  try {
    const res = await fetch("/api/request/reimburse/receipt-item", {
      method: "POST",
      body: form,
    });
    const json = await res.json().catch(() => null);
    if (!json?.ok) {
      // 503 is `statusForVisionError`'s "only an operator can fix this" — a
      // missing or revoked key. Telling the requester to try again would be
      // advice that can never work.
      return { fields: EMPTY, failure: res.status === 503 ? "unavailable" : "error" };
    }

    // Re-narrowed here rather than trusted: this is a network boundary, and
    // the row these values land in decides a payout. The server already ran
    // `sanitizeReceiptFields`; this only refuses a malformed *envelope*.
    const d = json.data ?? {};
    const fields: ReceiptFields = {
      expenseDate: typeof d.expenseDate === "string" ? d.expenseDate : null,
      description: typeof d.description === "string" ? d.description : null,
      amount: typeof d.amount === "number" ? d.amount : null,
      vat: typeof d.vat === "number" ? d.vat : null,
      withholdingTax: typeof d.withholdingTax === "number" ? d.withholdingTax : null,
      documentNo: typeof d.documentNo === "string" ? d.documentNo : null,
      branchName: typeof d.branchName === "string" ? d.branchName : null,
    };
    return isEmpty(fields) ? { fields, failure: "not-found" } : { fields };
  } catch {
    // Offline, DNS, a proxy eating the request.
    return { fields: EMPTY, failure: "error" };
  }
}
