import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADVANCE_SETTINGS_TAB_ORDER,
  CLEAR_SETTINGS_TAB_ORDER,
  GRANTABLE_ADV_CLR_TABS,
  ADV_CLR_MENUS,
  isGrantableAdvClrTabKey,
  isAdvClrMenuKey,
  filterGrantableAdvClrTabKeys,
  filterAdvClrMenuKeys,
  filterStorableAdvClrKeys,
  decideAdvClrTabAccess,
  decideAdvClrMenuAccess,
} from "./settings-tabs";

/* ── the two vocabularies must not overlap ── */

test("no key is both a settings tab and a menu", () => {
  // The whole gate rests on this: a menu key that satisfied the grantable test
  // would be a way past requireAdvClrSettingsTab into the configuration routes,
  // which is exactly how AP-17's own menu ticks once went wrong.
  for (const m of ADV_CLR_MENUS) {
    assert.equal(isGrantableAdvClrTabKey(m.key), false, `${m.key} is grantable as a tab`);
  }
  for (const t of GRANTABLE_ADV_CLR_TABS) {
    assert.equal(isAdvClrMenuKey(t.key), false, `${t.key} is a menu key`);
  }
});

test("access and erpInterface are not grantable on either form", () => {
  // access hands out power — and here it also edits both approver pools.
  // erpInterface is gated but not brand-scoped, so a grant would reach every
  // brand's posting configuration.
  for (const key of ["access", "erpInterface"]) {
    assert.equal(isGrantableAdvClrTabKey(key), false, `${key} became grantable`);
    assert.equal(decideAdvClrTabAccess(false, [key], key), false, `${key} opened on a stored row`);
  }
});

test("AP-3's own G/L tabs are not grantable — the rows belong to another form", () => {
  // AccClearAdvanceGl / AccClrBuGlMap are shared with AP-4 and carry no
  // FormCode, so a grant here would be a grant over another form's rules.
  for (const key of ["glAccounts", "buGlMap"]) {
    assert.equal(isGrantableAdvClrTabKey(key), false, `${key} became grantable`);
  }
});

test("every grantable key really is a tab on one of the two strips", () => {
  const all = [...ADVANCE_SETTINGS_TAB_ORDER, ...CLEAR_SETTINGS_TAB_ORDER] as string[];
  for (const t of GRANTABLE_ADV_CLR_TABS) {
    assert.ok(all.indexOf(t.key) !== -1, `${t.key} is grantable but on no strip`);
  }
});

test("both strips end on access", () => {
  assert.equal(ADVANCE_SETTINGS_TAB_ORDER[ADVANCE_SETTINGS_TAB_ORDER.length - 1], "access");
  assert.equal(CLEAR_SETTINGS_TAB_ORDER[CLEAR_SETTINGS_TAB_ORDER.length - 1], "access");
});

/* ── filters ── */

test("filters drop unknown keys, trim, and de-duplicate in the caller's order", () => {
  assert.deepEqual(
    filterGrantableAdvClrTabKeys([" banks ", "nope", "banks", "brands"]),
    ["banks", "brands"],
  );
  assert.deepEqual(filterAdvClrMenuKeys(["clearQueue", "access", "clearQueue"]), ["clearQueue"]);
});

test("storage takes the union of grantable tabs and menus, and nothing else", () => {
  assert.deepEqual(
    filterStorableAdvClrKeys(["brands", "clearReport", "access", "erpInterface", "made-up"]),
    ["brands", "clearReport"],
  );
});

/* ── the decisions ── */

test("an admin opens every tab, including the ungrantable ones", () => {
  for (const key of [...ADVANCE_SETTINGS_TAB_ORDER, ...CLEAR_SETTINGS_TAB_ORDER]) {
    assert.equal(decideAdvClrTabAccess(true, [], key), true, `admin refused ${key}`);
  }
});

test("a non-admin opens only what is both grantable and theirs", () => {
  assert.equal(decideAdvClrMenuAccess(false, ["advanceQueue"], "advanceQueue"), true);
  assert.equal(decideAdvClrMenuAccess(false, ["advanceQueue"], "clearQueue"), false);
  assert.equal(decideAdvClrTabAccess(false, ["banks"], "banks"), true);
  assert.equal(decideAdvClrTabAccess(false, ["banks"], "matrix"), false);
});

test("an admin passes every REAL menu and no made-up one", () => {
  // The table has no CHECK, so a typo in a stray row must not become a
  // capability just because the caller happens to be an admin.
  for (const m of ADV_CLR_MENUS) assert.equal(decideAdvClrMenuAccess(true, [], m.key), true);
  assert.equal(decideAdvClrMenuAccess(true, [], "advanceQuue"), false);
  assert.equal(decideAdvClrMenuAccess(true, [], ""), false);
});

test("membership alone grants nothing", () => {
  // Somebody added to the roster and left with no ticks has exactly the access
  // they had before, which is what makes an empty table a neutral state.
  assert.equal(decideAdvClrTabAccess(false, [], "banks"), false);
  assert.equal(decideAdvClrMenuAccess(false, [], "advanceQueue"), false);
});
