import type { ReceiptDoc } from "./ai-receipt-core";

/**
 * Is this read worth paying a bigger model to redo?
 *
 * The small model handles ordinary receipts well and costs a fraction, so the
 * question is not "which model is better" but "which documents did this one
 * plainly fail on". One signal answers that without guessing:
 *
 * **A document charging VAT is a full tax invoice, and Thai law requires it to
 * print the seller's tax id.** So VAT with no seller tax id is a failed read, not
 * a receipt that lacked one. That is precisely what happened on a rotated scan
 * on 2026-09-08 — Haiku returned our own tax id (discarded on our side, leaving
 * the field empty) across four prompt variations, while Sonnet read the seller's
 * correctly on the first attempt, along with the invoice number and the seller's
 * name that Haiku had been spelling differently every run.
 *
 * The everyday case is deliberately left alone: a taxi fare or a parking slip
 * carries neither VAT nor a tax id, and a second pass there buys nothing.
 *
 * One suspect document escalates the whole upload, because the pages are read in
 * a single call — a second pass is all of them or none.
 */
export function needsStrongerRead(docs: readonly ReceiptDoc[]): boolean {
  return docs.some((d) => d.kind === "receipt" && (d.vat ?? 0) > 0 && !d.taxId);
}
