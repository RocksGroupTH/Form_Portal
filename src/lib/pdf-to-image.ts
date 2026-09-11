import "server-only";

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
  return pages;
}

/** True when an uploaded file is a PDF (by MIME or extension). */
export function isPdfFile(file: { type?: string; name?: string }): boolean {
  return file.type === "application/pdf" || (file.name?.toLowerCase().endsWith(".pdf") ?? false);
}
