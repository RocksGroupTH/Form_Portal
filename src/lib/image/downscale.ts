/**
 * Decode an uploaded image in the browser and draw it onto a size-capped
 * canvas. Both image reads in this app go through here before posting: AP-1's
 * receipt amount and AP-17's ID-card check.
 *
 * It earns its place twice over. The decode dance below is genuinely fiddly and
 * there should be one copy of it. And the cap is not cosmetic — a phone photo
 * is several megapixels, image tokens scale with area, and both callers are
 * billed per request.
 *
 * Was `src/lib/ocr/image-text.ts`, which also ran tesseract. Nothing in this
 * app OCRs in the browser any more (2026-08-24), so the OCR half and the
 * tesseract.js dependency are gone and the module is named for what is left.
 */

/** Long-edge cap. Large enough for a receipt's digits and a card's face. */
const MAX_WIDTH = 1600;

function drawToCanvas(
  src: ImageBitmap | HTMLImageElement,
  srcW: number,
  srcH: number,
): HTMLCanvasElement | null {
  const scale = srcW > MAX_WIDTH ? MAX_WIDTH / srcW : 1;
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
 * Tries createImageBitmap first, then an `<img>` element — camera JPEGs with odd
 * metadata and EXIF-rotated photos fail the first and pass the second. Re-encoding
 * whatever comes back is also what turns a phone's HEIC into a media type the
 * Messages API accepts. Returns null only if the browser genuinely cannot decode
 * the file, which callers treat as a real answer rather than an outage.
 */
export async function toDownscaledCanvas(file: File): Promise<HTMLCanvasElement | null> {
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
