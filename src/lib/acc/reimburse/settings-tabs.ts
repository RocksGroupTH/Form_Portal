/**
 * Which AP-4 settings tabs an admin may hand to an individual person, and the
 * rule that decides whether one may be opened.
 *
 * The AP-1 / AP-17 counterpart (`@/lib/acc/settings-tabs`,
 * `@/lib/acc/travel-booking/settings-tabs`), deliberately the same shape. Two
 * things about AP-4 differ, both worth reading before editing this file.
 *
 * **The approval grant still hangs off its own roster — only its tab is
 * gone.** AP-17 keeps its settings grants on `AccBookingApprover`, which is an
 * access list and nothing more. AP-4's `AccReimburseApprover` is the pool that
 * takes the ACCOUNT and ACCOUNT_FINAL steps — being on it means approving real
 * reimbursement payments — so hanging settings grants there would make "may
 * edit the payment rules" and "may approve a payment" the same tick.
 * `AccReimburseAccess` (migration 120) exists so the two can be handed out
 * separately, and that split still holds: what changed on 2026-09-10 is that
 * the former ผู้อนุมัติบัญชี **tab** was removed. Its per-brand ticks
 * (`AccReimburseApproverBrand`, migration 144) now render as extra columns on
 * the สิทธิ์เข้าถึง grid — joined onto `AccReimburseAccess`'s rows by the
 * `settings/access` route, never stored in that table. Ticking ≥1 brand there
 * is what makes `AccReimburseApprover.IsActive` true; the two tables never
 * merge, only the screen does.
 *
 * **One of the six tabs is not grantable, and it is `access`** — the
 * สิทธิ์เข้าถึง tab itself. Whoever can open it can grant themselves
 * everything else, which is the reason both siblings give, and sharper here
 * since the same grid also carries the brand ticks that make somebody an
 * approver. Its route stays `requireRole` on every method.
 *
 * **`erpInterface`, `glAccounts` and `buGlMap` became grantable on
 * 2026-09-22** (user: *"ของ AP-3,4 ก็ต้อง เปิด check box ทุกอันและตัดช่อง
 * สิทธิ์เข้าถึง ออกเหมือนกัน"*). Until that day each was excluded, and the
 * reasons were real — they were put to the user before the change and
 * **accepted**, so what follows is now a statement of what a tick reaches
 * rather than a reason it cannot be given:
 *
 * - `erpInterface` — AP-4's own Business Central posting configuration
 *   (journal batch, bank account, branch code per brand). It is gated but
 *   **not brand-scoped**, so a brand-scoped approver holding the grant can set
 *   **another** brand's posting configuration — exactly the gap CLAUDE.md
 *   records for AP-1's `gl-accounts` / `bank-accounts` / `journal-batches` /
 *   `branch-codes` routes. AP-1's own `erpInterface` tab has been grantable
 *   all along with that same gap; AP-4 now matches it deliberately.
 * - `glAccounts` — which of a company's accounts AP-3 may charge at all, and
 *   what dimension a line charging one must carry. **The rows are AP-3's**
 *   (`AccClearAdvanceGl` / `AccClearAdvanceGlCompany`), so a grant here is a
 *   grant over another form's configuration.
 * - `buGlMap` — which account an expense posts to, by BU and by branch. **The
 *   rows are AP-3's** too (`AccClrBuGlMap` / `AccClrBranchGlMap`, no
 *   `FormCode` column), so a grant here is a grant over another form's
 *   posting rules.
 *
 * Each of the three carries a `note` below, which the grid prints under the
 * table, so the admin ticking the box reads the reach rather than discovering
 * it. **`note` is not `adminOnly` renamed** — one says what a tick reaches,
 * the other says a tick is impossible, and a later edit that collapses them
 * would either hide the warning or take the grant away.
 *
 * That exclusion is enforced in `decideReimburseTabAccess`, not by a database
 * constraint. `AccReimburseAccessTab` has no CHECK on `TabKey` and is writable
 * from more than one place, so a row naming any string can appear; the
 * grantable test is what makes such a row inert.
 *
 * This module imports nothing, so it is unit-tested without a database:
 * anything reachable from a pool drags `@/env` in, which validates the whole
 * environment at import time and throws in the test runner. The half that needs
 * a pool is `./access-tabs`.
 */

