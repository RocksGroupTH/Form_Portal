import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TAX_ID_LENGTH,
  compareVendorName,
  registrantDisplayName,
  taxIdDigits,
  taxIdProblem,
} from "./vendor-check";

/* ── the tax id itself ── */

test("thirteen digits is the only acceptable length", () => {
  assert.equal(taxIdProblem("0105566077543"), null);
  assert.equal(TAX_ID_LENGTH, 13);
});

test("punctuation is not part of the number", () => {
  // Receipts print it grouped: 0-1055-66077-54-3. The stored form is digits.
  assert.equal(taxIdDigits("0-1055-66077-54-3"), "0105566077543");
  assert.equal(taxIdProblem("0-1055-66077-54-3"), null);
});

test("too few or too many digits is refused, and the message says which", () => {
  assert.match(taxIdProblem("010556607754") ?? "", /13/);
  assert.match(taxIdProblem("01055660775431") ?? "", /13/);
});

test("empty is not an error — it is simply not filled in yet", () => {
  // The red border is for a WRONG number, not for an unstarted one. A field
  // that turns red the moment it is focused teaches people to ignore red.
  assert.equal(taxIdProblem(""), null);
  assert.equal(taxIdProblem("   "), null);
  assert.equal(taxIdProblem(null), null);
});

test("letters are not digits, so a mixed value is short rather than accepted", () => {
  assert.notEqual(taxIdProblem("01055660775AB"), null);
});

/* ── the name comparison ── */

const RD = { titleName: "บริษัท", name: "ข้าว โซ อิ กรุ๊ป จำกัด" };

test("the same name, written the same way, matches", () => {
  assert.equal(compareVendorName("บริษัท ข้าว โซ อิ กรุ๊ป จำกัด", RD), "match");
});

test("spacing is not part of the name", () => {
  // Thai company names arrive from an OCR read with the spaces in different
  // places every time; the RD's own spacing is not authoritative either.
  assert.equal(compareVendorName("บริษัทข้าวโซอิกรุ๊ปจำกัด", RD), "match");
});

test("a trailing qualifier the receipt prints does not make it a different company", () => {
  assert.equal(
    compareVendorName("บริษัท ข้าว โซ อิ กรุ๊ป จำกัด (Khao-So-i ข้าวโซอิ)", RD),
    "match",
  );
});

test("the title may be missing from what was typed", () => {
  // Plenty of receipts print the name without "บริษัท".
  assert.equal(compareVendorName("ข้าว โซ อิ กรุ๊ป จำกัด", RD), "match");
});

test("a genuinely different company is a mismatch", () => {
  assert.equal(compareVendorName("บริษัท เดอะ 101 จำกัด", RD), "mismatch");
});

test("a blank typed name is a mismatch, not a match", () => {
  // Nothing has been claimed, so nothing agrees. Treating empty as "match"
  // would hide the prompt on exactly the rows that need it most.
  assert.equal(compareVendorName("", RD), "mismatch");
  assert.equal(compareVendorName("   ", RD), "mismatch");
});

test("a registrant with no name at all can never match", () => {
  assert.equal(compareVendorName("บริษัท อะไรก็ได้ จำกัด", { titleName: null, name: null }), "mismatch");
});

test("latin case is ignored", () => {
  assert.equal(
    compareVendorName("khao-so-i group", { titleName: null, name: "KHAO-SO-I GROUP" }),
    "match",
  );
});

/* ── what to offer as the corrected name ── */

test("the offered name joins the title to the name", () => {
  assert.equal(registrantDisplayName(RD), "บริษัท ข้าว โซ อิ กรุ๊ป จำกัด");
});

test("a missing title is not rendered as a leading space", () => {
  assert.equal(registrantDisplayName({ titleName: null, name: "ข้าว โซ อิ" }), "ข้าว โซ อิ");
});

test("no name at all offers nothing, rather than the title alone", () => {
  // "บริษัท" on its own is not a name, and a button offering it would put it in
  // the field.
  assert.equal(registrantDisplayName({ titleName: "บริษัท", name: null }), "");
  assert.equal(registrantDisplayName({ titleName: null, name: null }), "");
});
