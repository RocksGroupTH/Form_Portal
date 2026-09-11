import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeTaxIdInput, resolveSellerTaxId, taxIdChecksumOk, taxIdNotice } from "./seller-tax-id";

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

/* ── what the box accepts ── */

test("the box keeps digits and drops the printing", () => {
  assert.equal(normalizeTaxIdInput(" 0-1055-60171-92-1 "), "0105560171921");
  assert.equal(normalizeTaxIdInput("abc"), "");
});

/* Thirteen is the whole number; a fourteenth digit is a slip that would
 * otherwise stop the RD lookup from ever running again on that line. */
test("the box stops at thirteen digits", () => {
  assert.equal(normalizeTaxIdInput("01055601719219999"), "0105560171921");
  assert.equal(normalizeTaxIdInput("0105560171921").length, 13);
});

test("a complete number and an empty box both say nothing", () => {
  assert.equal(taxIdNotice("0105560171921"), null);
  assert.equal(taxIdNotice(""), null);
  assert.equal(taxIdNotice(null), null);
});

/* The half-typed number is the one worth naming: it looks filled in, and it is
 * the state in which the registry check silently does not run. */
test("a half-typed number says how far it got", () => {
  assert.match(taxIdNotice("010556017") ?? "", /9/);
  assert.match(taxIdNotice("0-1055-6") ?? "", /ยังไม่ครบ 13 หลัก/);
});

/* The check digit. A Thai tax id carries its own proof, and the reader's
   mistakes on a scanned bundle are exactly the kind it catches: two digits
   transposed, one digit off. Five of the six misreads measured on the user's
   ใบกำกับหลายใบ.pdf fail it (2026-09-12). */

test("a real tax id passes its own check digit", () => {
  for (const t of [
    "0105560171921", // เจเนซิส ซัพพลาย เชน, off the invoice
    "0105564122649", // พีพี แสตมป์, from ErpVendors
    "0105559040818", // ร็อคส์ พีซี, off the same invoice
    "0105534121687", // รังสิตพลาซ่า
    "0994000165676", // การไฟฟ้านครหลวง
  ]) assert.equal(taxIdChecksumOk(t), true, t);
});

test("the reader's misreads fail it", () => {
  for (const t of [
    "0105564122694", // พีพี แสตมป์ with the last two transposed
    "0055656500897",
    "0105556168771",
    "0105534213687",
  ]) assert.equal(taxIdChecksumOk(t), false, t);
});

test("punctuation is not a difference, and a short number is not an answer", () => {
  assert.equal(taxIdChecksumOk("0-1055-60171-92-1"), true);
  assert.equal(taxIdChecksumOk("010556017192"), false, "twelve digits");
  assert.equal(taxIdChecksumOk(""), false);
  assert.equal(taxIdChecksumOk(null), false);
});

/* The notice under the box names it, because "ไม่พบในระบบสรรพากร" is a
   different thing — that can mean a company which simply never registered for
   VAT, and it needs the registry to answer at all. This needs nothing. */
test("the notice tells a bad number apart from an unfinished one", () => {
  assert.match(taxIdNotice("010556017192") ?? "", /ยังไม่ครบ 13 หลัก/);
  assert.match(taxIdNotice("0105564122694") ?? "", /ไม่ถูกต้อง/);
  assert.equal(taxIdNotice("0105564122649"), null);
  assert.equal(taxIdNotice(""), null);
});