/**
 * Every tab the AP-4 settings page shows, in the order it shows them.
 *
 * Configuration first, then the one roster left as its own tab: which brands
 * may be claimed against, the rules a requester agrees to, AP-4's own Business
 * Central posting configuration, and who may change any of it — which, since
 * 2026-09-10, is also where who approves the money is set, as brand ticks on
 * that same grid. `erpInterface` sits with the configuration tabs and directly
 * ahead of สิทธิ์เข้าถึง — the same relative position it holds on AP-1's strip,
 * immediately before the tab that hands out access — even though it is not
 * itself grantable here; see the module docblock for why.
 * `GRANTABLE_REIMBURSE_TABS` is filtered from this array rather than written
 * out again, so the checkbox columns on the สิทธิ์เข้าถึง tab follow the strip
 * automatically.
 *
 * This is the display order only. `access` is now the tab the page *opens*
 * on — see `parseTabKey` and the page's docblock — because the payment-approval
 * pool its grid now surfaces still has to hold at least two active rows (two
 * people with at least one brand ticked each) before AP-4 can process a single
 * claim.
 */
export const REIMBURSE_SETTINGS_TAB_ORDER = [
  "brands",
  "rules",
  "messages",
  "glAccounts",
  "buGlMap",
  // Interface ERP sits directly ahead of สิทธิ์เข้าถึง (user, 2026-09-14) — the
  // same relative position it holds on AP-1’s strip: the last of the
  // configuration tabs, immediately before the one that hands out access.
  "erpInterface",
  "access",
] as const;

export type ReimburseSettingsTabKey = (typeof REIMBURSE_SETTINGS_TAB_ORDER)[number];

/**
 * The keys an admin can tick — **every settings tab except `access`** since
 * 2026-09-22; see the module docblock for what the three opened that day
 * reach.
 *
 * Written as `Exclude<…, "access">` rather than a list of the five, so the
 * five follow the strip. **Be clear about which way that defaults**: a tab
 * added to the strip becomes grantable unless it is excluded here, which is
 * fail-OPEN for a tab nobody has thought about. Two things make that
 * acceptable rather than a trap. The grid's columns and the type come from one
 * constant, so a new tab cannot be tickable on screen and ungrantable in code
 * — the mismatch this change existed to remove. And
 * `settings-route-gates.test.ts` asserts both directions: every tab-gated
 * route names a key an admin can tick, **and** every grantable key has a
 * tab-gated route. A new tab whose route is left `requireRole` therefore fails
 * the suite rather than shipping as a tick that grants nothing.
 */
export type GrantableReimburseTabKey = Exclude<ReimburseSettingsTabKey, "access" | "messages">;

/**
 * Every settings tab, in strip order, with its label and whether it can be
 * handed to an individual.
 *
 * **The สิทธิ์เข้าถึง grid renders ALL of them** (user, 2026-09-14: the column
 * group showed two of six and read as incomplete). The four that cannot be
 * granted render as a disabled box carrying the reason, which is more honest
 * than omitting them: an admin looking for "who may open Interface ERP" should
 * find the answer on this screen rather than conclude the tab is missing.
 *
 * Showing them changes nothing about what may be stored or opened —
 * `filterStorableReimburseKeys` still refuses to write them and
 * `decideReimburseTabAccess` still refuses to open them for a non-admin. A
 * `Record` over the tab union, so adding a tab without a label or a reason is
 * a compile error rather than a blank column heading.
 */
const REIMBURSE_ALL_TAB_META: Record<
  ReimburseSettingsTabKey,
  { label: string; adminOnly?: string; note?: string }
> = {
  brands: { label: "แบรนด์ที่เบิกได้" },
  rules: { label: "ระเบียบการจ่าย" },
  // Neither `adminOnly` nor `note`: since migration 166 this tab is granted
  // through its own COLUMN (`AccReimburseAccess.CanMessage`), not through this
  // table's `TabKey` vocabulary at all — so it is not rendered from
  // `TAB_COLUMNS`/`ADMIN_ONLY_TABS` (both explicitly exclude "messages"; see
  // `ReimburseAccessSettings.tsx`) and carries its own bespoke checkbox column
  // instead. See `@/lib/acc/message-grant`.
  messages: { label: "Message" },
  glAccounts: {
    label: "หมวดบัญชี G/L",
    note: "เป็นข้อมูลชุดเดียวกับ AP-3 — แก้ที่นี่มีผลกับทั้งสองฟอร์ม",
  },
  buGlMap: {
    label: "Fix G/L by BU or Branch",
    note: "เป็นกฎชุดเดียวกับ AP-3 — แก้ที่นี่มีผลกับทั้งสองฟอร์ม",
  },
  erpInterface: {
    label: "Interface ERP",
    note: "ตั้งค่าบัญชีธนาคาร Journal Batch และ Branch Code ได้ทุกแบรนด์ ไม่จำกัดเฉพาะแบรนด์ที่ตนอนุมัติ",
  },
  access: { label: "สิทธิ์เข้าถึง", adminOnly: "หน้านี้เอง — ให้สิทธิ์ตัวเองต่อได้" },
};

