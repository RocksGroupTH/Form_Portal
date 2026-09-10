import assert from "node:assert/strict";
import { test } from "node:test";
import { isOwnTaxId } from "./own-tax-ids";

/* The number the reader returned twice as a "seller" while reading the seller's
 * name correctly beside it. On an expense receipt we are the customer, so ours
 * can only have come from the wrong block. */
test("Rocks PC's own number is recognised", () => {
  assert.equal(isOwnTaxId("0105559040818"), true);
});

test("punctuation does not hide it", () => {
  assert.equal(isOwnTaxId(" 0-1055-59040-81-8 "), true);
});

test("a genuine seller's number is not ours", () => {
  // Genesis Supply Chain, from the invoice that exposed this.
  assert.equal(isOwnTaxId("0105560171921"), false);
});

test("nothing is not ours", () => {
  for (const v of ["", "   ", null, undefined]) assert.equal(isOwnTaxId(v), false, String(v));
});

/* A near miss must not be swept up: one digit apart is a different company. */
test("a number one digit away is a different company", () => {
  assert.equal(isOwnTaxId("0105559040819"), false);
});
