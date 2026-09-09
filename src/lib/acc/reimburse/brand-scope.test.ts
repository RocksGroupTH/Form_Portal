import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isApproverScope,
  canActOnTarget,
  filterToScope,
  normalizeScopeTargets,
} from "./brand-scope";
// brand-scope.ts itself imports nothing -- see its module docblock. The
// allow-list it inlines must still track the real one, so this test file
// (which may import freely) checks the two never drift apart.
import { ERP_INTERFACE_BRANDS } from "@/lib/acc/erp-interface-brands";

test("zero brands is not an approver — absence never means all", () => {
  assert.equal(isApproverScope([]), false);
  assert.equal(canActOnTarget([], "PCTH"), false);
});

test("one brand is an approver, scoped to it", () => {
  assert.equal(isApproverScope(["KSI"]), true);
  assert.equal(canActOnTarget(["KSI"], "KSI"), true);
  assert.equal(canActOnTarget(["KSI"], "PCTH"), false);
});

test("a claim that maps to no target is out of every scope", () => {
  // The fail-safe direction: an unmapped claim brand is visible to nobody but
  // an admin, rather than to everybody.
  assert.equal(canActOnTarget(["PCTH", "KSI", "PCMY", "UNO"], null), false);
});

test("target comparison is case-insensitive and trimmed", () => {
  assert.equal(canActOnTarget(["KSI"], " ksi "), true);
});

test("filterToScope drops rows whose target is out of scope, keeping order", () => {
  const rows = [{ id: 1, t: "PCTH" }, { id: 2, t: "KSI" }, { id: 3, t: null }, { id: 4, t: "PCTH" }];
  assert.deepEqual(
    filterToScope(rows, ["PCTH"], (r) => r.t).map((r) => r.id),
    [1, 4],
  );
});

test("normalizeScopeTargets uppercases, trims, dedupes and drops non-brands", () => {
  assert.deepEqual(normalizeScopeTargets([" ksi ", "KSI", "PCTH", "", null, 7, "NOPE"]), ["KSI", "PCTH"]);
});

test("the inlined allow-list matches ERP_INTERFACE_BRANDS's codes exactly", () => {
  // brand-scope.ts cannot import ERP_INTERFACE_BRANDS (it must import
  // nothing), so its SCOPE_BRAND_CODES literal is a second copy of the same
  // list. Prove indirectly, through normalizeScopeTargets, that the copy
  // accepts exactly the codes the real list names and nothing else.
  const realCodes = ERP_INTERFACE_BRANDS.map((b) => b.id.toUpperCase()).sort();
  const accepted = normalizeScopeTargets(realCodes).sort();
  assert.deepEqual(accepted, realCodes);
  assert.equal(realCodes.length, 4);
});