export const ALL_REIMBURSE_TABS: readonly {
  key: ReimburseSettingsTabKey;
  label: string;
  /** Set when the tab can never be granted; the text says why. */
  adminOnly?: string;
  /**
   * Set when the tab CAN be granted but reaches further than its label says.
   *
   * Deliberately a different field from `adminOnly`, not a rename of it: one
   * is a warning printed beside a live checkbox, the other is the reason there
   * is no checkbox. Collapsing them would either hide the warning or withdraw
   * the grant. AP-2 / AP-3's `ALL_ADV_CLR_TABS` carries the same pair.
   */
  note?: string;
}[] = REIMBURSE_SETTINGS_TAB_ORDER.map((key) => ({ key, ...REIMBURSE_ALL_TAB_META[key] }));

/**
 * The label each grantable tab carries — the settings page's own, not a
 * prettified key name.
 *
 * A `Record` on purpose: widening `GrantableReimburseTabKey` without adding a
 * label here fails the typecheck rather than producing a checkbox with no text.
 */
const REIMBURSE_TAB_LABELS: Record<GrantableReimburseTabKey, string> = {
  brands: "แบรนด์ที่เบิกได้",
  rules: "ระเบียบการจ่าย",
  glAccounts: "หมวดบัญชี G/L",
  buGlMap: "Fix G/L by BU or Branch",
  erpInterface: "Interface ERP",
};

/**
 * Display order — filtered from the page's own tab order rather than written
 * out again, so the checkbox columns cannot drift from the tab strip.
 *
 * The predicate excludes `access` and `messages` — the two keys
 * `GrantableReimburseTabKey` excludes — not a list of the four: one statement
 * of which tabs cannot be handed out, in the same place the type makes it. A
 * type predicate only asserts a narrowing; it does not verify the boolean
 * logic actually matches, so this must stay in lockstep with the `Exclude<…>`
 * above by hand — a predicate testing one of the two keys and not the other
 * would leak the missed key into this list at runtime with no compile error,
 * since `REIMBURSE_TAB_LABELS` is indexed by the asserted type rather than
 * checked against it.
 */
export const GRANTABLE_REIMBURSE_TABS: readonly {
  key: GrantableReimburseTabKey;
  label: string;
}[] = REIMBURSE_SETTINGS_TAB_ORDER.filter(
  (key): key is GrantableReimburseTabKey => key !== "access" && key !== "messages",
).map((key) => ({ key, label: REIMBURSE_TAB_LABELS[key] }));

export function isGrantableReimburseTabKey(key: string): boolean {
  const k = String(key).trim();
  for (const t of GRANTABLE_REIMBURSE_TABS) if (t.key === k) return true;
  return false;
}

/** Keep only known keys, trimmed, de-duplicated, in the caller's order. */
export function filterGrantableReimburseTabKeys(keys: string[]): string[] {
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (const raw of keys) {
    const k = String(raw).trim();
    if (isGrantableReimburseTabKey(k) && !seen[k]) {
      seen[k] = true;
      out.push(k);
    }
  }
  return out;
}

/* ── the MENU vocabulary ──────────────────────────────────────────────────
 *
 * A second set of keys in the same `AccReimburseAccessTab.TabKey` column, and
 * keeping the two apart is the design rather than an accident of naming. A tab
 * key grants sight of a CONFIGURATION screen; a menu key grants sight of a
 * WORKING screen. `requireReimburseSettingsTab` gates the first, so a menu key
 * that satisfied `isGrantableReimburseTabKey` would be a way into the settings
 * routes — which is why that function must go on refusing these.
 *
 * No migration: migration 120 deliberately put no CHECK on `TabKey` (its own
 * header says so), which is what makes a second vocabulary possible without one
 * — and exactly what makes the code-side split load-bearing.
 *
 * AP-17 reached the same arrangement first; `booking-approver-tabs.ts` is the
 * shape being copied, including the storable-vs-grantable pair below.
 */
export const REIMBURSE_MENU_KEYS = ["approvalQueue"] as const;

export type ReimburseMenuKey = (typeof REIMBURSE_MENU_KEYS)[number];

