/**
 * Which AP-2 / AP-3 settings tabs and working menus an admin may hand to an
 * individual person, and the rules that decide whether one may be opened.
 *
 * The AP-4 counterpart (`@/lib/acc/reimburse/settings-tabs`) is the shape being
 * copied, which is itself AP-17's. Three things about this one differ and each
 * is worth reading before editing the file.
 *
 * **One roster spans BOTH forms, but each form is now GRANTED on its own
 * screen.** `AccAdvClrAccess` (migration 152) carries no `FormCode`: one row
 * per person, shared. What changed on 2026-09-22 (user: *"สิทธิ์เข้าถึง AP-2
 * จะใช้แค่ AP-2 เท่านั้น และ สิทธิ์เข้าถึง AP-3 ก็ใช้แค่ AP-3 เท่านั้น"*) is that
 * the สิทธิ์เข้าถึง grid on each settings page now shows and saves only that
 * form's keys. The keys always named their form; the screen did not.
 *
 * **Which form a key belongs to is DERIVED from the two strips below, never
 * declared a second time.** A tab belongs to AP-2's screen exactly when it is
 * in `ADVANCE_SETTINGS_TAB_ORDER`, and the pages build their own tab strips
 * from those same two arrays — so the grid, the strip and the form-scoped save
 * cannot drift apart. A `form` field beside each tab would be a second
 * statement of a fact these arrays already make. Menus have no strip, so they
 * carry the field themselves.
 *
 * **`brands` is AP-2's alone** (user, 2026-09-22), and that is a decision about
 * the *storage* rather than about the screen: `setBrandActiveShared` MERGEs
 * `AccFormBrand` for `'AP-2'` and `'AP-3'` in one transaction, so a brand is
 * claimable on both forms or neither. Splitting the grant while the switch
 * stays single would put two people on half a grant over one control. It lives
 * on AP-2's page, and AP-3's page says where it went.
 *
 * **The approver rosters did not merge, only the screen did.**
 * `AccAdvanceApprover` and `AccClearAdvanceApprover` are the pools that take
 * real approval steps; being on one means approving money. They keep their own
 * tables and their own editors, now rendered on the สิทธิ์เข้าถึง tab beside
 * this grid rather than on a tab called ผู้อนุมัติ. Ticking a settings tab
 * grants no approval and joining an approver pool grants no settings tab —
 * exactly the split migration 120 exists for on AP-4.
 *
 * **Only `access` can never be granted.** Whoever opens it can grant themselves
 * the rest, and here it also edits both approver pools. Its route stays
 * `requireRole` on every method.
 *
 * **`erpInterface`, `glAccounts` and `buGlMap` became grantable on 2026-09-22**
 * (user: *"ของ AP-3,4 ก็ต้อง เปิด check box ทุกอันและตัดช่อง สิทธิ์เข้าถึง
 * ออกเหมือนกัน"*). Both risks were put to them before the change and accepted
 * rather than overlooked, which is why this reads as a decision rather than a
 * gap:
 *
 * - **Interface ERP is gated but NOT brand-scoped.** A holder can set **any**
 *   brand's bank account, Journal Batch and Branch Code — the values every
 *   journal line carries — not only the brands they approve for. That is the
 *   gap CLAUDE.md records for AP-1's `gl-accounts` / `bank-accounts` /
 *   `journal-batches` / `branch-codes` routes, now deliberately handed out.
 * - **`glAccounts` and `buGlMap` edit rows that carry no `FormCode`.**
 *   `AccClearAdvanceGl` / `AccClearAdvanceGlCompany` and `AccClrBuGlMap` /
 *   `AccClrBranchGlMap` are one set of rules serving AP-3 **and** AP-4, so a
 *   grant on this page reaches AP-4's posting rules too.
 *
 * Each of the three carries a `note` below, printed under the grid, so the
 * admin ticking the box reads the reach rather than discovering it.
 *
 * **Interface ERP therefore needs a key per FORM, and that is not cosmetic.**
 * `erpInterface` sat on both strips while it was ungrantable, which was safe
 * exactly because an ungrantable key is on no form's storable set. The moment
 * it became tickable it would have been owned by both forms, and
 * `storableAdvClrKeysForForm`'s **disjointness** — the property the bounded
 * DELETE in `setAdvClrAccessTabs` rests on — would have gone with it: a save
 * from AP-2's grid would have cleared AP-3's Interface ERP grant. So the strips
 * carry `advanceErpInterface` and `clearErpInterface`, which is also the truer
 * statement of what they are: two tabs configuring different rows through
 * different routes. Both pages still accept a legacy `?tab=erpInterface`.
 *
 * That exclusion is not a database constraint. `AccAdvClrAccessTab` has no CHECK
 * on `TabKey` and is writable from more than one place, so a row naming any
 * string can appear; `decideAdvClrTabAccess` refusing it is what makes that
 * inert — and the same freedom is what lets the menu vocabulary share the
 * column with no migration of its own.
 *
 * This module imports nothing, so it is unit-tested without a database:
 * anything reachable from a pool drags `@/env` in, which validates the whole
 * environment at import time and throws in the test runner.
 */

