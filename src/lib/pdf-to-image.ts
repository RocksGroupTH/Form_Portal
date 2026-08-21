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

/** True when an uploaded file is a PDF (by MIME or extension). */
export function isPdfFile(file: { type?: string; name?: string }): boolean {
  return file.type === "application/pdf" || (file.name?.toLowerCase().endsWith(".pdf") ?? false);
}
