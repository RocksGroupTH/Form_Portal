import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { requireAuth } from "@/lib/api-auth";
import { isAdminRole } from "@/lib/roles";
import { resolveAdvClrTabsByEmail } from "@/lib/adv/access-service";
import { decideAdvClrTabAccess, decideAdvClrMenuAccess } from "@/lib/adv/settings-tabs";

/**
 * The gates on one AP-2 / AP-3 settings tab, and on one of their working
 * menus — the counterparts of `@/lib/acc/reimburse/require-reimburse-settings-tab`,
 * the same shape on purpose, status codes included.
 *
 * Until now every route under `/api/request/advance/settings` and
 * `/api/request/clear-advance/settings` was
 * `requireRole(["IT Admin", "System Admin"])`. This makes the grants real, and
 * it is a genuine privilege expansion: a non-admin holding a grant can now
 * change AP-2's approval matrix or bank master, AP-3's Location / BU mapping,
 * or the brand allowlist both forms share.
 *
 * **It widened again on 2026-09-22, on the user's instruction and with the
 * reach put to them first.** `advanceErpInterface` / `clearErpInterface`,
 * `glAccounts` and `buGlMap` are grantable now, so a holder can set where
 * money posts for **any** brand — these routes are gated but not brand-scoped —
 * and can edit the G/L rules AP-3 shares with AP-4, which carry no `FormCode`.
 * `./settings-tabs`' module docblock states both in full; the grid prints a
 * Thai line under each of the three so the tick is not made blind.
 *
 * Three things keep it narrow:
 *
 * - **the admin arm is unchanged** — `isAdminRole` is exactly the pair
 *   `requireRole(["IT Admin", "System Admin"])` allowed, so nobody who could
 *   reach these routes before loses them;
 * - **the grant is resolved server-side, every call**, from `AccAdvClrAccess`
 *   joined to `AccAdvClrAccessTab`. `resolveAdvClrTabsByEmail` matches only
 *   `IsActive = 1`, so deactivating someone revokes everything without touching
 *   a grant row;
 * - **`decideAdvClrTabAccess` makes the decision.** It is where `access` is
 *   refused unconditionally for a non-admin, whatever the grant table says.
 *   Testing grant-list membership here instead would be a second copy of that
 *   rule, and only one of the two would ever be corrected.
 *
 * `settings/access` on either form stays on `requireRole` for every method —
 * it is the route that hands out the grants, and here it also edits both
 * approver pools. **So do the routes that write `Rocks_ERP_Data`** —
 * `advance/settings/vendors/sync`, `clear-advance/settings/erp-sync` and
 * `clear-advance/settings/locations/sync`. Those are not this app's private
 * rows: Rocks Fast writes the neighbouring tables and ACC Portal reads them
 * through `Fast_Data`'s synonyms, and CLAUDE.md's standing rule is that a tab
 * grant must never become write access to them. A grant holder therefore works
 * the tab and the sync button beside it answers 403 — a partial capability,
 * deliberately, and the only one of its kind here.
 *
 * Both return the session, or the `Response` to return — the same shape
 * `requireAuth()` uses, so a handler stays two lines.
 */
export async function requireAdvClrSettingsTab(tab: string): Promise<Session | Response> {
  return gate(tab, decideAdvClrTabAccess, "ไม่มีสิทธิ์เข้าถึงการตั้งค่านี้", "tab");
}

/**
 * Sight of one AP-2 / AP-3 working screen — a queue or a report.
 *
 * **Sight only.** Whether the viewer may act on what they see comes from
 * `AccAdvanceApprover` / `AccClearAdvanceApprover`, checked where the money
 * moves. A person with the tick and no approver row sees the queue and can
 * approve nothing on it, which is the split this roster exists for.
 */
export async function requireAdvClrMenu(menu: string): Promise<Session | Response> {
  return gate(menu, decideAdvClrMenuAccess, "ไม่มีสิทธิ์เข้าถึงเมนูนี้", "menu");
}

async function gate(
  key: string,
  decide: (isAdmin: boolean, granted: string[], key: string) => boolean,
  refusal: string,
  kind: "tab" | "menu",
): Promise<Session | Response> {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const isAdmin = isAdminRole(session.user.role);
  if (isAdmin) return session;

  let granted: string[];
  try {
    granted = await resolveAdvClrTabsByEmail(session.user.email);
  } catch (err) {
    // Fail closed. An unresolvable grant is not a grant, and answering 500
    // rather than 403 keeps "the roster could not be read" distinguishable from
    // "you were not granted this" in the logs and to the operator. Same choice
    // as AP-1's, AP-17's and AP-4's guards.
    console.error(`[require-adv-clr] could not resolve grants for ${kind} "${key}"`, err);
    return NextResponse.json(
      { ok: false, error: "ตรวจสอบสิทธิ์เข้าถึงไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" },
      { status: 500 },
    );
  }

  if (!decide(isAdmin, granted, key)) {
    return NextResponse.json({ ok: false, error: refusal }, { status: 403 });
  }
  return session;
}
