import assert from "node:assert/strict";
import { test } from "node:test";
import { needsStrongerRead } from "./receipt-escalation";

const doc = (over: Record<string, unknown> = {}) => ({
  kind: "receipt" as const, pages: 1, date: "2026-09-08", description: "x",
  docNo: "IV1", beforeVat: 1000, vat: 70, wht: null,
  taxId: "0105560171921", payeeName: "ผู้ขาย", payeeAddress: null,
  total: 1070, branchHint: null, amounts: [], ...over,
});

/* A document charging VAT is a full tax invoice, and Thai law requires it to
 * print the seller's tax id. Missing means the read failed, not that the paper
 * lacked one — which is exactly what a rotated scan did to the small model. */
test("VAT charged but no seller tax id is worth a second read", () => {
  assert.equal(needsStrongerRead([doc({ taxId: null })]), true);
});

/* The common case must not escalate: a taxi fare or a parking slip has no VAT
 * and no tax id, and paying for a bigger model there buys nothing. */
test("no VAT and no tax id is an ordinary receipt", () => {
  assert.equal(needsStrongerRead([doc({ vat: null, taxId: null })]), false);
  assert.equal(needsStrongerRead([doc({ vat: 0, taxId: null })]), false);
});

test("a complete tax invoice is left alone", () => {
  assert.equal(needsStrongerRead([doc()]), false);
});

/* One bad document in an upload is enough — the call reads them together, so a
 * second pass fixes the whole batch or none of it. */
test("one suspect document escalates the whole upload", () => {
  assert.equal(needsStrongerRead([doc(), doc({ taxId: null })]), true);
});

/* Slips carry no VAT and no seller. */
test("a transfer slip never escalates", () => {
  assert.equal(needsStrongerRead([doc({ kind: "slip", vat: null, taxId: null })]), false);
});

test("nothing read at all is not something a bigger model fixes", () => {
  assert.equal(needsStrongerRead([]), false);
});

/* A read that leaves most of the upload unaccounted for (user, 2026-09-11).
   The same nine-page bundle came back as one row on one run and seven on
   another, and the one-row run was not a bad document — it was a bad read of
   eight good ones. Nothing in the old signal could see that: the single
   document it returned was complete. */

test("pages that produced neither a document nor a skip earn a second read", () => {
  assert.equal(
    needsStrongerRead([doc({ pages: 1 })], { pagesSent: 9, skippedPages: 0 }),
    true,
  );
});

test("one invoice printed across four pages accounts for all of them", () => {
  assert.equal(
    needsStrongerRead([doc({ pages: 4 })], { pagesSent: 4, skippedPages: 0 }),
    false,
  );
});

test("documents plus skips covering the upload is a complete read", () => {
  assert.equal(
    needsStrongerRead([doc(), doc(), doc()], { pagesSent: 9, skippedPages: 6 }),
    false,
  );
});

test("a document that did not say how many pages it covers counts as one", () => {
  assert.equal(
    needsStrongerRead([doc({ pages: undefined })], { pagesSent: 1, skippedPages: 0 }),
    false,
  );
});

test("an answer the model ran out of room to finish is a failed read", () => {
  assert.equal(
    needsStrongerRead([doc()], { pagesSent: 1, skippedPages: 0, outputTruncated: true }),
    true,
  );
});

test("without page counts it still judges by the documents alone", () => {
  assert.equal(needsStrongerRead([doc({ taxId: null })]), true);
  assert.equal(needsStrongerRead([doc()]), false);
});
