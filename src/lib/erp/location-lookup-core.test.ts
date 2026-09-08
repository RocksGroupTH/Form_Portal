import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBranchLookup } from "./location-lookup-core";

test("maps a branch to the BU its Location is bound to", () => {
  const m = buildBranchLookup([{ branchCode: "PC1057", buCode: "DODO-M", isBranchBlocked: false }]);
  assert.deepEqual(m.get("PC1057"), { buCode: "DODO-M", isBlocked: false });
});

/* The journal line's branch comes from the expense row, the map from BC. Neither
 * guarantees the case, and a miss here would silently fall back to COCO. */
test("branch codes match whatever the case", () => {
  const m = buildBranchLookup([{ branchCode: "pc1057", buCode: "DOCO", isBranchBlocked: false }]);
  assert.equal(m.get("PC1057")?.buCode, "DOCO");
});

/* A blocked BRANCH is rejected by BC at validation, per line, with a reason
 * nothing stores. Knowing before the send is the whole point, so a blocked
 * branch stays in the map — carrying the warning — rather than vanishing. */
test("a blocked branch is present and flagged", () => {
  const m = buildBranchLookup([{ branchCode: "PC1021", buCode: "COCO", isBranchBlocked: true }]);
  assert.deepEqual(m.get("PC1021"), { buCode: "COCO", isBlocked: true });
});

/* A Location with no BU still belongs in the map when its branch is known: the
 * entry carries buCode null, so the caller sends no key and the codeunit applies
 * its own fallback — while the blocked flag stays visible either way. */
test("no BU gives an entry with a null buCode, not an absent branch", () => {
  const m = buildBranchLookup([{ branchCode: "PC9999", buCode: null, isBranchBlocked: true }]);
  assert.deepEqual(m.get("PC9999"), { buCode: null, isBlocked: true });
  const m2 = buildBranchLookup([{ branchCode: "PC9998", buCode: "   ", isBranchBlocked: false }]);
  assert.deepEqual(m2.get("PC9998"), { buCode: null, isBlocked: false });
});

test("a row with no branch is skipped", () => {
  assert.equal(buildBranchLookup([{ branchCode: null, buCode: "COCO", isBranchBlocked: false }]).size, 0);
  assert.equal(buildBranchLookup([{ branchCode: "  ", buCode: "COCO", isBranchBlocked: false }]).size, 0);
});

test("surrounding whitespace does not stop a match", () => {
  const m = buildBranchLookup([{ branchCode: " HQ01 ", buCode: " CTPS ", isBranchBlocked: false }]);
  assert.equal(m.get("HQ01")?.buCode, "CTPS");
});

/* PCMY really does have two Locations on branch MW001. First wins — arbitrary,
 * but the same answer on every sync rather than one that follows row order. */
test("a repeated branch keeps the first answer", () => {
  const m = buildBranchLookup([
    { branchCode: "MW001", buCode: "COCO", isBranchBlocked: false },
    { branchCode: "MW001", buCode: "DODO", isBranchBlocked: true },
  ]);
  assert.deepEqual(m.get("MW001"), { buCode: "COCO", isBlocked: false });
});
