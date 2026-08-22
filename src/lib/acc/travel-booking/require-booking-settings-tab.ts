import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { requireAuth } from "@/lib/api-auth";
import { isAdminRole } from "@/lib/roles";
import { resolveBookingTabsByEmail } from "@/lib/acc/travel-booking/booking-approver-tabs";
import { decideBookingTabAccess } from "@/lib/acc/travel-booking/settings-tabs";
import type { SettingsKind } from "@/lib/acc/travel-booking/settings-route-map";

/**
 * The gate on one AP-17 settings tab — the counterpart of
 * `@/lib/acc/require-settings-tab` for the travel-booking form, and the same
 * shape on purpose, status codes included.
 *
 * Until now every route under `/api/request/travel-booking/settings/**` was
 * `requireRole(["IT Admin", "System Admin"])`, so a grant in
 * `AccBookingApproverTab` granted nothing. This makes it real, and it is a
 * genuine privilege expansion: a non-admin booking approver holding a grant can
 * now change travel reasons, accommodations, the journey options or the rental
 * vehicles.
 *
 * Three things keep it narrow:
 *
 * - **the admin arm is unchanged** — `isAdminRole` is exactly the pair
 *   `requireRole(["IT Admin", "System Admin"])` allowed, so nobody who could
 *   reach these routes before loses them;
 * - **the grant is resolved server-side, every call**, from
 *   `AccBookingApprover` ⋈ `AccBookingApproverTab`. `resolveBookingTabsByEmail`
 *   matches only `IsActive = 1`, so deactivating an approver revokes every tab
 *   without touching a grant row;
 * - **`decideBookingTabAccess` makes the decision.** It is where `access` —
 *   AP-17's สิทธิ์เข้าถึง tab — is refused unconditionally for a non-admin,
 *   whatever the grant table says, and where a `TabKey` that is not grantable at
 *   all is refused. Testing grant-list membership here instead would be a second
 *   copy of that rule, and only one of the two would ever be corrected.
 *
 * **`tab` is typed `SettingsKind`, not `string`, and that matters more here than
 * it does for AP-1.** AP-1's routes pass a literal; these take the tab from the
 * URL. A caller must therefore narrow the raw `[kind]` segment with
 * `isSettingsKind` — which uses `Object.prototype.hasOwnProperty.call`, so
 * `__proto__` is refused — and answer 400 before it reaches this function. Never
 * hand a raw path segment to the gate.
 *
 * `settings/approvers` does not use this and stays on `requireRole` for every
 * method: it is the tab that hands out the access.
 *
 * Returns the session, or the `Response` to return — the same shape
 * `requireAuth()` uses, so a handler stays two lines:
 *
 * ```ts
 * const session = await requireBookingSettingsTab(kind);
 * if (session instanceof Response) return session;
 * ```
 */
export async function requireBookingSettingsTab(
  tab: SettingsKind,
): Promise<Session | Response> {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const isAdmin = isAdminRole(session.user.role);
  if (isAdmin) return session;

  let grantedTabs: string[];
  try {
    grantedTabs = await resolveBookingTabsByEmail(session.user.email);
  } catch (err) {
    // Fail closed. An unresolvable grant is not a grant, and answering 500
    // rather than 403 keeps "the roster could not be read" distinguishable from
    // "you were not granted this" in the logs and to the operator. Same choice
    // as AP-1's guard.
    console.error(
      `[require-booking-settings-tab] could not resolve grants for tab "${tab}"`,
      err,
    );
    return NextResponse.json(
      { ok: false, error: "ตรวจสอบสิทธิ์เข้าถึงไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" },
      { status: 500 },
    );
  }

  if (!decideBookingTabAccess(isAdmin, grantedTabs, tab)) {
    return NextResponse.json(
      { ok: false, error: "ไม่มีสิทธิ์เข้าถึงการตั้งค่านี้" },
      { status: 403 },
    );
  }

  return session;
}