/**
 * The label each menu carries, as a `Record` for the same reason
 * `REIMBURSE_TAB_LABELS` is one: adding a key without copy is a typecheck
 * failure rather than a blank checkbox.
 */
const REIMBURSE_MENU_LABELS: Record<ReimburseMenuKey, string> = {
  approvalQueue: "คิวอนุมัติ (บัญชี)",
};

/*
 * `clearance` was here and is GONE (user, 2026-09-14). It named a screen that
 * does not exist yet (spec §6), so nothing anywhere read it and ticking it
 * granted nothing — a column on the สิทธิ์เข้าถึง grid that could only mislead.
 * Bring the key back when the screen ships, not before.
 *
 * **Rows already holding it go inert rather than erroring.**
 * `filterStorableReimburseKeys` drops any key this module does not know, so a
 * stored `clearance` row is read as nothing and rewritten away on the next save
 * of that person. No migration, and none is needed: the column has no CHECK,
 * which is the same freedom that let the menu vocabulary share it in the first
 * place.
 */

export const REIMBURSE_MENUS: readonly { key: ReimburseMenuKey; label: string }[] =
  REIMBURSE_MENU_KEYS.map((key) => ({ key, label: REIMBURSE_MENU_LABELS[key] }));

export function isReimburseMenuKey(key: string): boolean {
  const k = String(key).trim();
  for (const m of REIMBURSE_MENUS) if (m.key === k) return true;
  return false;
}

/** Keep only known MENU keys, trimmed, de-duplicated, in the caller's order. */
export function filterReimburseMenuKeys(keys: string[]): string[] {
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (const raw of keys) {
    const k = String(raw).trim();
    if (isReimburseMenuKey(k) && !seen[k]) {
      seen[k] = true;
      out.push(k);
    }
  }
  return out;
}

/**
 * Everything that may be STORED in `AccReimburseAccessTab` — **GRANTABLE tabs ∪
 * menus**, not every settings tab. `access` is excluded here as well as from
 * `decideReimburseTabAccess`, so a row naming it can never be written in the
 * first place; the module docblock says why it is not grantable.
 *
 * Storage takes that union; authorization keeps the narrow filters. Before AP-17
 * drew this distinction its menu ticks were dropped on read AND on write, so
 * ticking one saved nothing at all and the bug looked like a UI fault.
 */
export function filterStorableReimburseKeys(keys: string[]): string[] {
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (const raw of keys) {
    const k = String(raw).trim();
    if ((isGrantableReimburseTabKey(k) || isReimburseMenuKey(k)) && !seen[k]) {
      seen[k] = true;
      out.push(k);
    }
  }
  return out;
}

/**
 * May this caller open this AP-4 working screen?
 *
 * An admin passes every REAL menu and no made-up one. That asymmetry matters:
 * the table has no CHECK, so `decideReimburseMenuAccess(true, [], anything)`
 * returning true would turn a typo in a stray row into a capability.
 *
 * This answers SIGHT only. Whether the viewer may act on what they see comes
 * from `AccReimburseApprover`, checked inside the approval service where the
 * money moves — a person with the tick and no approver row sees the FULL
 * queue and can act on none of it. That is correct, not a bug to filter
 * around here: `AccReimburseAccess` exists precisely so "may see the queue"
 * and "may approve money" are two separate tickets, and filtering the queue
 * on the roster here would collapse them back into one.
 */
export function decideReimburseMenuAccess(
  isAdmin: boolean,
  granted: string[],
  menu: string,
): boolean {
  const wanted = String(menu).trim();
  if (!isReimburseMenuKey(wanted)) return false;
  if (isAdmin) return true;
  return filterReimburseMenuKeys(granted).indexOf(wanted) !== -1;
}

/* ── The decision ────────────────────────────────────────────────────────── */

/**
 * May this caller open this AP-4 settings tab?
 *
 * Pure on purpose: the guard around it needs a session and a pool, and this is
 * the part worth pinning in tests.
 *
 * - an admin passes everything, `access` included — that is the role the
 *   grants are handed out from, and locking an admin out of the tab that
 *   grants access would leave nobody able to grant it;
 * - a non-admin passes only a tab that is *both* grantable and in their list, so
 *   `access` fails **even if a row for it exists**.
 */
export function decideReimburseTabAccess(
  isAdmin: boolean,
  granted: string[],
  tab: string,
): boolean {
  if (isAdmin) return true;
  const wanted = String(tab).trim();
  if (!isGrantableReimburseTabKey(wanted)) return false;
  return filterGrantableReimburseTabKeys(granted).indexOf(wanted) !== -1;
}
