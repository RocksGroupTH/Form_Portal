import assert from "node:assert/strict";
import { test } from "node:test";
import { linesWithBadTaxId } from "./tax-id-check-core";

const line = (taxId: string | null, vat = 7) => ({ taxId, vatAmount: vat });

/* The account step is where a tax id stops being a draft and starts being
   something filed. The per-cell notice has warned about a bad check digit since
   PR #40, but a yellow border on one cell among fifteen is not what an approver
   reads — they read the row of buttons at the bottom. This is the same finding,
   counted, next to the button (user, 2026-09-14). */

test("a number that fails its own check digit is named by its row", () => {
  assert.deepEqual(
    linesWithBadTaxId([line("0105564122649"), line("0105564122694"), line("0105560171921")]),
    [2],
  );
});

test("every bad row is named, not just the first", () => {
  assert.deepEqual(
    linesWithBadTaxId([line("0105564122694"), line("0105564122649"), line("0105533134278")]),
    [1, 3],
  );
});

/* An empty box is a different conversation — the requester's form decides when
   a tax id is required, and it is not required on a line claiming no VAT. */
test("an empty tax id is not a bad one", () => {
  assert.deepEqual(linesWithBadTaxId([line(null), line(""), line("   ")]), []);
});

/* A half-typed number already has its own notice under the box, and calling it
   "wrong" here would send an approver looking for a mistake that is really
   someone mid-keystroke. */
test("a number that is not yet thirteen digits is left to its own notice", () => {
  assert.deepEqual(linesWithBadTaxId([line("010556412")]), []);
});

test("punctuation is not a difference", () => {
  assert.deepEqual(linesWithBadTaxId([line("0-1055-64122-64-9")]), []);
  assert.deepEqual(linesWithBadTaxId([line("0-1055-64122-69-4")]), [1]);
});

/* Nothing here blocks. A clearing held over a digit is a clearing not paid, and
   the approver can see the number, the receipt and the seller's name at once —
   which is more than this rule has. */
test("the answer is rows to look at, never a verdict", () => {
  const rows = linesWithBadTaxId([line("0105564122694")]);
  assert.ok(Array.isArray(rows));
});
