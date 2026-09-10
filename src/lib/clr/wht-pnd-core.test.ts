import assert from "node:assert/strict";
import { test } from "node:test";
import { PND_VENDOR_NO, suggestPndType, pndBlockReason } from "./wht-pnd-core";

/* A juristic person is registered by the DBD with a number beginning 0; an
 * individual uses a national id, which begins 1-8. Measured against the 2,178
 * vendors in ErpVendors holding a clean 13-digit id: of those beginning 0, 1,692
 * read as juristic against 83 that do not; of those beginning with anything
 * else, exactly one does out of 403. */
test("a leading zero suggests a juristic person", () => {
  assert.equal(suggestPndType("0105500000001"), "PND53");
});

test("any other leading digit suggests an individual", () => {
  for (const id of ["1101700207999", "3100600123456", "5000000000001"]) {
    assert.equal(suggestPndType(id), "PND3");
  }
});

test("spaces and dashes are not part of the number", () => {
  assert.equal(suggestPndType(" 0-1055-00000-00-1 "), "PND53");
});

/* Null is an answer here: it means nobody has decided yet, which is different
 * from deciding "individual". A guess made from an unreadable id would be
 * indistinguishable from a person's judgement once it is stored. */
test("anything that is not 13 clean digits suggests nothing", () => {
  for (const id of ["", "   ", "0105", "01055000000012", "abc", null, undefined]) {
    assert.equal(suggestPndType(id), null);
  }
});

/* A 13-character string is not a 13-digit id. Letters are stripped, not counted,
 * so "01055000000O1" is twelve digits and answers nothing rather than reading
 * the leading zero and calling it a company. */
test("letters mixed into the digits do not pad the length", () => {
  assert.equal(suggestPndType("01055000000O1"), null);
});

test("each type names the vendor accounting clears", () => {
  assert.equal(PND_VENDOR_NO.PND3, "WHT-PND.3");
  assert.equal(PND_VENDOR_NO.PND53, "WHT-PND.53");
});

/* ── the account-step gate ── */

const line = (wht: number) => ({ whtAmount: wht });
const payee = (t: "PND3" | "PND53" | null) => ({ pndType: t });

/* Withholding that does not exist cannot be missing a type. */
test("no withholding, nothing to answer for", () => {
  assert.equal(pndBlockReason([line(0)], []), null);
  assert.equal(pndBlockReason([], []), null);
  assert.equal(pndBlockReason(null, null), null);
});

test("a payee with a type passes", () => {
  assert.equal(pndBlockReason([line(30)], [payee("PND3")]), null);
});

test("a payee without one blocks, and is named by row", () => {
  const r = pndBlockReason([line(30)], [payee("PND3"), payee(null), payee(null)]);
  assert.match(r ?? "", /รายที่ 2, 3/);
});

/* The journal builder refuses this too — WHT with nobody to attribute it to. */
test("withholding with no payee rows at all blocks", () => {
  assert.match(pndBlockReason([line(30)], []) ?? "", /ส่งกลับแก้ไข/);
});

/* Amounts across lines are summed the way the payload sums them. */
test("withholding spread over lines still counts", () => {
  assert.match(pndBlockReason([line(10.005), line(20)], [payee(null)]) ?? "", /ภ\.ง\.ด/);
});
