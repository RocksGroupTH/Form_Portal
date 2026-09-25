import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_REIMBURSE_TABS,
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

test("the strip runs brands, rules, messages, glAccounts, buGlMap, erpInterface, access", () => {
  assert.deepEqual(REIMBURSE_SETTINGS_TAB_ORDER, [
    "brands",
    "rules",
    "messages",
    "glAccounts",
    "buGlMap",
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

test("erpInterface is a real tab and IS grantable since 2026-09-22", () => {
  // It was excluded until that day, and the reason was good: AP-4's own
  // Business Central posting configuration is gated but NOT brand-scoped (see
  // settings-tabs.ts's module docblock), so a holder sets any brand's bank
  // account, Journal Batch and Branch Code. The user was told that and chose
  // to open it — AP-1's identical tab has been grantable all along.
  //
  // Asserted positively, and kept as its own test rather than folded into the
  // list below, because the failure to guard against is a silent REVERSAL: a
  // future edit that "restores" the exclusion would take a capability away
  // that somebody asked for, and a bare list assertion would read as a
  // formatting change in the diff.
  assert.ok(
    REIMBURSE_SETTINGS_TAB_ORDER.indexOf("erpInterface") !== -1,
    "erpInterface is missing from the tab strip",
  );
  assert.equal(isGrantableReimburseTabKey("erpInterface"), true);
  assert.ok(
    GRANTABLE_REIMBURSE_TABS.map((t) => t.key as string).indexOf("erpInterface") !== -1,
    "erpInterface must appear in the grantable list",
  );
  // And a tick has to actually open it, not merely be storable.
  assert.equal(decideReimburseTabAccess(false, ["erpInterface"], "erpInterface"), true);
});

test("the two G/L tabs are grantable too, and they reach AP-3's rows", () => {
  // Same date, same instruction, sharper reason: `AccClearAdvanceGl` /
  // `AccClearAdvanceGlCompany` and `AccClrBuGlMap` / `AccClrBranchGlMap` carry
  // no FormCode, so a grant here is a grant over AP-3's configuration and
  // posting rules. The grid prints that in Thai under the tick, which is what
  // `ALL_REIMBURSE_TABS`' `note` is for.
  for (const key of ["glAccounts", "buGlMap"]) {
    assert.equal(isGrantableReimburseTabKey(key), true, `${key} is not grantable`);
    assert.equal(decideReimburseTabAccess(false, [key], key), true, `${key} did not open`);
  }
});

test("each tab opened on 2026-09-22 states its reach on the grid", () => {
  // The user accepted a widening the codebase had argued against, so the
  // screen must not be silent about it. `note` is printed under the table;
  // `adminOnly` is a different field and must stay one — collapsing the two
  // either hides the warning or withdraws the grant.
  const byKey = (k: string) => ALL_REIMBURSE_TABS.filter((t) => t.key === k)[0];
  for (const key of ["erpInterface", "glAccounts", "buGlMap"]) {
    const entry = byKey(key);
    assert.ok(entry, `${key} is not in ALL_REIMBURSE_TABS`);
    assert.ok(entry.note && entry.note.trim().length > 0, `${key} carries no note`);
    assert.equal(entry.adminOnly, undefined, `${key} is still marked adminOnly`);
  }
  assert.ok(
    (byKey("erpInterface").note ?? "").indexOf("ทุกแบรนด์") !== -1,
    "Interface ERP's note does not say it reaches every brand",
  );
  for (const key of ["glAccounts", "buGlMap"]) {
    assert.ok((byKey(key).note ?? "").indexOf("AP-3") !== -1, `${key}'s note does not name AP-3`);
  }
  // `access` is the other way round: no note, and the reason it can never be
  // ticked. The grid drops it from the columns and names it under the table.
  assert.ok(byKey("access").adminOnly, "access lost its adminOnly reason");
  assert.equal(byKey("access").note, undefined, "access carries a note as if it were grantable");
});

/* ── what may be ticked ── */

test("every tab but access and messages is grantable, in page order", () => {
  // Page order, not declaration order: the checkbox columns follow the strip,
  // so reordering the strip reorders the columns with it. `messages` sits
  // between `rules` and `glAccounts` on the strip but is absent here — it is
  // admin-only because the grant could not be stored (ACC Portal rewrites
  // AccApproverSettingsTab through its own key filter), not because it is
  // dangerous.
  assert.deepEqual(GRANTABLE_REIMBURSE_TABS.map((t) => t.key), [
    "brands",
    "rules",
    "glAccounts",
    "buGlMap",
    "erpInterface",
  ]);
  assert.deepEqual(GRANTABLE_REIMBURSE_TABS.map((t) => t.label), [
    "แบรนด์ที่เบิกได้",
    "ระเบียบการจ่าย",
    "หมวดบัญชี G/L",
    "Fix G/L by BU or Branch",
    "Interface ERP",
  ]);
  assert.deepEqual(
    GRANTABLE_REIMBURSE_TABS.map((t) => t.key),
    REIMBURSE_SETTINGS_TAB_ORDER.filter((k) => k !== "access" && k !== "messages"),
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

test("messages is never grantable, for a different reason from access", () => {
  // Not because a message is dangerous — it grants nothing, decides no
  // approval, no posting target and no read. It is admin-only because the
  // grant could not be STORED: `AccReimburseAccessTab` is a table shared in
  // shape with `AccApproverSettingsTab`, and ACC Portal's own save rewrites
  // that table through its own key filter, which has never heard of
  // `messages`. A grant would silently vanish the next time somebody edited
  // that person's tabs over there — the exact defect 8a3ab358 fixed for
  // AP-17's menu ticks.
  assert.equal(isGrantableReimburseTabKey("messages"), false);
  assert.equal(decideReimburseTabAccess(false, ["messages"], "messages"), false);
  assert.ok(
    GRANTABLE_REIMBURSE_TABS.map((t) => t.key as string).indexOf("messages") === -1,
    "messages must not appear in the grantable list",
  );
  // An admin still opens it — the tab exists, it is just never handed out.
  assert.equal(decideReimburseTabAccess(true, [], "messages"), true);
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
  assert.equal(decideReimburseMenuAccess(false, ["approvalQueue"], "approvalQueue"), true);
  assert.equal(decideReimburseMenuAccess(false, [], "approvalQueue"), false);
  // `clearance` was a menu key until 2026-09-14 and is now unknown, so it is
  // inert even for an admin and even where a stored row still names it — the
  // same answer any other made-up key gets.
  assert.equal(decideReimburseMenuAccess(true, [], "clearance"), false);
  assert.equal(decideReimburseMenuAccess(false, ["clearance"], "clearance"), false);
  assert.deepEqual(filterStorableReimburseKeys(["clearance", "approvalQueue"]), ["approvalQueue"]);
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
