import assert from "node:assert/strict";
import { test } from "node:test";
import { taxBranchCode } from "./tax-branch-core";

/* Thailand's Revenue Department numbers a company's branches: 00000 is the head
 * office, 00001 the first branch. BC keeps it as Code[5] on the Vendor
 * ("NWTH Branch Code"), and it is the seller's branch — the journal line's field
 * is filled from the vendor card, not from ours. */

test("head office, however it is worded, is 00000", () => {
  for (const s of ["สำนักงานใหญ่", "สนญ.", "Head Office", "HEAD OFFICE", " สำนักงานใหญ่ "]) {
    assert.equal(taxBranchCode(s), "00000", s);
  }
});

test("a numbered branch keeps its number, padded to five", () => {
  assert.equal(taxBranchCode("สาขาที่ 00001"), "00001");
  assert.equal(taxBranchCode("สาขา 1"), "00001");
  assert.equal(taxBranchCode("Branch 23"), "00023");
  assert.equal(taxBranchCode("สาขาที่ 12345"), "12345");
});

/* A bare number is the code itself — some invoices print only "00002". */
test("a bare number is taken as the code", () => {
  assert.equal(taxBranchCode("00002"), "00002");
  assert.equal(taxBranchCode("2"), "00002");
});

/* Null is an answer: nothing was read, so nothing is sent and BC keeps whatever
 * the vendor card says. A guess here would put a branch on a tax filing. */
test("anything unreadable answers nothing", () => {
  for (const s of ["", "   ", null, undefined, "กรุงเทพมหานคร", "-"]) {
    assert.equal(taxBranchCode(s), null, String(s));
  }
});

/* More than five digits cannot be a branch code, and truncating one would
 * invent a different branch. */
test("a number too long to be a branch code answers nothing", () => {
  assert.equal(taxBranchCode("สาขาที่ 123456"), null);
});
