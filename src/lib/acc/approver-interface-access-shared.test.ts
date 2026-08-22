import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canActOnClaimBrand,
  canActOnInterfaceTarget,
  canRetargetClaimBrand,
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

/* ── canRetargetClaimBrand — settings/erp-config ─────────────────────────── */

test("an unrestricted approver may repoint anything, and the clear too", () => {
  assert.equal(canRetargetClaimBrand(unrestricted, "PCTH", "KSI"), true);
  assert.equal(canRetargetClaimBrand(unrestricted, "PCTH", null), true);
});

test("a KSI-only approver may not repoint a claim brand that posts to PCTH", () => {
  // The finding: the same person is brand-scoped when approving a claim and was
  // unscoped when deciding which company that claim's journals post to.
  assert.equal(canRetargetClaimBrand(ksiOnly, "PCTH", "KSI"), false);
  assert.equal(canRetargetClaimBrand(ksiOnly, "PCTH", "PCTH"), false);
});

test("a KSI-only approver may not push their own claims into PCTH's books", () => {
  assert.equal(canRetargetClaimBrand(ksiOnly, "KSI", "PCTH"), false);
  assert.equal(canRetargetClaimBrand(ksiOnly, "KSI", "KSI"), true);
});

test("an unmapped claim brand may be given a target the approver holds", () => {
  assert.equal(canRetargetClaimBrand(ksiOnly, null, "KSI"), true);
  assert.equal(canRetargetClaimBrand(ksiOnly, "", "KSI"), true);
  assert.equal(canRetargetClaimBrand(ksiOnly, null, "PCTH"), false);
});

test("clearing asks only about the target the claim brand has now", () => {
  assert.equal(canRetargetClaimBrand(ksiOnly, "KSI", null), true);
  assert.equal(canRetargetClaimBrand(ksiOnly, "PCTH", null), false);
  // Nothing mapped, nothing to protect — the clear deletes no row.
  assert.equal(canRetargetClaimBrand(ksiOnly, null, null), true);
});

test("someone with no interface brands at all may repoint nothing", () => {
  assert.equal(canRetargetClaimBrand(none, "KSI", "KSI"), false);
  assert.equal(canRetargetClaimBrand(none, null, "KSI"), false);
  // …but the clear of an unmapped brand is still a no-op, not a leak.
  assert.equal(canRetargetClaimBrand(none, null, null), true);
});

test("retargeting agrees with the action check it is derived from", () => {
  // Same access: a target this approver may not send is a target they may not
  // point a claim brand at either.
  for (const target of ["PCTH", "KSI", "PCMY", "UNO"]) {
    assert.equal(
      canRetargetClaimBrand(ksiOnly, null, target),
      canActOnInterfaceTarget(ksiOnly, target),
    );
  }
});
