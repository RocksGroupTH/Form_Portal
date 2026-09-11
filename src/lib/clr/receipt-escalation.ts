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
export function needsStrongerRead(
  docs: readonly ReceiptDoc[],
  read?: {
    /** Pages handed to the model in this call. */
    pagesSent?: number;
    /** Pages it called neither a receipt nor a slip. */
    skippedPages?: number;
    /** The answer hit the token limit, so the JSON was cut off mid-array. */
    outputTruncated?: boolean;
  },
): boolean {
  if (docs.some((d) => d.kind === "receipt" && (d.vat ?? 0) > 0 && !d.taxId)) return true;

  /* An answer that ran out of room is a failed read whatever it contains: the
     array was cut mid-entry, so what parsed is a prefix of what was seen. */
  if (read?.outputTruncated) return true;

  /* Pages that produced neither a document nor a skip (user, 2026-09-11). The
     same nine-page bundle came back as one row on one run and seven on another,
     and the one-row run was not a bad document — it was a bad read of eight
     good ones, and every signal above it was blind to that because the single
     document it did return was complete.

     Counted by the pages the documents themselves claim to cover, so one
     invoice printed across four pages accounts for four and does not escalate.
     A document that did not say counts as one, which is what the model is told
     to answer when it does not run over. */
  const sent = read?.pagesSent ?? 0;
  if (sent > 0) {
    const covered = docs.reduce((n, d) => n + Math.max(1, d.pages ?? 1), 0) + (read?.skippedPages ?? 0);
    if (covered < sent) return true;
  }
  return false;
}
