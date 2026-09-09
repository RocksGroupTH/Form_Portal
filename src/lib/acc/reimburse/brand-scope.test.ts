import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isApproverScope,
  canActOnTarget,
  filterToScope,
  normalizeScopeTargets,
  SCOPE_BRAND_CODES,
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
  // list, and this is the only thing stopping the two drifting apart.
  //
  // **Both directions, and the first version had only one.** Feeding the real
  // codes in and watching them survive proves the copy is not MISSING one; it
  // says nothing about the copy holding an EXTRA. Review measured the gap:
  // appending "ROCKS" to SCOPE_BRAND_CODES — the code migration 092 actually
  // seeds into AccFormBrand for AP-4, and which is not an ERP interface brand
  // — left that version green while normalizeScopeTargets started accepting
  // it as a grant. So compare the arrays themselves.
  const realCodes = ERP_INTERFACE_BRANDS.map((b) => b.id.toUpperCase()).sort();
  assert.deepEqual(
    Array.from(SCOPE_BRAND_CODES).map((c) => c.toUpperCase()).sort(),
    realCodes,
    "brand-scope.ts's SCOPE_BRAND_CODES no longer equals ERP_INTERFACE_BRANDS' codes. An EXTRA " +
      "entry here becomes a target somebody can be scoped to that no ERP group exists for; a " +
      "MISSING one silently strips a legitimate tick on the next save.",
  );
  assert.equal(realCodes.length, 4);
});

test("a blank or foreign entry is not a scope — it counts recognised targets, not entries", () => {
  // The column has no CHECK (migration 144, mirroring 038), so a blank or a
  // foreign code is representable in the table. Counting array entries would
  // make `isApproverScope` and `canActOnTarget` disagree about the same
  // person: active, per the first, with every real brand refused by the
  // second. The settings service keeps AccReimburseApprover.IsActive in step
  // with this answer, so that disagreement would ship as a row marked active
  // whose scope grants nothing.
  assert.equal(isApproverScope([""]), false);
  assert.equal(isApproverScope(["   "]), false);
  assert.equal(isApproverScope(["ROCKS"]), false);
  assert.equal(isApproverScope(["ROCKS", "KSI"]), true);
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
