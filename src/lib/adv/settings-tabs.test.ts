import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADVANCE_SETTINGS_TAB_ORDER,
  CLEAR_SETTINGS_TAB_ORDER,
  GRANTABLE_ADV_CLR_TABS,
  ALL_ADV_CLR_TABS,
  ADV_CLR_FORMS,
  ADV_CLR_MENUS,
  advClrMenusForForm,
  advClrTabsForForm,
  filterAdvClrKeysForForm,
  storableAdvClrKeysForForm,
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

/* ── the per-form partition (2026-09-22) ──────────────────────────────────
 *
 * `setAdvClrAccessTabs` bounds its DELETE to `storableAdvClrKeysForForm(form)`,
 * so these are not metadata tests — they are the correctness argument for a
 * statement that deletes live access rows in two databases. The source guard in
 * `access-service-form-scope.test.ts` pins the SQL to this partition; this is
 * where the partition itself is shown to be sound.
 */

test("the two forms own DISJOINT key sets — a save of one cannot reach the other", () => {
  // The property the bounded DELETE rests on. One key in both sets and saving
  // AP-2 silently clears it out of AP-3, which is the whole failure this split
  // was written to prevent.
  const a = storableAdvClrKeysForForm("AP-2");
  const b = storableAdvClrKeysForForm("AP-3");
  for (const key of a) {
    assert.equal(b.indexOf(key), -1, `"${key}" belongs to BOTH forms`);
  }
});

test("the two forms' key sets COVER every storable key", () => {
  // The other half. A storable key owned by neither screen could be granted
  // from nowhere and would survive every save — invisible, and unrevocable
  // through the UI.
  const owned = ADV_CLR_FORMS.reduce<string[]>(
    (acc, form) => acc.concat(storableAdvClrKeysForForm(form)),
    [],
  );
  const everything = filterStorableAdvClrKeys(
    GRANTABLE_ADV_CLR_TABS.map((t) => t.key).concat(ADV_CLR_MENUS.map((m) => m.key)),
  );
  for (const key of everything) {
    assert.ok(owned.indexOf(key) !== -1, `"${key}" is storable but belongs to no form`);
  }
  assert.equal(owned.length, everything.length, "a key is counted twice across the forms");
});

test("neither form owns an EMPTY set", () => {
  // `TabKey IN ()` is a syntax error, and the service's guard against it must
  // stay unreachable rather than becoming the path that silently saves nothing.
  for (const form of ADV_CLR_FORMS) {
    assert.ok(storableAdvClrKeysForForm(form).length > 0, `${form} owns no keys at all`);
  }
});

test("brands belongs to AP-2 alone — one switch, one screen", () => {
  // The user's decision, 2026-09-22. `setBrandActiveShared` MERGEs AccFormBrand
  // for 'AP-2' AND 'AP-3' in one transaction, so a brand is claimable on both
  // forms or neither: splitting the GRANT while the switch stays single would
  // put two people on half a grant over one control.
  assert.ok(storableAdvClrKeysForForm("AP-2").indexOf("brands") !== -1);
  assert.equal(storableAdvClrKeysForForm("AP-3").indexOf("brands"), -1);
  assert.equal(CLEAR_SETTINGS_TAB_ORDER.indexOf("brands" as never), -1, "brands is back on AP-3's strip");
});

test("each form's grid renders exactly its own strip, in the strip's order", () => {
  // Derived rather than declared: if these could disagree, a page would offer a
  // tab its own strip does not have, or hide one it does.
  for (const form of ADV_CLR_FORMS) {
    const strip = form === "AP-2" ? ADVANCE_SETTINGS_TAB_ORDER : CLEAR_SETTINGS_TAB_ORDER;
    assert.deepEqual(
      advClrTabsForForm(form).map((t) => t.key),
      strip.slice(),
      `${form}'s grid does not match its tab strip`,
    );
  }
});

