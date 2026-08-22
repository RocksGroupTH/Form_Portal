/**
 * Which AP-4 settings tabs an admin may hand to an individual person, and the
 * rule that decides whether one may be opened.
 *
 * The AP-1 / AP-17 counterpart (`@/lib/acc/settings-tabs`,
 * `@/lib/acc/travel-booking/settings-tabs`), deliberately the same shape. Two
 * things about AP-4 differ, both worth reading before editing this file.
 *
 * **The grants hang off their own roster.** AP-17 keeps them on
 * `AccBookingApprover`, which is an access list and nothing more. AP-4's
 * `AccReimburseApprover` is the pool that takes the ACCOUNT and ACCOUNT_FINAL
 * steps — being on it means approving real reimbursement payments — so hanging
 * settings grants there would make "may edit the payment rules" and "may
 * approve a payment" the same tick. `AccReimburseAccess` (migration 106) exists
 * so the two can be handed out separately.
 *
 * **Two of the four tabs are not grantable**, where AP-1 and AP-17 each exclude
 * one:
 *
 * - `access` — the สิทธิ์เข้าถึง tab itself. Whoever can open it can grant
 *   themselves everything else, which is the reason both siblings give.
 * - `approvers` — the ผู้อนุมัติบัญชี tab, and the sharper case. It edits the
 *   payment-approval pool, so granting it would open a route from "may edit the
 *   checklist" to "may approve money" — the coupling `AccReimburseAccess` was
 *   added to avoid. Excluding it here is what keeps that true.
 *
 * Both exclusions are enforced in `decideReimburseTabAccess`, not by a database
 * constraint. `AccReimburseAccessTab` has no CHECK on `TabKey` and is writable
 * from more than one place, so a row naming any string can appear; the
 * grantable test is what makes such a row inert.
 *
 * This module imports nothing, so it is unit-tested without a database:
 * anything reachable from a pool drags `@/env` in, which validates the whole
 * environment at import time and throws in the test runner. The half that needs
 * a pool is `./access-tabs`.
 */

/** Every tab the AP-4 settings page shows, in the order it shows them. */
export const REIMBURSE_SETTINGS_TAB_ORDER = [
  "approvers",
  "rules",
  "brands",
  "access",
] as const;

export type ReimburseSettingsTabKey = (typeof REIMBURSE_SETTINGS_TAB_ORDER)[number];

/** The two keys an admin can tick. */
export type GrantableReimburseTabKey = Extract<ReimburseSettingsTabKey, "rules" | "brands">;

/**
 * The label each grantable tab carries — the settings page's own, not a
 * prettified key name.
 *
 * A `Record` on purpose: widening `GrantableReimburseTabKey` without adding a
 * label here fails the typecheck rather than producing a checkbox with no text.
 */
const REIMBURSE_TAB_LABELS: Record<GrantableReimburseTabKey, string> = {
  rules: "ระเบียบการจ่าย",
  brands: "แบรนด์ที่เบิกได้",
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

/* ── The decision ────────────────────────────────────────────────────────── */

/**
 * May this caller open this AP-4 settings tab?
 *
 * Pure on purpose: the guard around it needs a session and a pool, and this is
 * the part worth pinning in tests.
 *
 * - an admin passes everything, `access` and `approvers` included — that is the
 *   role the grants are handed out from, and locking an admin out of the tab
 *   that grants access would leave nobody able to grant it;
 * - a non-admin passes only a tab that is *both* grantable and in their list, so
 *   `access` and `approvers` fail **even if a row for them exists**.
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
