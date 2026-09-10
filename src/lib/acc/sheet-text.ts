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

/**
 * The cap for a read that expects a BUNDLE rather than one document.
 *
 * AP-4's attachment is routinely a payment-voucher pack: a cover sheet, a
 * clear-advance summary, a bank transfer slip, and only then the itemised
 * receipt the claim is actually for. On the sample that prompted this, the
 * receipt and its 39 lines are on pages 4-7 of 7 — so at three pages the reader
 * saw the cover, the summary and the slip, found nothing itemised, and returned
 * an empty `lines`. It was not misreading the document; it was never shown it.
 *
 * Ten rather than "all": the tail still gets lost rather than the request being
 * refused, which is `MAX_PDF_PAGES`'s rule and the right one. It is a separate
 * constant rather than a raised shared one because image tokens are billed per
 * call, and AP-1's receipt read and AP-17's booking read both genuinely do get
 * one document — raising theirs would triple their bill to solve a problem they
 * do not have.
 */
export const MAX_PDF_PAGES_BUNDLE = 10;

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
