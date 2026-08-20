import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { requireAuth } from "@/lib/api-auth";
import { isAdminRole } from "@/lib/roles";
import { resolveApproverSettingsTabsByEmail } from "@/lib/acc/approver-settings-tabs";
import { decideSettingsTabAccess, type GrantableSettingsTabKey } from "@/lib/acc/settings-tabs";

/**
 * The gate on one AP-1 settings tab.
 *
 * Until now every route under `/api/request/accounting/settings/**` was
 * `requireRole(["IT Admin", "System Admin"])`, so an approver who had been
 * granted a tab saw it in the UI and was then refused its data — a grant that
 * granted nothing. This is the piece that makes the grant real, and it is a
 * genuine privilege expansion: a non-admin holding a grant can now change
 * vehicle rates, brands, the same-day rule, department mappings or the ERP
 * interface configuration.
 *
 * Three things keep it narrow:
 *
 * - **the admin arm is unchanged** — `isAdminRole` is exactly the pair
 *   `requireRole(["IT Admin", "System Admin"])` allowed, so nobody who could
 *   reach these routes before loses them;
 * - **the grant is resolved server-side, every call**, from
 *   `AccApprover` ⋈ `AccApproverSettingsTab`. `resolveApproverSettingsTabsByEmail`
 *   matches only `IsActive = 1`, so deactivating an approver revokes every tab
 *   without touching a grant row;
 * - **the tab is a literal**, typed as `GrantableSettingsTabKey` so it cannot be
 *   built from a header, a query parameter or a body. Which tab governs a route
 *   is a property of the route, declared once in `SETTINGS_ROUTE_TABS`.
 *
 * Three routes do not use this at all and stay on `requireRole` — `approvers`
 * (it hands out the grants) and the two `sync` POSTs (they write the databases
 * shared with the Rocks Fast sibling). `SETTINGS_ROUTE_TABS` records that.
 *
 * Returns the session, or the `Response` to return — the same shape
 * `requireAuth()` uses, so a handler stays two lines:
 *
 * ```ts
 * const session = await requireSettingsTab("vehicles");
 * if (session instanceof Response) return session;
 * ```
 */
export async function requireSettingsTab(
  tab: GrantableSettingsTabKey,
): Promise<Session | Response> {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const isAdmin = isAdminRole(session.user.role);
  if (isAdmin) return session;

  let grantedTabs: string[];
  try {
    grantedTabs = await resolveApproverSettingsTabsByEmail(session.user.email);
  } catch (err) {
    // Fail closed. An unresolvable grant is not a grant, and answering 500
    // rather than 403 keeps "the roster could not be read" distinguishable from
    // "you were not granted this" in the logs and to the operator.
    console.error(`[require-settings-tab] could not resolve grants for tab "${tab}"`, err);
    return NextResponse.json(
      { ok: false, error: "ตรวจสอบสิทธิ์เข้าถึงไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" },
      { status: 500 },
    );
  }

  if (!decideSettingsTabAccess(isAdmin, grantedTabs, tab)) {
    return NextResponse.json(
      { ok: false, error: "ไม่มีสิทธิ์เข้าถึงการตั้งค่านี้" },
      { status: 403 },
    );
  }

  return session;
}