/* ── the two forms ────────────────────────────────────────────────────── */

/** The two forms this roster covers. One screen each since 2026-09-22. */
export const ADV_CLR_FORMS = ["AP-2", "AP-3"] as const;

export type AdvClrForm = (typeof ADV_CLR_FORMS)[number];

/* ── AP-2's settings tabs ─────────────────────────────────────────────── */

/**
 * Every tab AP-2's settings page shows, in the order it shows them.
 *
 * `access` last, as on all three sibling forms — it is where power is handed
 * out, and it reads as the end of the strip rather than the start of it.
 */
export const ADVANCE_SETTINGS_TAB_ORDER = [
  "brands",
  "matrix",
  "banks",
  "advanceMessages",
  // `advanceErpInterface`, not `erpInterface` — see the module docblock. One
  // key on both strips was safe only while it was ungrantable; a tickable one
  // would be owned by both forms and break the bounded save's disjointness.
  // The page still answers `?tab=erpInterface`.
  "advanceErpInterface",
  "access",
] as const;

export type AdvanceSettingsTabKey = (typeof ADVANCE_SETTINGS_TAB_ORDER)[number];

/* ── AP-3's settings tabs ─────────────────────────────────────────────── */

/**
 * Every tab AP-3's settings page shows, in the order it shows them.
 *
 * **No `brands`, since 2026-09-22.** It moved to AP-2's page alone (the
 * user's decision) because the switch behind it is single:
 * `setBrandActiveShared` writes `AccFormBrand` for both codes in one
 * transaction, so two screens over it would be two controls over one row.
 * AP-3's settings page renders a line saying where it went — a control that
 * vanishes with no explanation reads as a lost permission.
 */
export const CLEAR_SETTINGS_TAB_ORDER = [
  "glAccounts",
  "buGlMap",
  "locations",
  "clearMessages",
  // `clearErpInterface` — AP-2's twin above says why. The page still answers
  // `?tab=erpInterface`.
  "clearErpInterface",
  "access",
] as const;

export type ClearSettingsTabKey = (typeof CLEAR_SETTINGS_TAB_ORDER)[number];

/* ── what may be ticked ───────────────────────────────────────────────── */

/**
 * The settings tabs an admin can hand over, across both forms.
 *
 * Still the union of both strips, because `/api/request/advance/access`
 * answers one map of every key and each page asks it only about its own; which
 * form a key belongs to is read off the strips, not from this list.
 *
 * `brands` appears once because there is one switch behind it — and since
 * 2026-09-22 that switch is reached from AP-2's page alone.
 *
 * **`glAccounts`, `buGlMap` and both Interface ERP keys joined this list on
 * 2026-09-22**, on the user's instruction and with the reach spelled out to
 * them first — see the module docblock. `access` is the only settings tab left
 * off it, and the only one whose routes stay `requireRole`.
 *
 * Interface ERP is TWO entries because it is two tabs over two sets of rows;
 * a single shared key would break the per-form partition the bounded save
 * rests on.
 */
export const GRANTABLE_ADV_CLR_TABS: readonly { key: string; label: string }[] = [
  { key: "brands", label: "แบรนด์ที่เบิกได้" },
  { key: "matrix", label: "ขั้นตามเงิน" },
  { key: "banks", label: "ธนาคาร Master" },
  { key: "advanceErpInterface", label: "Interface ERP" },
  { key: "glAccounts", label: "หมวดบัญชี G/L" },
  { key: "buGlMap", label: "Fix G/L by BU or Branch" },
  { key: "locations", label: "Location / BU" },
  { key: "clearErpInterface", label: "Interface ERP" },
];

