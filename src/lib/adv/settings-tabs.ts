/**
 * Which AP-2 / AP-3 settings tabs and working menus an admin may hand to an
 * individual person, and the rules that decide whether one may be opened.
 *
 * The AP-4 counterpart (`@/lib/acc/reimburse/settings-tabs`) is the shape being
 * copied, which is itself AP-17's. Three things about this one differ and each
 * is worth reading before editing the file.
 *
 * **One roster spans BOTH forms.** `AccAdvClrAccess` (migration 152) carries no
 * `FormCode`: a tick says whether somebody may open a screen of AP-2 or of
 * AP-3, not of one of them. That follows what these two already do with brands
 * — `setBrandActiveShared` writes `AccFormBrand` for both codes in one
 * transaction — and it is the user's decision (2026-09-14). The *keys* still
 * name their form, because a person granted AP-2's report has not thereby been
 * granted AP-3's.
 *
 * **The approver rosters did not merge, only the screen did.**
 * `AccAdvanceApprover` and `AccClearAdvanceApprover` are the pools that take
 * real approval steps; being on one means approving money. They keep their own
 * tables and their own editors, now rendered on the สิทธิ์เข้าถึง tab beside
 * this grid rather than on a tab called ผู้อนุมัติ. Ticking a settings tab
 * grants no approval and joining an approver pool grants no settings tab —
 * exactly the split migration 120 exists for on AP-4.
 *
 * **Two of the settings tabs can never be granted.** `access` for the reason
 * all three siblings give — whoever opens it can grant themselves the rest, and
 * here it also edits both approver pools — and `erpInterface` because it is
 * gated but **not brand-scoped**: a grant would be a grant over every brand's
 * Business Central posting configuration, the gap CLAUDE.md records for AP-1's
 * `gl-accounts` / `bank-accounts` / `journal-batches` / `branch-codes` routes.
 * Its route stays `requireRole`.
 *
 * Neither exclusion is a database constraint. `AccAdvClrAccessTab` has no CHECK
 * on `TabKey` and is writable from more than one place, so a row naming any
 * string can appear; `decideAdvClrTabAccess` refusing it is what makes that
 * inert — and the same freedom is what lets the menu vocabulary share the
 * column with no migration of its own.
 *
 * This module imports nothing, so it is unit-tested without a database:
 * anything reachable from a pool drags `@/env` in, which validates the whole
 * environment at import time and throws in the test runner.
 */

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
  "erpInterface",
  "access",
] as const;

export type AdvanceSettingsTabKey = (typeof ADVANCE_SETTINGS_TAB_ORDER)[number];

/* ── AP-3's settings tabs ─────────────────────────────────────────────── */

/** Every tab AP-3's settings page shows, in the order it shows them. */
export const CLEAR_SETTINGS_TAB_ORDER = [
  "brands",
  "glAccounts",
  "buGlMap",
  "locations",
  "erpInterface",
  "access",
] as const;

export type ClearSettingsTabKey = (typeof CLEAR_SETTINGS_TAB_ORDER)[number];

/* ── what may be ticked ───────────────────────────────────────────────── */

/**
 * The settings tabs an admin can hand over, across both forms.
 *
 * `brands` appears once and means both, because the tab edits one shared set of
 * `AccFormBrand` rows — AP-2's screen and AP-3's screen write the same thing.
 * `buGlMap` and `glAccounts` are NOT here for the reason AP-4 gives for the
 * same two keys: those rows are AP-3's own G/L rules, shared with AP-4, so a
 * grant would reach another form's posting configuration. They stay
 * `requireRole` like `erpInterface` and `access`.
 */
export const GRANTABLE_ADV_CLR_TABS: readonly { key: string; label: string }[] = [
  { key: "brands", label: "แบรนด์ที่เบิกได้ (AP-2 + AP-3)" },
  { key: "matrix", label: "ขั้นตามเงิน (AP-2)" },
  { key: "banks", label: "ธนาคาร Master (AP-2)" },
  { key: "locations", label: "Location / BU (AP-3)" },
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
 * `brands` appears once, because the tab edits one shared set of
 * `AccFormBrand` rows — AP-2's screen and AP-3's screen write the same thing.
 */
export const ALL_ADV_CLR_TABS: readonly {
  key: string;
  label: string;
  /** Set when the tab can never be granted; the text says why. */
  adminOnly?: string;
}[] = [
  { key: "brands", label: "แบรนด์ที่เบิกได้ (AP-2 + AP-3)" },
  { key: "matrix", label: "ขั้นตามเงิน (AP-2)" },
  { key: "banks", label: "ธนาคาร Master (AP-2)" },
  {
    key: "glAccounts",
    label: "หมวดบัญชี G/L (AP-3)",
    adminOnly: "ใช้ร่วมกับ AP-4 — ให้สิทธิ์ข้ามฟอร์มไม่ได้",
  },
  {
    key: "buGlMap",
    label: "Fix G/L by BU or Branch (AP-3)",
    adminOnly: "ใช้ร่วมกับ AP-4 — ให้สิทธิ์ข้ามฟอร์มไม่ได้",
  },
  { key: "locations", label: "Location / BU (AP-3)" },
  {
    key: "erpInterface",
    label: "Interface ERP (AP-2 + AP-3)",
    adminOnly: "ตัดสินว่าเงินลงบัญชีไหน และไม่ได้จำกัดตามแบรนด์",
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
 */
export const ADV_CLR_MENUS: readonly { key: string; label: string; form: "AP-2" | "AP-3" }[] = [
  { key: "advanceQueue", label: "รออนุมัติ (AP-2)", form: "AP-2" },
  { key: "advanceReport", label: "รายงาน (AP-2)", form: "AP-2" },
  { key: "clearQueue", label: "รออนุมัติ (AP-3)", form: "AP-3" },
  { key: "clearReport", label: "รายงาน Control / Detail (AP-3)", form: "AP-3" },
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
 * menus**, not every settings tab. `access` and `erpInterface` are excluded
 * here as well as from `decideAdvClrTabAccess`, so a row naming either can
 * never be written in the first place.
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

/* ── the decisions ────────────────────────────────────────────────────── */

/**
 * May this caller open this AP-2 / AP-3 settings tab?
 *
 * - an admin passes everything, `access` included — that is the role the grants
 *   are handed out from, and locking an admin out of the tab that grants access
 *   would leave nobody able to grant it;
 * - a non-admin passes only a tab that is *both* grantable and in their list, so
 *   `access` and `erpInterface` fail **even if a row for either exists**.
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
