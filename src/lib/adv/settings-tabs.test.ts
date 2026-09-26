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

test("access, advanceMessages and clearMessages are the only settings tabs that can never be granted", () => {
  // `access` hands out power — and here it also edits both approver pools.
  // The two Message tabs are excluded for an unrelated reason: the grant
  // could not be STORED. `AccAdvClrAccessTab` is a table shared in shape with
  // AP-1's `AccApproverSettingsTab`, and ACC Portal's own save rewrites that
  // table through its own key filter, which has never heard of either key. A
  // grant would silently vanish the next time somebody edited that person's
  // tabs over there — the exact defect 8a3ab358 fixed for AP-17's menu ticks.
  const neverGrantable = ["access", "advanceMessages", "clearMessages"];
  for (const key of neverGrantable) {
    assert.equal(isGrantableAdvClrTabKey(key), false, `${key} became grantable`);
    assert.equal(
      decideAdvClrTabAccess(false, [key], key),
      false,
      `${key} opened on a stored row`,
    );
    // An admin still opens it — the tab exists, it is just never handed out.
    assert.equal(decideAdvClrTabAccess(true, [], key), true, `${key} refused an admin`);
  }
  // Nothing else on either strip is excluded any more. Written as a sweep
  // rather than a list so a new ungrantable tab has to be argued for here.
  const strips = [...ADVANCE_SETTINGS_TAB_ORDER, ...CLEAR_SETTINGS_TAB_ORDER] as string[];
  for (const key of strips) {
    if (neverGrantable.indexOf(key) !== -1) continue;
    assert.equal(isGrantableAdvClrTabKey(key), true, `${key} is on a strip but ungrantable`);
  }
});

test("the three tabs opened on 2026-09-22 really are tickable", () => {
  // The user's instruction, taken with the reach stated to them first: Interface
  // ERP is not brand-scoped, and glAccounts / buGlMap edit rows AP-4 shares.
  // Asserted positively because the failure to guard against is a silent
  // REVERSAL — a route left on requireRole plus a key quietly dropped from the
  // grantable list reads as "this was never opened".
  for (const key of ["advanceErpInterface", "clearErpInterface", "glAccounts", "buGlMap"]) {
    assert.equal(isGrantableAdvClrTabKey(key), true, `${key} is not grantable`);
    assert.equal(decideAdvClrTabAccess(false, [key], key), true, `${key} did not open on its grant`);
  }
});

test("the bare `erpInterface` key is dead — it is neither strip's, and inert", () => {
  // One shared key was safe only while it was ungrantable. A tickable one would
  // sit in BOTH forms' storable sets and take away the disjointness the bounded
  // DELETE rests on, so the strips carry a key each. A row written before that
  // still names the old key; it must grant nothing rather than grant both.
  assert.equal(isGrantableAdvClrTabKey("erpInterface"), false);
  assert.equal(decideAdvClrTabAccess(false, ["erpInterface"], "erpInterface"), false);
  assert.equal(decideAdvClrTabAccess(false, ["erpInterface"], "advanceErpInterface"), false);
  assert.equal(decideAdvClrTabAccess(false, ["erpInterface"], "clearErpInterface"), false);
  assert.deepEqual(filterStorableAdvClrKeys(["erpInterface"]), []);
});