/**
 * Every settings tab across BOTH strips, in order, with its label and whether
 * it can be handed to an individual.
 *
 * **The สิทธิ์เข้าถึง grid renders all of them** (user, 2026-09-14), the four
 * ungrantable ones as a disabled box carrying the reason — more honest than
 * omitting them, since an admin looking for "who may open Interface ERP"
 * should find the answer here rather than conclude the tab is missing. It
 * changes nothing about what may be stored or opened:
 * `filterStorableAdvClrKeys` still refuses to write them and
 * `decideAdvClrTabAccess` still refuses to open them for a non-admin.
 *
 * **No form suffix on any label**, since 2026-09-22: each grid renders one
 * form's tabs under a heading that names it, so `(AP-2)` on every row would be
 * noise — and `(AP-2 + AP-3)` on `brands` and `erpInterface` would now be
 * wrong on the very screens that show them. `note` carries what a suffix
 * cannot: `brands` really does reach both forms' claimable brands, from AP-2's
 * page, and that has to be readable before it is ticked.
 *
 * **`access` is on BOTH strips and deliberately stays there.** It is the one
 * tab every page has under one key, so both grids' source lists carry it —
 * the grid itself then drops it as ungrantable, and the line under the table
 * names it instead, which is what keeps an admin from concluding the tab is
 * missing.
 *
 * **Interface ERP is TWO entries carrying ONE label.** Both pages have the
 * tab; the keys differ because the grants do (see the module docblock). The
 * label is deliberately identical — it is the same screen to a reader, and
 * each grid shows one form under a heading that names it.
 */
export const ALL_ADV_CLR_TABS: readonly {
  key: string;
  label: string;
  /** Set when the tab can never be granted; the text says why. */
  adminOnly?: string;
  /** A fact about the tab a one-form label cannot carry. */
  note?: string;
}[] = [
  {
    key: "brands",
    label: "แบรนด์ที่เบิกได้",
    note: "สวิตช์เดียว — เปิด/ปิดแบรนด์มีผลทั้ง AP-2 และ AP-3",
  },
  { key: "matrix", label: "ขั้นตามเงิน" },
  { key: "banks", label: "ธนาคาร Master" },
  // Neither `adminOnly` nor `note`: since migration 166 this tab is granted
  // through its own COLUMN (`AccAdvClrAccess.CanAdvanceMessage`), not through
  // this table's `TabKey` vocabulary at all — so `AdvClrAccessSettings.tsx`
  // excludes it explicitly from both `tabs` and `adminOnlyTabs` and renders it
  // through its own bespoke `MessageGrantCell` instead. See
  // `@/lib/acc/message-grant`.
  { key: "advanceMessages", label: "Message" },
  {
    key: "advanceErpInterface",
    label: "Interface ERP",
    note: "ตั้งค่าบัญชีธนาคาร Journal Batch และ Branch Code ได้ทุกแบรนด์ ไม่จำกัดเฉพาะแบรนด์ที่ตนอนุมัติ",
  },
  {
    key: "glAccounts",
    label: "หมวดบัญชี G/L",
    note: "เป็นข้อมูลชุดเดียวกับ AP-4 — แก้ที่นี่มีผลกับทั้งสองฟอร์ม",
  },
  {
    key: "buGlMap",
    label: "Fix G/L by BU or Branch",
    note: "เป็นกฎชุดเดียวกับ AP-4 — แก้ที่นี่มีผลกับทั้งสองฟอร์ม",
  },
  { key: "locations", label: "Location / BU" },
  // Same rule as `advanceMessages` above, for AP-3's `CanClearMessage`.
  { key: "clearMessages", label: "Message" },
  {
    key: "clearErpInterface",
    label: "Interface ERP",
    note: "ตั้งค่าบัญชีธนาคาร Journal Batch และ Branch Code ได้ทุกแบรนด์ ไม่จำกัดเฉพาะแบรนด์ที่ตนอนุมัติ",
  },
  { key: "access", label: "สิทธิ์เข้าถึง", adminOnly: "หน้านี้เอง — ให้สิทธิ์ตัวเองต่อได้" },
];

