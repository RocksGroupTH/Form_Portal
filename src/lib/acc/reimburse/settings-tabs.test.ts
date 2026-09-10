import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GRANTABLE_REIMBURSE_TABS,
  REIMBURSE_MENU_KEYS,
  REIMBURSE_SETTINGS_TAB_ORDER,
  decideReimburseMenuAccess,
  decideReimburseTabAccess,
  filterGrantableReimburseTabKeys,
  filterReimburseMenuKeys,
  filterStorableReimburseKeys,
  isGrantableReimburseTabKey,
  isReimburseMenuKey,
} from "./settings-tabs";

/* ── what the page shows ── */

test("the strip runs brands, rules, erpInterface, access", () => {
  assert.deepEqual(REIMBURSE_SETTINGS_TAB_ORDER, [
    "brands",
    "rules",
    "erpInterface",
    "access",
  ]);
  // สิทธิ์เข้าถึง last is the part that is not merely a preference: it is the
  // tab that hands out the other three, so it reads as the end of the list.
  assert.equal(
    REIMBURSE_SETTINGS_TAB_ORDER[REIMBURSE_SETTINGS_TAB_ORDER.length - 1],
    "access",
  );
});

test("erpInterface is a real tab and is NOT grantable", () => {
  // Task 2's whole point: AP-4's own Business Central posting configuration is
  // gated but not brand-scoped (see settings-tabs.ts's module docblock), so
  // unlike AP-1's own grantable `erpInterface` tab, this one must stay
  // admin-only. The existing tests above do not pin this — a mistake here
  // would only surface as a route accepting a grant it should refuse.
  assert.ok(
    REIMBURSE_SETTINGS_TAB_ORDER.indexOf("erpInterface") !== -1,
    "erpInterface is missing from the tab strip",
  );
  assert.equal(isGrantableReimburseTabKey("erpInterface"), false);
  assert.equal(
    GRANTABLE_REIMBURSE_TABS.map((t) => t.key as string).indexOf("erpInterface"),
    -1,
    "erpInterface must not appear in the grantable list",
  );
});

/* ── what may be ticked ── */

test("exactly two tabs are grantable, in page order", () => {
  // Page order, not declaration order: the checkbox columns are the strip's
  // first two tabs, so reordering the strip reorders the columns with it.
  assert.deepEqual(GRANTABLE_REIMBURSE_TABS.map((t) => t.key), ["brands", "rules"]);
  assert.deepEqual(GRANTABLE_REIMBURSE_TABS.map((t) => t.label), [
    "แบรนด์ที่เบิกได้",
    "ระเบียบการจ่าย",
  ]);
  assert.deepEqual(
    GRANTABLE_REIMBURSE_TABS.map((t) => t.key),
    REIMBURSE_SETTINGS_TAB_ORDER.filter((k) => k === "brands" || k === "rules"),
  );
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

test("access is never grantable", () => {
  // Whoever opens it can grant themselves the rest — sharper now that the
  // same tab also carries the brand ticks that make somebody an approver.
  // `approvers` is no longer a tab at all; `isGrantableReimburseTabKey`
  // answers false for it the same way it does for any other unknown string,
  // covered below by "nonsense".
  assert.equal(isGrantableReimburseTabKey("access"), false);
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

test("an admin passes everything, access included", () => {
  for (const tab of ["rules", "brands", "access"]) {
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

test("a stored row for access stays inert", () => {
  // AccReimburseAccessTab has no CHECK on TabKey and is writable from more than
  // one place, so a row naming any string can appear. The grantable test is
  // what makes it harmless — do not weaken this to a bare membership check.
  assert.equal(decideReimburseTabAccess(false, ["access"], "access"), false);
  assert.equal(decideReimburseTabAccess(false, ["access", "rules"], "rules"), true);
});

test("an unknown tab is refused even to a holder of every grant", () => {
  const everything = GRANTABLE_REIMBURSE_TABS.map((t) => t.key);
  assert.equal(decideReimburseTabAccess(false, everything, "erp-config"), false);
  assert.equal(decideReimburseTabAccess(false, everything, "__proto__"), false);
  assert.equal(decideReimburseTabAccess(false, everything, ""), false);
});

test("a menu key is not a grantable settings tab, and vice versa", () => {
  // The whole point of the split. A menu tick that satisfied
  // `isGrantableReimburseTabKey` would be a way past
  // `requireReimburseSettingsTab` into the configuration routes.
  for (const k of REIMBURSE_MENU_KEYS) {
    assert.equal(isGrantableReimburseTabKey(k), false, `${k} must not be a settings tab`);
  }
  for (const t of GRANTABLE_REIMBURSE_TABS) {
    assert.equal(isReimburseMenuKey(t.key), false, `${t.key} must not be a menu`);
  }
});

test("both vocabularies store, only the right one authorises", () => {
  const mixed = ["rules", "approvalQueue", "access", "nonsense"];
  // `access` is a real tab key but never grantable; `nonsense` is neither.
  assert.deepEqual(filterStorableReimburseKeys(mixed), ["rules", "approvalQueue"]);
  assert.deepEqual(filterGrantableReimburseTabKeys(mixed), ["rules"]);
  assert.deepEqual(filterReimburseMenuKeys(mixed), ["approvalQueue"]);
});

test("an admin sees every menu; a non-admin sees only what is ticked", () => {
  assert.equal(decideReimburseMenuAccess(true, [], "approvalQueue"), true);
  assert.equal(decideReimburseMenuAccess(true, [], "clearance"), true);
  assert.equal(decideReimburseMenuAccess(false, ["approvalQueue"], "approvalQueue"), true);
  assert.equal(decideReimburseMenuAccess(false, ["approvalQueue"], "clearance"), false);
  assert.equal(decideReimburseMenuAccess(false, [], "approvalQueue"), false);
});

test("an unknown menu key is inert even for an admin", () => {
  // The table has no CHECK, so a row naming any string can exist. An admin
  // passing every REAL menu must still not pass a made-up one, or a stray row
  // becomes a capability.
  assert.equal(decideReimburseMenuAccess(true, ["nonsense"], "nonsense"), false);
  assert.equal(decideReimburseMenuAccess(false, ["nonsense"], "nonsense"), false);
});

test("storable keys are de-duplicated and trimmed, in the caller's order", () => {
  assert.deepEqual(
    filterStorableReimburseKeys([" approvalQueue ", "rules", "approvalQueue"]),
    ["approvalQueue", "rules"],
  );
});
