import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSellerTaxId } from "./seller-tax-id";

const OURS = "0105559040818";   // Rocks PC
const SELLER = "0105560171921"; // Genesis Supply Chain

test("the seller's number is taken as read", () => {
  assert.equal(resolveSellerTaxId(SELLER, OURS), SELLER);
});

/* The reader labels the two blocks wrongly on a rotated scan — three runs of the
 * same invoice returned ours as the seller. It reads both numbers correctly; it
 * only mixes up whose is whose, and knowing one of them is ours settles it. */
test("a swapped pair is recovered from the buyer field", () => {
  assert.equal(resolveSellerTaxId(OURS, SELLER), SELLER);
});

test("ours in both means nothing can be recovered", () => {
  assert.equal(resolveSellerTaxId(OURS, OURS), null);
});

test("ours with no buyer number gives nothing rather than ours", () => {
  assert.equal(resolveSellerTaxId(OURS, null), null);
  assert.equal(resolveSellerTaxId(OURS, ""), null);
});

/* A swap is only recoverable when the other number is a real tax id. Half a
 * number is not one, and guessing from it would be worse than an empty field. */
test("a buyer number that is not 13 digits cannot rescue a swap", () => {
  assert.equal(resolveSellerTaxId(OURS, "01055"), null);
});

test("digits are extracted from whatever punctuation is printed", () => {
  assert.equal(resolveSellerTaxId(" 0-1055-60171-92-1 ", null), SELLER);
});

test("nothing read means nothing", () => {
  assert.equal(resolveSellerTaxId(null, null), null);
  assert.equal(resolveSellerTaxId("", "   "), null);
});

/* Neither being ours is the ordinary case: trust the labelling, since the buyer
 * field is only ever used to detect a swap. */
test("when neither is ours the seller field is believed", () => {
  assert.equal(resolveSellerTaxId(SELLER, "0994000165676"), SELLER);
});
