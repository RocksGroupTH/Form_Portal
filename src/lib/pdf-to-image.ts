import "server-only";
import { countPdfPageObjects } from "./pdf-page-count";

/**
 * Render the first page of a PDF to a PNG buffer so it can be fed to the
 * image-only OCR pipeline (Tesseract). Pure JS/WASM — pdfjs-dist (Apache-2.0)
 * rasterised via @napi-rs/canvas (MIT); no system binaries required.
 */
export async function pdfFirstPageToPng(buffer: Buffer, scale = 2): Promise<Buffer> {
  const { pdf } = await import("pdf-to-img");
  const doc = await pdf(buffer, { scale });
  for await (const page of doc) {
    return page; // first page as a PNG Buffer
  }
  throw new Error("PDF has no pages");
}

/**
 * The first `maxPages` pages as PNG buffers.
 *
 * AP-4 reads whole documents rather than single receipts — a Thai quotation or
 * tax invoice routinely runs to two pages — so one page is not enough, and
 * every page is not affordable: the vision call is billed per image, so an
 * unbounded loop turns one careless upload of a 40-page statement into 40
 * images. The cap is the caller's, with no default here, so the number lives
 * next to the code that knows what it is paying for.
 *
 * Returns at least one page or throws, matching `pdfFirstPageToPng`.
 *
 * It also throws when it rendered fewer pages than the document has. That used
 * to pass silently and is the worst failure this function can have: a nine-page
 * bundle came back as one page, the caller reported `pagesRead: 1`, and one row
 * out of one page reads as a complete read of a short file. Eight receipts
 * vanished with nothing anywhere saying so (2026-09-11). A partial rasterise is
 * a failed read, not a small result — every caller here already turns a throw
 * into an error the user sees, and a retry is cheap.
 */
export async function pdfPagesToPng(
  buffer: Buffer,
  maxPages: number,
  scale = 2,
): Promise<Buffer[]> {
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new Error("maxPages must be a positive integer");
  }
  const { pdf } = await import("pdf-to-img");
  const doc = await pdf(buffer, { scale });
  const pages: Buffer[] = [];
  for await (const page of doc) {
    pages.push(page);
    if (pages.length >= maxPages) break;
  }
  if (pages.length === 0) throw new Error("PDF has no pages");
  // What the document holds, against what came out of the loop. The cap is a
  // deliberate stop and not a shortfall, so it is the ceiling here.
  //
  // `doc.length` is not trusted on its own: on 2026-09-11 a nine-page file that
  // a plain Node process reads as nine came back through this same library
  // inside the Next server as one page AND `length: 1`, on byte-identical input
  // (SHA-256 checked). A loader that fails to walk the page tree understates
  // both numbers together, so the two agreeing proves nothing. The raw count
  // below is read off the bytes and cannot be talked down by the loader.
  const total = Math.max(
    typeof doc.length === "number" ? doc.length : 0,
    countPdfPageObjects(buffer),
    pages.length,
  );
  const expected = Math.min(total, maxPages);
  if (pages.length < expected) {
    throw new Error(`อ่าน PDF ได้ไม่ครบ — ได้ ${pages.length} จาก ${expected} หน้า กรุณาลองใหม่อีกครั้ง`);
  }
  return pages;
}

/** True when an uploaded file is a PDF (by MIME or extension). */
export function isPdfFile(file: { type?: string; name?: string }): boolean {
  return file.type === "application/pdf" || (file.name?.toLowerCase().endsWith(".pdf") ?? false);
}
