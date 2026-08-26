/**
 * Turning an uploaded document into something the Messages API can read.
 *
 * Shared by AP-4's document read (`/api/request/reimburse/receipt-item`, which
 * wants a row per line) and AP-1's amount read
 * (`/api/request/accounting/receipt-amount`, which wants one total). The two ask
 * very different questions of the answer, but they turn the *file* into content
 * the same way, and that half is what lives here — a second copy would drift on
 * the bounds, which are cost controls rather than preferences.
 */
import { loadXlsx } from "@/lib/xlsx";

/**
 * How many pages of a PDF are rasterised and sent.
 *
 * Image tokens scale with area and the call is billed, so this is a cost
 * control. Three covers a receipt, an invoice and a short quotation; a longer
 * document loses its tail rather than the request being refused, because a
 * partial read still beats making somebody type the figure.
 */
export const MAX_PDF_PAGES = 3;

/** Bound on the text extracted from a workbook, for the same reason. */
export const MAX_SHEET_CHARS = 40_000;

/**
 * The workbook's first sheet as tab-separated text, bounded, or null when there
 * is nothing legible in it.
 *
 * Null is not an error: the requester still gets their row and their file is
 * still kept as evidence. Only the prefill is lost.
 */
export async function sheetToText(bytes: Buffer): Promise<string | null> {
  // `loadXlsx`, not a bare dynamic import: the package is CommonJS and its API
  // lands on `.default` under some loaders while the types advertise the named
  // exports either way, so `XLSX.read(...)` type-checks, builds, and throws.
  const XLSX = await loadXlsx();
  const wb = XLSX.read(bytes, { type: "buffer" });
  const first = wb.SheetNames[0];
  if (!first) return null;
  const text = XLSX.utils.sheet_to_csv(wb.Sheets[first], { FS: "\t", blankrows: false });
  const trimmed = text.trim();
  return trimmed ? trimmed.slice(0, MAX_SHEET_CHARS) : null;
}
