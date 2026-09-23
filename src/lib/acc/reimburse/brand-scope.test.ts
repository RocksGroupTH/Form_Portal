import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isApproverScope,
  canActOnTarget,
  filterToScope,
  normalizeScopeTargets,
} from "./brand-scope";

/**
 * `brand-scope.ts` imports nothing — see its module docblock — and since
 * 2026-09-23 it inlines nothing either.
 *
 * **The drift guard this file used to carry is gone, and its absence is the
 * point.** It asserted that `SCOPE_BRAND_CODES` equalled ERP_INTERFACE_BRANDS'
 * codes, both directions, having been defeated once by an EXTRA entry. That
 * was the right test of the wrong design: a literal mirroring a literal can be
 * compared, and a literal mirroring a DATABASE READ cannot be — it can only be
 * stale. The literal is deleted and the live codes are passed in on the write
 * path instead, so there is no second copy left to drift.
 *
 * What replaces it is not another equality assertion but a property: the
 * `known` list is an argument, so these tests state what the function does
 * with WHATEVER list it is handed, including one carrying a brand that did not
 * exist when this file was written.
 */

/** Stands in for whatever `listErpInterfaceBrands()` answers at the call site. */
const KNOWN = ["PCTH", "KSI", "PCMY", "UNO"];

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
  assert.deepEqual(
    normalizeScopeTargets([" ksi ", "KSI", "PCTH", "", null, 7, "NOPE"], KNOWN),
    ["KSI", "PCTH"],
  );
});

test("a brand is known because the CALLER says so, not because this module does", () => {
  /* The defect that deleted `SCOPE_BRAND_CODES`: an admin ticks a brand whose
     Config BC has just been completed, and the tick is dropped on save as
     "not one of the four" — silently, with the box simply unticking itself.
     Handed a list that carries it, it survives. */
  assert.deepEqual(normalizeScopeTargets(["SMR"], ["PCTH", "SMR"]), ["SMR"]);
  // And handed one that does not, it is still dropped — this is a narrowing,
  // not the removal of one.
  assert.deepEqual(normalizeScopeTargets(["SMR"], KNOWN), []);
  // An empty known list narrows to nothing rather than to everything. That is
  // the fail-safe direction and it matters: an empty list is what a failed
  // brand read looks like, and "no targets" is not an approver at all.
  assert.deepEqual(normalizeScopeTargets(["PCTH"], []), []);
});

test("canActOnTarget no longer consults an allow-list of its own", () => {
  /* It used to require each stored entry to be one of the four, which would
     now refuse a legitimately ticked new brand for as long as the frozen list
     disagreed with the real one. Equality with the document's own resolved
     target is what grants — a junk row can only match by being a real code. */
  assert.equal(canActOnTarget(["SMR"], "SMR"), true);
  assert.equal(canActOnTarget(["SMR"], "PCTH"), false);
  // The properties the CHECK-less column needs are unchanged.
  assert.equal(canActOnTarget([""], ""), false);
  assert.equal(canActOnTarget(["   "], "PCTH"), false);
  assert.equal(canActOnTarget([null as unknown as string], "PCTH"), false);
});

test("isApproverScope counts a real entry, not a blank one", () => {
  assert.equal(isApproverScope(["SMR"]), true);
  assert.equal(isApproverScope([""]), false);
  assert.equal(isApproverScope(["   "]), false);
  assert.equal(isApproverScope([null as unknown as string]), false);
});

test("a blank entry is not a scope, and a FOREIGN one is caught upstream now", () => {
  /* The column has no CHECK (migration 144, mirroring 038), so a blank or a
     foreign code is representable in the table, and `isApproverScope` drives
     `AccReimburseApprover.IsActive` — a row marked active whose scope grants
     nothing is the failure this guards.

     **Blank still answers false here.** Foreign no longer does, and that is a
     deliberate move of the check rather than its removal: this module has no
     allow-list any more (see the file docblock), so it cannot ask whether
     "ROCKS" is a brand. What answers that is `normalizeScopeTargets`, on BOTH
     sides of the table — `brand-scope-load.ts` narrows on the way out and the
     settings service narrows on the way in, each against the live interface
     brands — so a foreign row never reaches this function in the running app.
     The arm below states that dependency rather than leaving it implied. */
  assert.equal(isApproverScope([""]), false);
  assert.equal(isApproverScope(["   "]), false);
  assert.equal(isApproverScope(["ROCKS", "KSI"]), true);

  // The upstream narrowing is what makes a foreign code inert, and it is one
  // call rather than a property of every reader.
  assert.deepEqual(normalizeScopeTargets(["ROCKS", "KSI"], KNOWN), ["KSI"]);
  assert.equal(isApproverScope(normalizeScopeTargets(["ROCKS"], KNOWN)), false);
});

test("a null inside targets refuses rather than throwing", () => {
  // Typed `string[]`, but the values arrive from a NOT NULL column with no
  // CHECK and from JSON on the settings POST. An exception here fails the
  // whole request; a refusal fails one row. Crashing is a worse way to be safe
  // than saying no.
  const dirty = [null, "PCTH"] as unknown as string[];
  assert.equal(canActOnTarget(dirty, "PCTH"), true);
  assert.equal(canActOnTarget(dirty, "KSI"), false);
  assert.equal(canActOnTarget([null] as unknown as string[], "PCTH"), false);
});
