/**
 * The last gate on the figure AP-1 prefills into จำนวนเงิน.
 *
 * The number itself now comes from Claude reading the receipt image
 * (`/api/request/accounting/receipt-amount`) rather than from a regex over OCR
 * text, so this file no longer parses anything. What it still has to do is
 * refuse an answer that cannot be a receipt total — a model can misread, and
 * the tax id printed on every Thai receipt is the number most likely to be
 * mistaken for one. **A blank, editable field is always better than a wrong
 * figure on a form somebody is about to submit.**
 *
 * Pure — imports nothing, so it is unit-tested without a key or a network.
 */

/**
 * Above this, treat the answer as a misread rather than a claim. A single AP-1
 * expense row is a fare, a toll or a parking fee; nothing near a million baht
 * belongs in one, while a 10–13 digit tax id or invoice number lands far above it.
 */
export const MAX_RECEIPT_AMOUNT = 1_000_000;

/** The amount to prefill, or null when there is nothing trustworthy to fill. */
export function sanitizeReceiptAmount(value: unknown): number | null {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string" && value.trim() !== "") {
    n = Number(value);
  } else {
    return null;
  }

  if (!Number.isFinite(n)) return null;
  if (n <= 0 || n > MAX_RECEIPT_AMOUNT) return null;
  return Math.round(n * 100) / 100;
}
