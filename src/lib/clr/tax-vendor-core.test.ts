import assert from "node:assert/strict";
import { test } from "node:test";
import { buildVendorNameTerms, linesMissingTaxVendor, vendorMatches } from "./tax-vendor-core";

/* The real invoice this was built against, and the shape BC holds it in. */
test("a pasted invoice name searches on its distinctive words", () => {
  assert.deepEqual(
    buildVendorNameTerms("บริษัท เจเนซิส ซัพพลาย เชน จำกัด"),
    ["เจเนซิส", "ซัพพลาย", "เชน"],
  );
});

test("the English boilerplate goes too", () => {
  assert.deepEqual(buildVendorNameTerms("GENESIS SUPPLY CHAIN CO., LTD."), ["GENESIS", "SUPPLY", "CHAIN"]);
});

/* "(มหาชน)" arrives wrapped in parentheses, which BC does not keep. */
test("punctuation separates rather than joins", () => {
  assert.deepEqual(buildVendorNameTerms("บริษัท เสริมสุข จำกัด (มหาชน)"), ["เสริมสุข"]);
});

/* Typing part of a name is the ordinary case, not a special one. */
test("a partial name is a search", () => {
  assert.deepEqual(buildVendorNameTerms("เจเนซิส"), ["เจเนซิส"]);
});

/* Answering "บริษัท" with every company in the ledger would be worse than
 * saying it is not a search. */
test("boilerplate alone is not a search", () => {
  assert.deepEqual(buildVendorNameTerms("บริษัท จำกัด"), []);
  assert.deepEqual(buildVendorNameTerms("   "), []);
  assert.deepEqual(buildVendorNameTerms(null), []);
});

test("a repeated word is not searched twice", () => {
  assert.deepEqual(buildVendorNameTerms("โลตัส โลตัส สระบุรี"), ["โลตัส", "สระบุรี"]);
});

/* One badly-spelled word in BC must not eliminate the right card, so the AND is
 * capped rather than growing with the name. */
test("at most three words are ANDed", () => {
  assert.equal(buildVendorNameTerms("อัลฟ่า เบต้า แกมม่า เดลต้า เอปไซลอน").length, 3);
});

/* ── the approval gate ── */

const line = (vat: number, vendor: string | null) =>
  ({ vatAmount: vat, taxVendorNo: vendor }) as never;

test("a VAT line with no vendor blocks", () => {
  assert.deepEqual(linesMissingTaxVendor([line(121.62, null)]), [1]);
  assert.deepEqual(linesMissingTaxVendor([line(121.62, "   ")]), [1]);
});

test("a VAT line with a vendor passes", () => {
  assert.deepEqual(linesMissingTaxVendor([line(121.62, "VTD0030")]), []);
});

/* Tax Vendor No. rides on the VAT line and nowhere else, so a line that raises
 * no VAT line is complete without one. */
test("a line without VAT needs no vendor", () => {
  assert.deepEqual(linesMissingTaxVendor([line(0, null)]), []);
});

test("every offending line is named, by its position on screen", () => {
  assert.deepEqual(
    linesMissingTaxVendor([line(7, "VTD0030"), line(0, null), line(7, null), line(7, null)]),
    [3, 4],
  );
});

test("no lines is not a failure", () => {
  assert.deepEqual(linesMissingTaxVendor([]), []);
  assert.deepEqual(linesMissingTaxVendor(null), []);
});

/* ── matching a card against what was typed ── */

const card = (no: string, name: string, tin: string | null = null) =>
  ({ vendorNo: no, displayName: name, taxRegistrationNumber: tin });

/* The bug this replaced: SQL's Thai collation would not match a name the OCR
 * read one mark short. A substring in the browser does. */
test("a name missing its final Thai mark still matches", () => {
  assert.equal(vendorMatches(card("ADV0080", "นายภาสพงษ์ พิษณุพจน์"), "ภาสพงษ์ พิษณุพจน"), true);
});

test("a pasted invoice name matches past its boilerplate", () => {
  assert.equal(
    vendorMatches(card("VTD0030", "[CTW] บริษัท เซ็นทรัลพัฒนา จำกัด (มหาชน)"), "บริษัท เซ็นทรัล พัฒนา จำกัด"),
    true,
  );
});

test("the mall prefix narrows to one card", () => {
  assert.equal(vendorMatches(card("VTD0030", "[CTW] บริษัท เซ็นทรัลพัฒนา"), "เซ็นทรัล ctw"), true);
  assert.equal(vendorMatches(card("VTD0026", "[LPO] บริษัท เซ็นทรัลพัฒนา"), "เซ็นทรัล ctw"), false);
});

test("a vendor number or a tax id finds its card", () => {
  assert.equal(vendorMatches(card("VTD0030", "เซ็นทรัลพัฒนา", "0107537002443"), "VTD0030"), true);
  assert.equal(vendorMatches(card("VTD0030", "เซ็นทรัลพัฒนา", "0107537002443"), "0107537002443"), true);
  assert.equal(vendorMatches(card("VTD0030", "เซ็นทรัลพัฒนา", "0-1075-37002-44-3"), "0107537002443"), true);
});

test("English matches whatever case it was typed in", () => {
  assert.equal(vendorMatches(card("ADV0094", "Justine Jay Lope"), "justine jay"), true);
});

/* Nothing typed is not a filter — the list opens whole. */
test("an empty box matches everything", () => {
  assert.equal(vendorMatches(card("ADV0080", "นายภาสพงษ์"), ""), true);
  assert.equal(vendorMatches(card("ADV0080", "นายภาสพงษ์"), "  "), true);
});

test("a word that appears nowhere excludes the card", () => {
  assert.equal(vendorMatches(card("VTD0030", "เซ็นทรัลพัฒนา"), "โลตัส"), false);
});
