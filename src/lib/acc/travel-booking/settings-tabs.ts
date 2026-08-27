/**
 * Which AP-17 settings tabs an admin may hand to an individual booking approver.
 *
 * Four of the five grant keys ARE the `[kind]` URL segment of
 * `/api/request/travel-booking/settings/[kind]` — `SETTINGS_KIND_ROUTES` in
 * `./settings-route-map` defines those and `isSettingsKind` narrows a segment
 * to them, so the union is built from it rather than declared in parallel where
 * it could drift.
 *
 * `brands` is the exception and has to be. That `[kind]` map is list/upsert/
 * reorder over option rows; deciding which brands a form accepts has none of
 * those shapes — it is a set of codes toggled on and off in `AccFormBrand` —
 * so it gets its own route, exactly as AP-1's does.
 *
 * `access` — the สิทธิ์เข้าถึง tab itself — is deliberately absent, for the same
 * reason `approvers` is absent from AP-1's list: whoever can open it can grant
 * themselves the rest. It is not a `SettingsKind` either (it has no `[kind]`
 * route — the roster is served by `settings/approvers`), so the union already
 * excludes it; the tests pin that so a later hand cannot quietly add it.
 *
 * This module imports nothing at runtime so it can be unit-tested: anything
 * reachable from a database pool drags `@/env` in, which validates the whole
 * environment at import time and throws in the test runner. The one import
 * below is `import type`, which is erased. The half that needs a pool is
 * `./booking-approver-tabs`.
 */

import type { SettingsKind } from "./settings-route-map";

/** The keys an admin can tick: every `[kind]` segment, plus `brands`. */
export type GrantableBookingTabKey = SettingsKind | "brands";

/**
 * The label each tab carries.
 *
 * A `Record` on purpose: a fifth kind added to `SETTINGS_KIND_ROUTES` fails the
 * typecheck here rather than becoming a route with no grant behind it.
 *
 * The labels are the settings page's own (`travel-booking-settings/page.tsx`),
 * not prettified key names. Note `vehicles` → **การเดินทาง**, which is not what
 * the key suggests: the tab covers the whole journey, not just the vehicle.
 */
const BOOKING_TAB_LABELS: Record<GrantableBookingTabKey, string> = {
  brands: "แบรนด์ที่เบิก",
  reasons: "เหตุผลการเดินทาง",
  accommodations: "ที่พัก",
  vehicles: "การเดินทาง",
  "rent-vehicles": "เช่ายานพาหนะ",
};

/** Display order — the order the settings page shows its tabs in. */
const BOOKING_TAB_ORDER: readonly GrantableBookingTabKey[] = [
  // First, like AP-1's: a form with no brand granted cannot be submitted at
  // all, so it is the tab that has to be set before any of the others matter.
  "brands",
  "reasons",
  "accommodations",
  "vehicles",
  "rent-vehicles",
];

export const GRANTABLE_BOOKING_TABS: readonly {
  key: GrantableBookingTabKey;
  label: string;
}[] = BOOKING_TAB_ORDER.map((key) => ({ key, label: BOOKING_TAB_LABELS[key] }));

export function isGrantableBookingTabKey(key: string): boolean {
  const k = String(key).trim();
  for (const t of GRANTABLE_BOOKING_TABS) if (t.key === k) return true;
  return false;
}

/** Keep only known keys, trimmed, de-duplicated, in the caller's order. */
export function filterGrantableBookingTabKeys(keys: string[]): string[] {
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (const raw of keys) {
    const k = String(raw).trim();
    if (isGrantableBookingTabKey(k) && !seen[k]) {
      seen[k] = true;
      out.push(k);
    }
  }
  return out;
}

/* ── The decision ────────────────────────────────────────────────────────── */

/**
 * May this caller open this AP-17 settings tab?
 *
 * Pure on purpose: the guard around it needs a session and a pool, and this is
 * the part worth pinning in tests.
 *
 * - an admin passes everything, `access` included — that is the role the grants
 *   are handed out from;
 * - a non-admin passes only a tab that is *both* grantable and in their list,
 *   so `access` fails **even if a row for it exists**. `AccBookingApproverTab`
 *   has no CHECK on `TabKey` and is dual-written from more than one place, so a
 *   row naming any string can appear; the grantable test is what makes that
 *   inert. Do not weaken this to a bare membership check.
 */
export function decideBookingTabAccess(
  isAdmin: boolean,
  granted: string[],
  tab: string,
): boolean {
  if (isAdmin) return true;
  const wanted = String(tab).trim();
  if (!isGrantableBookingTabKey(wanted)) return false;
  return filterGrantableBookingTabKeys(granted).indexOf(wanted) !== -1;
}

/**
 * The two AP-17 work queues an admin may hand to an individual approver.
 *
 * Stored in the same `AccBookingApproverTab` rows as the settings tabs above —
 * the table has no CHECK on `TabKey`, which is what makes a second vocabulary
 * possible without a migration, and what makes keeping them apart in code
 * essential. `isGrantableBookingTabKey` must refuse these and `isBookingMenuKey`
 * must refuse those, or a menu grant becomes a way past
 * `requireBookingSettingsTab` into the configuration routes.
 *
 * Membership of `AccBookingApprover` is still what lets somebody *act*; a tick
 * only decides what they see.
 */
export type BookingMenuKey = "bookingQueue" | "accountApproval";

const BOOKING_MENU_LABELS: Record<BookingMenuKey, string> = {
  bookingQueue: "คิวจองที่พัก/ตั๋วโดยสาร",
  accountApproval: "อนุมัติ (บัญชี)",
};

const BOOKING_MENU_ORDER: readonly BookingMenuKey[] = ["bookingQueue", "accountApproval"];

export const GRANTABLE_BOOKING_MENUS: readonly { key: BookingMenuKey; label: string }[] =
  BOOKING_MENU_ORDER.map((key) => ({ key, label: BOOKING_MENU_LABELS[key] }));

export function isBookingMenuKey(key: string): boolean {
  const k = String(key).trim();
  for (const m of GRANTABLE_BOOKING_MENUS) if (m.key === k) return true;
  return false;
}

/**
 * Everything `AccBookingApproverTab` may legitimately hold: settings tabs **and**
 * menu grants.
 *
 * Separate from `filterGrantableBookingTabKeys` on purpose, and this is the
 * distinction the whole design rests on. That one answers "may this grant open a
 * settings route" and must stay narrow; this one answers "may this row exist",
 * and menu keys must survive it or a tick saves nothing.
 *
 * The pre-flight scan caught the version of this plan that had no such split:
 * `booking-approver-tabs.ts` applies the grantable filter on **both** read (:72)
 * and write (:94), so a menu key was dropped twice over and the feature silently
 * did nothing.
 */
export function filterStorableBookingKeys(keys: string[]): string[] {
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (const raw of keys) {
    const k = String(raw).trim();
    if ((isGrantableBookingTabKey(k) || isBookingMenuKey(k)) && !seen[k]) {
      seen[k] = true;
      out.push(k);
    }
  }
  return out;
}