export function isGrantableAdvClrTabKey(key: string): boolean {
  const k = String(key).trim();
  for (const t of GRANTABLE_ADV_CLR_TABS) if (t.key === k) return true;
  return false;
}

/** Keep only known keys, trimmed, de-duplicated, in the caller's order. */
export function filterGrantableAdvClrTabKeys(keys: string[]): string[] {
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (const raw of keys) {
    const k = String(raw).trim();
    if (isGrantableAdvClrTabKey(k) && !seen[k]) {
      seen[k] = true;
      out.push(k);
    }
  }
  return out;
}

/* ── the MENU vocabulary ──────────────────────────────────────────────── */

/**
 * A second set of keys in the same `AccAdvClrAccessTab.TabKey` column, and
 * keeping the two apart is the design rather than an accident of naming. A tab
 * key grants sight of a CONFIGURATION screen; a menu key grants sight of a
 * WORKING screen. `requireAdvClrSettingsTab` gates the first, so a menu key
 * that satisfied `isGrantableAdvClrTabKey` would be a way into the settings
 * routes — which is why that function must go on refusing these.
 *
 * The keys name their form even though the roster does not, because AP-2's
 * queue and AP-3's queue are two different jobs.
 *
 * **These carry `form` themselves**, unlike the settings tabs, and the
 * asymmetry is not an oversight: a settings tab's form is already stated by
 * which strip it is on, and a menu has no strip to read it off.
 *
 * Labels lost their `(AP-2)` / `(AP-3)` suffix on 2026-09-22 — each grid shows
 * one form under a heading that names it.
 */
export const ADV_CLR_MENUS: readonly { key: string; label: string; form: AdvClrForm }[] = [
  { key: "advanceQueue", label: "รออนุมัติ", form: "AP-2" },
  { key: "advanceReport", label: "รายงาน", form: "AP-2" },
  { key: "clearQueue", label: "รออนุมัติ", form: "AP-3" },
  { key: "clearReport", label: "รายงาน Control / Detail", form: "AP-3" },
];

export function isAdvClrMenuKey(key: string): boolean {
  const k = String(key).trim();
  for (const m of ADV_CLR_MENUS) if (m.key === k) return true;
  return false;
}

/** Keep only known MENU keys, trimmed, de-duplicated, in the caller's order. */
export function filterAdvClrMenuKeys(keys: string[]): string[] {
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (const raw of keys) {
    const k = String(raw).trim();
    if (isAdvClrMenuKey(k) && !seen[k]) {
      seen[k] = true;
      out.push(k);
    }
  }
  return out;
}

/**
 * Everything that may be STORED in `AccAdvClrAccessTab` — **GRANTABLE tabs ∪
 * menus**, not every settings tab. `access` is excluded here as well as from
 * `decideAdvClrTabAccess`, so a row naming it can never be written in the
 * first place. The bare `erpInterface` a pre-2026-09-22 row may still hold is
 * excluded by the same test, for a duller reason — it is no longer a key this
 * module knows at all, the two live ones being `advanceErpInterface` and
 * `clearErpInterface`.
 *
 * Storage takes that union; authorization keeps the narrow filters. Before
 * AP-17 drew this distinction its menu ticks were dropped on read AND on write,
 * so ticking one saved nothing at all and the bug looked like a UI fault.
 */
export function filterStorableAdvClrKeys(keys: string[]): string[] {
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (const raw of keys) {
    const k = String(raw).trim();
    if ((isGrantableAdvClrTabKey(k) || isAdvClrMenuKey(k)) && !seen[k]) {
      seen[k] = true;
      out.push(k);
    }
  }
  return out;
}

/* ── one form's half of all of that ───────────────────────────────────── */

/** That form's own tab strip. */
function stripFor(form: AdvClrForm): readonly string[] {
  return form === "AP-2" ? ADVANCE_SETTINGS_TAB_ORDER : CLEAR_SETTINGS_TAB_ORDER;
}

/**
 * Every settings tab on this form's page, in that page's own order, grantable
 * and ungrantable alike — what its สิทธิ์เข้าถึง grid renders.
 *
 * Derived from the strip rather than from a `form` field, so the grid can never
 * list a tab the page does not have or miss one it does.
 */
