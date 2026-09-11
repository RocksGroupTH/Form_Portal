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