test("one form's Interface ERP grant does not open the other form's", () => {
  // The whole reason the key is per form. AP-2's tab writes AccBrandBankAccount
  // / AccBrandJournalBatch / AccBrandBranchCode for AP-2; AP-3's writes its own
  // Journal Batch and two tax accounts. Different rows, different routes.
  assert.equal(decideAdvClrTabAccess(false, ["advanceErpInterface"], "clearErpInterface"), false);
  assert.equal(decideAdvClrTabAccess(false, ["clearErpInterface"], "advanceErpInterface"), false);
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
  // `access` is a real tab key and still never storable; `erpInterface` is the
  // retired shared key and is now simply unknown, which is why the two live
  // ones are in the same call — a filter that dropped them all alike would
  // read as passing while the whole change had been reverted.
  assert.deepEqual(
    filterStorableAdvClrKeys([
      "brands",
      "clearReport",
      "access",
      "erpInterface",
      "advanceErpInterface",
      "clearErpInterface",
      "buGlMap",
      "made-up",
    ]),
    ["brands", "clearReport", "advanceErpInterface", "clearErpInterface", "buGlMap"],
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

test("สิทธิ์เข้าถึง is listed on BOTH grids, and each form's Interface ERP on its own", () => {
  // `access` is ungrantable, so it is on no form's key set — but an admin
  // asking "who may open it" must still find the answer on whichever page they
  // are on, which is what ALL_ADV_CLR_TABS is for. Interface ERP is on both
  // PAGES and must NOT be one key: each form's grid lists its own and not the
  // other's, or the two grids would tick one another's grant.
  for (const form of ADV_CLR_FORMS) {
    const keys = advClrTabsForForm(form).map((t) => t.key);
    assert.ok(keys.indexOf("access") !== -1, `${form}'s grid does not list access`);
    const mine = form === "AP-2" ? "advanceErpInterface" : "clearErpInterface";
    const theirs = form === "AP-2" ? "clearErpInterface" : "advanceErpInterface";
    assert.ok(keys.indexOf(mine) !== -1, `${form}'s grid does not list ${mine}`);
    assert.equal(keys.indexOf(theirs), -1, `${form}'s grid lists ${theirs}`);
    // Both render the same words, which is what makes the split invisible to a
    // reader and is why the KEY is the thing tested rather than the label.
    const label = advClrTabsForForm(form).filter((t) => t.key === mine)[0]?.label;
    assert.equal(label, "Interface ERP", `${form}'s Interface ERP tab is labelled "${label}"`);
  }
});

test("every tab opened on 2026-09-22 states its reach on the grid", () => {
  // The user accepted a widening the codebase had argued against, so the screen
  // must not be silent about it: `note` is printed under the table. A tick made
  // without reading what it reaches is the failure this guards.
  const noted = ["advanceErpInterface", "clearErpInterface", "glAccounts", "buGlMap"];
  for (const key of noted) {
    const entry = ALL_ADV_CLR_TABS.filter((t) => t.key === key)[0];
    assert.ok(entry, `${key} is not in ALL_ADV_CLR_TABS`);
    assert.ok(entry.note && entry.note.trim().length > 0, `${key} carries no note`);
  }
  // Interface ERP's says it is not brand-scoped; the two G/L tabs' say the rows
  // are AP-4's too. Both facts, not both wordings — the assertion is on the
  // fact each note has to carry.
  for (const key of ["advanceErpInterface", "clearErpInterface"]) {
    const note = ALL_ADV_CLR_TABS.filter((t) => t.key === key)[0].note ?? "";
    assert.ok(note.indexOf("ทุกแบรนด์") !== -1, `${key}'s note does not say it reaches every brand`);
  }
  for (const key of ["glAccounts", "buGlMap"]) {
    const note = ALL_ADV_CLR_TABS.filter((t) => t.key === key)[0].note ?? "";
    assert.ok(note.indexOf("AP-4") !== -1, `${key}'s note does not name AP-4`);
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
  // Both Interface ERP keys are in the list on purpose: this is the assertion
  // that would have gone red had they stayed one shared key, because a single
  // `erpInterface` would come out of BOTH filters.
  const mixed = [
    "banks",
    "clearQueue",
    "glAccounts",
    "locations",
    "advanceReport",
    "advanceErpInterface",
    "clearErpInterface",
    "erpInterface",
    "junk",
  ];
  assert.deepEqual(filterAdvClrKeysForForm(mixed, "AP-2"), [
    "banks",
    "advanceReport",
    "advanceErpInterface",
  ]);
  assert.deepEqual(filterAdvClrKeysForForm(mixed, "AP-3"), [
    "clearQueue",
    "glAccounts",
    "locations",
    "clearErpInterface",
  ]);
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
  //
  // **`advanceMessages` / `clearMessages` are the one deliberate exception,
  // since migration 166.** They carry neither `adminOnly` NOR grantable
  // TabKey status: the Message tab genuinely is grantable now, just through a
  // COLUMN (`AccAdvClrAccess.CanAdvanceMessage` / `.CanClearMessage`) that
  // `AdvClrAccessSettings.tsx` renders with its own bespoke `MessageGrantCell`
  // rather than through this `TabKey` vocabulary at all — see
  // `@/lib/acc/message-grant`. The invariant this test polices — "not
  // adminOnly implies grantable here" — is exactly what would let a message
  // key slip back into `tabs` and render a tick that never saves, so the
  // exclusion is narrow and named rather than a blanket skip.
  const MESSAGE_KEYS = ["advanceMessages", "clearMessages"];
  for (const t of ALL_ADV_CLR_TABS) {
    if (MESSAGE_KEYS.indexOf(t.key) !== -1) continue;
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

test("the message keys are neither adminOnly nor TabKey-grantable — they are column-backed", () => {
  for (const key of ["advanceMessages", "clearMessages"]) {
    const entry = ALL_ADV_CLR_TABS.find((t) => t.key === key);
    assert.ok(entry, `${key} is missing from ALL_ADV_CLR_TABS`);
    assert.equal(entry!.adminOnly, undefined, `${key} still claims to be admin-only`);
    assert.equal(entry!.note, undefined, `${key} carries a note meant for a TabKey column it no longer has`);
    assert.equal(
      isGrantableAdvClrTabKey(key),
      false,
      `${key} must stay out of the TabKey grantable list — its grant is a column`,
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