test("the two tabs BOTH pages carry appear on BOTH grids", () => {
  // Interface ERP and สิทธิ์เข้าถึง are ungrantable, so they are on no form's
  // key set — but an admin asking "who may open Interface ERP" must still find
  // the answer on whichever page they are on. That is what ALL_ADV_CLR_TABS is
  // for, and a per-form `form` field would have taken it away from one of them.
  for (const form of ADV_CLR_FORMS) {
    const keys = advClrTabsForForm(form).map((t) => t.key);
    for (const key of ["erpInterface", "access"]) {
      assert.ok(keys.indexOf(key) !== -1, `${form}'s grid does not list ${key}`);
    }
  }
});

test("every menu is claimed by exactly one form", () => {
  for (const m of ADV_CLR_MENUS) {
    const owners = ADV_CLR_FORMS.filter(
      (f) => advClrMenusForForm(f).some((x) => x.key === m.key),
    );
    assert.deepEqual(owners, [m.form], `${m.key} is claimed by ${owners.join("+") || "nobody"}`);
  }
});

test("a form's filter keeps the other form's keys out", () => {
  const mixed = ["banks", "clearQueue", "locations", "advanceReport", "erpInterface", "junk"];
  assert.deepEqual(filterAdvClrKeysForForm(mixed, "AP-2"), ["banks", "advanceReport"]);
  assert.deepEqual(filterAdvClrKeysForForm(mixed, "AP-3"), ["clearQueue", "locations"]);
});

test("saving one form's ticks leaves the other form's grants standing", () => {
  // The model of what `setAdvClrAccessTabs` does: remove this form's keys, put
  // back what was posted, touch nothing else. Run against the SAME partition
  // the bounded DELETE is built from, so the two cannot describe different sets.
  const replace = (held: string[], posted: string[], form: "AP-2" | "AP-3") => {
    const scope = storableAdvClrKeysForForm(form);
    return held
      .filter((k) => scope.indexOf(k) === -1)
      .concat(filterAdvClrKeysForForm(posted, form));
  };

  const held = ["banks", "advanceQueue", "locations", "clearReport"];
  // AP-2's screen drops `banks`, keeps `advanceQueue`...
  assert.deepEqual(replace(held, ["advanceQueue"], "AP-2"), [
    "locations",
    "clearReport",
    "advanceQueue",
  ]);
  // ...and clearing AP-3 entirely still leaves AP-2's two alone.
  assert.deepEqual(replace(held, [], "AP-3"), ["banks", "advanceQueue"]);
  // The old unscoped behaviour — held.filter(() => false) — would have answered
  // ["advanceQueue"] and [] respectively, losing the other form both times.
});

test("a posted key from the other form cannot be written by this form's save", () => {
  // Defence in depth against a stale tab or a replayed POST: the insert list is
  // narrowed too, so a payload cannot add a row the DELETE did not clear.
  assert.deepEqual(filterAdvClrKeysForForm(["clearQueue", "clearReport"], "AP-2"), []);
});

test("grantable and ungrantable partition ALL_ADV_CLR_TABS exactly", () => {
  // Two lists describing one thing; this is what stops them drifting.
  for (const t of ALL_ADV_CLR_TABS) {
    assert.equal(
      isGrantableAdvClrTabKey(t.key),
      !t.adminOnly,
      `${t.key} disagrees between ALL_ADV_CLR_TABS and GRANTABLE_ADV_CLR_TABS`,
    );
  }
  for (const t of GRANTABLE_ADV_CLR_TABS) {
    assert.ok(
      ALL_ADV_CLR_TABS.some((x) => x.key === t.key),
      `${t.key} is grantable but absent from the grid's list`,
    );
  }
});

test("no label carries a form suffix — the heading names the form instead", () => {
  // The consistency rule chosen on 2026-09-22: each grid shows one form under a
  // heading that names it, so "(AP-2)" on every row is noise — and the old
  // "(AP-2 + AP-3)" on brands and erpInterface is now wrong on the very screens
  // that show them. `note` is what carries a fact a label cannot.
  const labels = ALL_ADV_CLR_TABS.map((t) => t.label)
    .concat(GRANTABLE_ADV_CLR_TABS.map((t) => t.label))
    .concat(ADV_CLR_MENUS.map((m) => m.label));
  for (const label of labels) {
    assert.ok(!/AP-[23]/.test(label), `"${label}" names a form the heading already names`);
  }
});
