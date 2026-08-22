import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { requireAuth } from "@/lib/api-auth";
import { isAdminRole } from "@/lib/roles";
import { resolveReimburseTabsByEmail } from "@/lib/acc/reimburse/access-tabs";
import {
  decideReimburseTabAccess,
  type GrantableReimburseTabKey,
} from "@/lib/acc/reimburse/settings-tabs";

/**
 * The gate on one AP-4 settings tab — the counterpart of
 * `@/lib/acc/require-settings-tab` and
 * `@/lib/acc/travel-booking/require-booking-settings-tab`, the same shape on
 * purpose, status codes included.
 *
 * Until now every route under `/api/request/reimburse/settings` was
 * `requireRole(["IT Admin", "System Admin"])`. This makes the grants real, and
 * it is a genuine privilege expansion: a non-admin holding a grant can now
 * change AP-4's payment-rule checklist or its brand allowlist.
 *
 * Three things keep it narrow:
 *
 * - **the admin arm is unchanged** — `isAdminRole` is exactly the pair
 *   `requireRole(["IT Admin", "System Admin"])` allowed, so nobody who could
 *   reach these routes before loses them;
 * - **the grant is resolved server-side, every call**, from
 *   `AccReimburseAccess` joined to `AccReimburseAccessTab`.
 *   `resolveReimburseTabsByEmail` matches only `IsActive = 1`, so deactivating
 *   someone revokes every tab without touching a grant row;
 * - **`decideReimburseTabAccess` makes the decision.** It is where `access` and
 *   `approvers` are refused unconditionally for a non-admin, whatever the grant
 *   table says. Testing grant-list membership here instead would be a second
 *   copy of that rule, and only one of the two would ever be corrected.
 *
 * `tab` is typed `GrantableReimburseTabKey`, so a caller cannot hand this
 * function `"access"` or `"approvers"` and have the answer turn on runtime data.
 * Those two tabs' routes — `settings/access` and `settings/approvers` — stay on
 * `requireRole` for every method: they are the ones that hand out the access and
 * the payment-approval role.
 *
 * Returns the session, or the `Response` to return — the same shape
 * `requireAuth()` uses, so a handler stays two lines.
 */
export async function requireReimburseSettingsTab(
  tab: GrantableReimburseTabKey,
): Promise<Session | Response> {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const isAdmin = isAdminRole(session.user.role);
  if (isAdmin) return session;

  let grantedTabs: string[];
  try {
    grantedTabs = await resolveReimburseTabsByEmail(session.user.email);
  } catch (err) {
    // Fail closed. An unresolvable grant is not a grant, and answering 500
    // rather than 403 keeps "the roster could not be read" distinguishable from
    // "you were not granted this" in the logs and to the operator. Same choice
    // as AP-1's and AP-17's guards.
    console.error(
      `[require-reimburse-settings-tab] could not resolve grants for tab "${tab}"`,
      err,
    );
    return NextResponse.json(
      { ok: false, error: "ตรวจสอบสิทธิ์เข้าถึงไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" },
      { status: 500 },
    );
  }

  if (!decideReimburseTabAccess(isAdmin, grantedTabs, tab)) {
    return NextResponse.json(
      { ok: false, error: "ไม่มีสิทธิ์เข้าถึงการตั้งค่านี้" },
      { status: 403 },
    );
  }

  return session;
}
