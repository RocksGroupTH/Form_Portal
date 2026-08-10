/**
 * Client-side OCR heuristic that an uploaded image looks like a Thai national ID card.
 * Runs tesseract.js (tha+eng) in the browser and looks for either a 13-digit ID number
 * (allowing the usual space/dash grouping) or a Thai ID keyword. tesseract.js is loaded
 * lazily so it never touches the initial bundle.
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("ocr timeout")), ms))]);
}

/** Draw a decoded image source (bitmap or <img>) onto a downscaled canvas for fast OCR. */
function drawToCanvas(src: ImageBitmap | HTMLImageElement, srcW: number, srcH: number): HTMLCanvasElement | null {
  const MAXW = 1600;
  const scale = srcW > MAXW ? MAXW / srcW : 1;
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, w, h);
  return canvas;
}

/** Decode via <img> + object URL — handles some JPEGs that createImageBitmap rejects. */
function decodeViaImgElement(file: File): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = drawToCanvas(img, img.naturalWidth, img.naturalHeight);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

/**
 * Decode an uploaded image to a canvas the browser can render, so tesseract never has to
 * parse the raw file itself (its loader throws "Error attempting to read image" on formats
 * the browser handles fine — camera JPEGs with odd metadata, EXIF-rotated photos, etc.).
 * Tries createImageBitmap first, then an <img> element. Downscales oversized photos to keep
 * OCR fast. Returns null only if the browser genuinely cannot decode the file.
 */
async function toOcrCanvas(file: File): Promise<HTMLCanvasElement | null> {
  if (typeof document === "undefined") return null;
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      const canvas = drawToCanvas(bitmap, bitmap.width, bitmap.height);
      bitmap.close();
      if (canvas) return canvas;
    } catch {
      /* fall through to <img> decode */
    }
  }
  return decodeViaImgElement(file);
}

export async function looksLikeThaiIdCard(file: File): Promise<{ ok: boolean; reason?: string }> {
  // Decode with the browser first. If it can't, DON'T hand the raw File to tesseract — its
  // worker throws an uncaught "Error attempting to read image"; return a clean result instead.
  const canvas = await toOcrCanvas(file);
  if (!canvas) {
    return { ok: false, reason: "อ่านไฟล์รูปไม่สำเร็จ กรุณาถ่ายหรือเลือกรูปใหม่เป็นไฟล์ JPG หรือ PNG" };
  }

  const { recognize } = await import("tesseract.js");
  // Cap the whole OCR (worker + lang-data download + recognize) so it never hangs.
  const { data } = await withTimeout(recognize(canvas, "tha+eng"), 45000);
  const text = data.text ?? "";

  // 13 digits, optionally separated by single spaces/dashes (X XXXX XXXXX XX X).
  const has13 = /\d(?:[ \-.]?\d){12}/.test(text);
  const hasKeyword = /ประชาชน|บัตรประจำตัว|identification|thai\s*national/i.test(text);

  if (has13 || hasKeyword) return { ok: true };
  return { ok: false, reason: "ไม่พบเลขบัตร 13 หลัก หรือข้อความ “บัตรประชาชน” ในรูป" };
}