export function advClrTabsForForm(
  form: AdvClrForm,
): readonly { key: string; label: string; adminOnly?: string; note?: string }[] {
  const out: { key: string; label: string; adminOnly?: string; note?: string }[] = [];
  for (const key of stripFor(form)) {
    for (const t of ALL_ADV_CLR_TABS) if (t.key === key) out.push(t);
  }
  return out;
}

/** Every working menu belonging to this form, in declaration order. */
export function advClrMenusForForm(
  form: AdvClrForm,
): readonly { key: string; label: string; form: AdvClrForm }[] {
  return ADV_CLR_MENUS.filter((m) => m.form === form);
}

/**
 * Every key this form's สิทธิ์เข้าถึง screen owns — **the exact set a save of
 * that form may add or remove, and nothing else.**
 *
 * This is the partition the form-scoped write rests on, which is why it is
 * derived here rather than retyped beside the SQL. Two properties must hold and
 * `settings-tabs.test.ts` asserts both: the two forms' sets are **disjoint**,
 * or a save of one would reach into the other; and together they **cover**
 * every storable key, or a key would belong to no screen and could be granted
 * from nowhere while surviving every save.
 *
 * Ungrantable tabs are absent because they are unstorable —
 * `filterStorableAdvClrKeys` refuses them — so `access` being on both strips
 * creates no overlap here. **Interface ERP is grantable and IS on both pages,
 * which is exactly why its key is per form**: one shared key would put it in
 * both sets and take the disjointness away.
 */
export function storableAdvClrKeysForForm(form: AdvClrForm): string[] {
  const out: string[] = [];
  for (const key of stripFor(form)) if (isGrantableAdvClrTabKey(key)) out.push(key);
  for (const m of advClrMenusForForm(form)) out.push(m.key);
  return out;
}

/**
 * Keep only the keys this form owns — what a save of that form writes back.
 *
 * Narrower than `filterStorableAdvClrKeys` on purpose: **what may be STORED in
 * the shared table is still both forms' keys**, because the table is shared.
 * What is form-scoped is the screen and the replace.
 */
export function filterAdvClrKeysForForm(keys: string[], form: AdvClrForm): string[] {
  const mine = storableAdvClrKeysForForm(form);
  return filterStorableAdvClrKeys(keys).filter((k) => mine.indexOf(k) !== -1);
}

/* ── the decisions ────────────────────────────────────────────────────── */

/**
 * May this caller open this AP-2 / AP-3 settings tab?
 *
 * - an admin passes everything, `access` included — that is the role the grants
 *   are handed out from, and locking an admin out of the tab that grants access
 *   would leave nobody able to grant it;
 * - a non-admin passes only a tab that is *both* grantable and in their list, so
 *   `access` fails **even if a row for it exists** — and so does the bare
 *   `erpInterface` a row written before 2026-09-22 may still carry, which is
 *   no longer a key this module knows.
 */
export function decideAdvClrTabAccess(
  isAdmin: boolean,
  granted: string[],
  tab: string,
): boolean {
  if (isAdmin) return true;
  const wanted = String(tab).trim();
  if (!isGrantableAdvClrTabKey(wanted)) return false;
  return filterGrantableAdvClrTabKeys(granted).indexOf(wanted) !== -1;
}

/**
 * May this caller open this AP-2 / AP-3 working screen?
 *
 * An admin passes every REAL menu and no made-up one. That asymmetry matters:
 * the table has no CHECK, so answering true for anything an admin asked about
 * would turn a typo in a stray row into a capability.
 *
 * This answers SIGHT only. Whether the viewer may ACT on what they see comes
 * from the approver rosters, checked where the money moves — a person with the
 * tick and no approver row sees the queue and can approve nothing on it. That
 * is correct rather than a gap to filter around here: the roster and the grant
 * are two separate tickets, which is the whole reason this table exists.
 */
export function decideAdvClrMenuAccess(
  isAdmin: boolean,
  granted: string[],
  menu: string,
): boolean {
  const wanted = String(menu).trim();
  if (!isAdvClrMenuKey(wanted)) return false;
  if (isAdmin) return true;
  return filterAdvClrMenuKeys(granted).indexOf(wanted) !== -1;
}
