import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canActOnClaimBrand,
  canActOnInterfaceTarget,
  filterRowsForInterfaceAccess,
  type ApproverInterfaceAccess,
} from "./approver-interface-access-shared";

/** An approver with no `AccApproverInterfaceBrand` rows: everything. */
const unrestricted: ApproverInterfaceAccess = { allAccess: true, allowedCodes: [] };

/** The case the finding is about — scoped to one interface target. */
const ksiOnly: ApproverInterfaceAccess = { allAccess: false, allowedCodes: ["KSI"] };

/** What a non-approver resolves to. */
const none: ApproverInterfaceAccess = { allAccess: false, allowedCodes: [] };

const interfaceByClaim = { PCTH: "PCTH", KSI: "KSI", PCMY: "KSI" };

test("an unrestricted approver may act on any target", () => {
  assert.equal(canActOnInterfaceTarget(unrestricted, "PCTH"), true);
  assert.equal(canActOnInterfaceTarget(unrestricted, "KSI"), true);
});

test("a KSI-only approver may not act on a PCTH document", () => {
  // The list already hid PCTH rows from them; the direct-by-id paths did not.
  assert.equal(canActOnInterfaceTarget(ksiOnly, "PCTH"), false);
  assert.equal(canActOnInterfaceTarget(ksiOnly, "KSI"), true);
});

test("target matching ignores case and surrounding space", () => {
  assert.equal(canActOnInterfaceTarget(ksiOnly, " ksi "), true);
});

test("a missing or empty target is refused, not waved through", () => {
  assert.equal(canActOnInterfaceTarget(ksiOnly, null), false);
  assert.equal(canActOnInterfaceTarget(ksiOnly, ""), false);
  assert.equal(canActOnInterfaceTarget(ksiOnly, "   "), false);
});

test("someone with no interface brands at all is refused everything", () => {
  assert.equal(canActOnInterfaceTarget(none, "KSI"), false);
  assert.equal(canActOnInterfaceTarget(none, "PCTH"), false);
});

test("a claim brand is judged through the claim-to-interface map", () => {
  // PCMY claims interface into KSI, so a KSI-only approver may act on them.
  assert.equal(canActOnClaimBrand(ksiOnly, interfaceByClaim, "PCMY"), true);
  assert.equal(canActOnClaimBrand(ksiOnly, interfaceByClaim, "PCTH"), false);
});

test("a claim brand with no mapping is refused", () => {
  assert.equal(canActOnClaimBrand(ksiOnly, interfaceByClaim, "UNO"), false);
  assert.equal(canActOnClaimBrand(ksiOnly, interfaceByClaim, null), false);
});

test("the new assertion agrees with the list filter it backstops", () => {
  // Same access, same map: a row the list would hide is a row the action
  // must refuse. This is the invariant that was missing.
  const rows = [{ brandCode: "PCTH" }, { brandCode: "PCMY" }];
  const visible = filterRowsForInterfaceAccess(rows, interfaceByClaim, ksiOnly);
  for (const row of rows) {
    const shown = visible.includes(row);
    assert.equal(canActOnClaimBrand(ksiOnly, interfaceByClaim, row.brandCode), shown);
  }
});
