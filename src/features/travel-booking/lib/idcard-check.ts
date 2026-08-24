/**
 * Client half of AP-17's ID-card check: downscale the picked image and ask
 * `/api/request/travel-booking/id-card-check` whether it is a Thai national ID
 * card.
 *
 * Replaced `idcard-ocr.ts`, which ran tesseract in the browser and passed
 * anything carrying 13 digits — the length of a Thai **tax id** as well as a
 * national ID number, so ใบกำกับภาษี verified as a card. See the route for the
 * full account.
 *
 * **Nothing is attached without a verdict of `true`.** Decided 2026-08-24, with
 * the cost stated and accepted: the ID card is required to submit, so while
 * this check cannot run, AP-17 cannot be filed. Failing open was built first
 * and rejected — a card image nobody verified is exactly what the old
 * heuristic produced, and the point of the rebuild was to stop that.
 *
 * `ok: false` covers both "this is not a card" and "no verdict could be
 * obtained", and `reason` is always set to something the requester can act on:
 * the two cases refuse the file identically, but *waiting* and *attaching a
 * different photo* are different remedies and the copy has to say which.
 * `unavailable` marks the second case for callers that want to tell them apart.
 */
import { toDownscaledCanvas } from "@/lib/image/downscale";

const JPEG_QUALITY = 0.9;

export interface IdCardCheck {
  ok: boolean;
  /** Always set when `ok` is false — shown to the requester as-is. */
  reason?: string;
  /** True when the check could not run at all — not a verdict about the image. */
  unavailable?: boolean;
}

const CANNOT_DECODE =
  "อ่านไฟล์รูปไม่สำเร็จ กรุณาถ่ายหรือเลือกรูปใหม่เป็นไฟล์ JPG หรือ PNG";

/**
 * Why no verdict came back, worded as the next thing to do. The status matters
 * now that a failure blocks the attachment: "wait a moment" and "tell IT" are
 * not interchangeable advice.
 */
function unavailableReason(status: number): string {
  if (status === 429) return "ตรวจรูปบัตรถี่เกินไป กรุณารอสักครู่แล้วลองใหม่";
  if (status === 503) return "ระบบตรวจรูปบัตรยังไม่พร้อมใช้งาน — กรุณาแจ้งฝ่าย IT";
  return "ตรวจสอบรูปบัตรไม่สำเร็จ กรุณาลองใหม่อีกครั้ง — ถ้ายังไม่ได้ กรุณาแจ้งฝ่าย IT";
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
}

export async function looksLikeThaiIdCard(file: File): Promise<IdCardCheck> {
  // A file the browser cannot decode is a genuine "no", not an outage: nothing
  // downstream could have used it either.
  const canvas = await toDownscaledCanvas(file);
  if (!canvas) return { ok: false, reason: CANNOT_DECODE };

  const blob = await canvasToJpeg(canvas);
  if (!blob) return { ok: false, reason: CANNOT_DECODE };

  const form = new FormData();
  form.append("file", blob, "idcard.jpg");

  try {
    const res = await fetch("/api/request/travel-booking/id-card-check", {
      method: "POST",
      body: form,
    });
    const json = await res.json().catch(() => null);
    if (!json?.ok) {
      return { ok: false, unavailable: true, reason: unavailableReason(res.status) };
    }

    return json.data?.isIdCard === true
      ? { ok: true }
      : { ok: false, reason: json.data?.reason ?? "รูปนี้ไม่ใช่บัตรประจำตัวประชาชน" };
  } catch {
    // Offline, DNS, a proxy eating the request — no status to reason from.
    return { ok: false, unavailable: true, reason: unavailableReason(0) };
  }
}
