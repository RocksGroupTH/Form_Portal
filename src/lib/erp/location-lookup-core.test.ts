import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBranchBuMap } from "./location-lookup-core";

test("maps a branch to the BU its Location is bound to", () => {
  const m = buildBranchBuMap([{ branchCode: "PC1057", buCode: "DODO-M" }]);
  assert.equal(m.get("PC1057"), "DODO-M");
});

/* The journal line's branch comes from the expense row, the map from BC. Neither
 * guarantees the case, and a miss here would silently fall back to COCO. */
test("branch codes match whatever the case", () => {
  const m = buildBranchBuMap([{ branchCode: "pc1057", buCode: "DOCO" }]);
  assert.equal(m.get("PC1057"), "DOCO");
});

/* A Location with no BU tells us nothing. An entry mapping to "" would read as
 * an answer and send a blank dimension; leaving it out lets the caller send no
 * key at all, which is what triggers the codeunit's own fallback. */
test("a Location with no BU is absent, not mapped to blank", () => {
  const m = buildBranchBuMap([{ branchCode: "PC9999", buCode: null }]);
  assert.equal(m.has("PC9999"), false);
  const m2 = buildBranchBuMap([{ branchCode: "PC9999", buCode: "   " }]);
  assert.equal(m2.has("PC9999"), false);
});

test("a row with no branch is skipped", () => {
  assert.equal(buildBranchBuMap([{ branchCode: null, buCode: "COCO" }]).size, 0);
  assert.equal(buildBranchBuMap([{ branchCode: "  ", buCode: "COCO" }]).size, 0);
});

test("surrounding whitespace does not stop a match", () => {
  const m = buildBranchBuMap([{ branchCode: " HQ01 ", buCode: " CTPS " }]);
  assert.equal(m.get("HQ01"), "CTPS");
});

/* Two Locations should never share a branch, but if BC ever returns that, the
 * map has to resolve it the same way every time rather than by row order luck. */
test("a repeated branch keeps the first answer", () => {
  const m = buildBranchBuMap([
    { branchCode: "PC1001", buCode: "COCO" },
    { branchCode: "PC1001", buCode: "DODO" },
  ]);
  assert.equal(m.get("PC1001"), "COCO");
});
