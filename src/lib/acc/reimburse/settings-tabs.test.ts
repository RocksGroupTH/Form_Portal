import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GRANTABLE_REIMBURSE_TABS,
  REIMBURSE_SETTINGS_TAB_ORDER,
  decideReimburseTabAccess,
  filterGrantableReimburseTabKeys,
  isGrantableReimburseTabKey,
} from "./settings-tabs";

/* ── what the page shows ── */

test("สิทธิ์เข้าถึง is the last tab", () => {
  assert.equal(
    REIMBURSE_SETTINGS_TAB_ORDER[REIMBURSE_SETTINGS_TAB_ORDER.length - 1],
    "access",
  );
  assert.deepEqual(REIMBURSE_SETTINGS_TAB_ORDER, ["approvers", "rules", "brands", "access"]);
});

/* ── what may be ticked ── */

test("exactly two tabs are grantable, in page order", () => {
  assert.deepEqual(GRANTABLE_REIMBURSE_TABS.map((t) => t.key), ["rules", "brands"]);
  assert.deepEqual(GRANTABLE_REIMBURSE_TABS.map((t) => t.label), [
    "ระเบียบการจ่าย",
    "แบรนด์ที่เบิกได้",
  ]);
});

test("the grantable keys are a subset of the tabs the page actually has", () => {
  // A checkbox for a tab that does not exist would grant nothing, and a tab
  // whose key drifted from the page's would grant the wrong thing.
  for (const t of GRANTABLE_REIMBURSE_TABS) {
    assert.ok(
      REIMBURSE_SETTINGS_TAB_ORDER.indexOf(t.key) !== -1,
      t.key + " is not a tab on the page",
    );
  }
});

test("access and approvers are never grantable", () => {
  // `access` — whoever opens it can grant themselves the rest.
  // `approvers` — that tab is AP-4's payment-approval pool, so granting it
  // would be a route from "may edit the checklist" to "may approve money".
  assert.equal(isGrantableReimburseTabKey("access"), false);
  assert.equal(isGrantableReimburseTabKey("approvers"), false);
  assert.equal(isGrantableReimburseTabKey("rules"), true);
  assert.equal(isGrantableReimburseTabKey("brands"), true);
  assert.equal(isGrantableReimburseTabKey("nonsense"), false);
  assert.equal(isGrantableReimburseTabKey(""), false);
});

test("filtering keeps known keys, trimmed, de-duplicated, in the caller's order", () => {
  assert.deepEqual(
    filterGrantableReimburseTabKeys(["brands", " rules ", "brands", "access", "approvers", "x"]),
    ["brands", "rules"],
  );
  assert.deepEqual(filterGrantableReimburseTabKeys([]), []);
});

/* ── the decision ── */

test("an admin passes everything, access and approvers included", () => {
  for (const tab of ["rules", "brands", "access", "approvers"]) {
    assert.equal(decideReimburseTabAccess(true, [], tab), true, tab);
  }
});

test("a non-admin passes only a grantable tab that is in their list", () => {
  assert.equal(decideReimburseTabAccess(false, ["rules"], "rules"), true);
  assert.equal(decideReimburseTabAccess(false, ["rules"], "brands"), false);
  assert.equal(decideReimburseTabAccess(false, [], "rules"), false);
  assert.equal(decideReimburseTabAccess(false, [" rules "], "rules"), true);
  assert.equal(decideReimburseTabAccess(false, ["rules"], " rules "), true);
});

test("a stored row for access or approvers stays inert", () => {
  // AccReimburseAccessTab has no CHECK on TabKey and is writable from more than
  // one place, so a row naming any string can appear. The grantable test is
  // what makes it harmless — do not weaken this to a bare membership check.
  assert.equal(decideReimburseTabAccess(false, ["access"], "access"), false);
  assert.equal(decideReimburseTabAccess(false, ["approvers"], "approvers"), false);
  assert.equal(decideReimburseTabAccess(false, ["access", "rules"], "rules"), true);
});

test("an unknown tab is refused even to a holder of every grant", () => {
  const everything = GRANTABLE_REIMBURSE_TABS.map((t) => t.key);
  assert.equal(decideReimburseTabAccess(false, everything, "erp-config"), false);
  assert.equal(decideReimburseTabAccess(false, everything, "__proto__"), false);
  assert.equal(decideReimburseTabAccess(false, everything, ""), false);
});
