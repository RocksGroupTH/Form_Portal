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
 * **Two of the four tabs are not grantable.** AP-1 and AP-17 each exclude one
 * for the first reason below; AP-4 excludes a second tab for the reason
 * CLAUDE.md gives for AP-1's own `erpInterface` grant ("Do not grant
 * `erpInterface` to a non-admin yet"):
 *
 * - `access` — the สิทธิ์เข้าถึง tab itself. Whoever can open it can grant
 *   themselves everything else, which is the reason both siblings give — and
 *   sharper now, since the same grid also carries the brand ticks that make
 *   somebody an approver.
 * - `erpInterface` — AP-4's own Business Central posting configuration
 *   (journal batch, bank account, branch code per brand). Unlike AP-1, where
 *   this same tab **is** grantable, AP-4's version is gated but **not
 *   brand-scoped**: a brand-scoped approver holding the grant could set
 *   another brand's posting configuration, exactly the gap CLAUDE.md records
 *   for AP-1's `gl-accounts` / `bank-accounts` / `journal-batches` /
 *   `branch-codes` routes. Excluding it here is what keeps that gap from
 *   being handed to anyone at all until it is closed. Its route stays
 *   `requireRole` rather than `requireReimburseSettingsTab`.
 *
 * Both exclusions are enforced in `decideReimburseTabAccess`, not by a
 * database constraint. `AccReimburseAccessTab` has no CHECK on `TabKey` and is
 * writable from more than one place, so a row naming any string can appear;
 * the grantable test is what makes such a row inert.
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
  "erpInterface",
  "access",
] as const;

export type ReimburseSettingsTabKey = (typeof REIMBURSE_SETTINGS_TAB_ORDER)[number];

/** The two keys an admin can tick. `erpInterface` is deliberately not one of
 *  them — see the module docblock. */
export type GrantableReimburseTabKey = Extract<ReimburseSettingsTabKey, "rules" | "brands">;

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
};

/**
 * Display order — filtered from the page's own tab order rather than written
 * out again, so the checkbox columns cannot drift from the tab strip.
 */
export const GRANTABLE_REIMBURSE_TABS: readonly {
  key: GrantableReimburseTabKey;
  label: string;
}[] = REIMBURSE_SETTINGS_TAB_ORDER.filter(
  (key): key is GrantableReimburseTabKey => key === "rules" || key === "brands",
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
export const REIMBURSE_MENU_KEYS = ["approvalQueue", "clearance"] as const;

export type ReimburseMenuKey = (typeof REIMBURSE_MENU_KEYS)[number];

/**
 * The label each menu carries, as a `Record` for the same reason
 * `REIMBURSE_TAB_LABELS` is one: adding a key without copy is a typecheck
 * failure rather than a blank checkbox.
 */
const REIMBURSE_MENU_LABELS: Record<ReimburseMenuKey, string> = {
  approvalQueue: "คิวอนุมัติ (บัญชี)",
  // `clearance` is STORED and grants nothing: the screen it would open is a
  // later stage (spec §6), so nothing anywhere reads the key. The suffix is on
  // the LABEL rather than in the panel because the label is the single place
  // this key's copy is defined — an admin ticking a box that renders
  // identically to `approvalQueue` would otherwise believe they had handed
  // somebody a page. Drop the suffix when the screen ships.
  clearance: "เคลียร์เอกสารอนุมัติ (ยังไม่เปิดใช้งาน)",
};

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
