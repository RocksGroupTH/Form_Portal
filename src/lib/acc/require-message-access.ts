import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { requireAuth } from "@/lib/api-auth";
import { isAdminRole } from "@/lib/roles";
import { resolveApproverCanMessageByEmail } from "@/lib/acc/approver-message-access";
import { decideMessageTabAccess } from "@/lib/acc/message-grant";

/**
 * The gate on AP-1's Message settings tab.
 *
 * `messages` shipped admin-only in `SETTINGS_ROUTE_TABS` because the ordinary
 * `requireSettingsTab` mechanism cannot carry it — that resolves grants from
 * `AccApproverSettingsTab`, a `TabKey` child table ACC Portal's own saver
 * rewrites wholesale, which would silently delete a `messages` row on that
 * app's next unrelated settings-tab save. This gate resolves a COLUMN instead —
 * `AccApprover.CanMessage` (migration 166) — which that saver's explicit
 * column list never touches. See `@/lib/acc/message-grant` for the shared
 * decision and the measurement that justified it.
 *
 * Same shape as `requireSettingsTab`, deliberately, status codes included, so
 * a route stays two lines:
 *
 * ```ts
 * const session = await requireAccMessageAccess();
 * if (session instanceof Response) return session;
 * ```
 */
export async function requireAccMessageAccess(): Promise<Session | Response> {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const isAdmin = isAdminRole(session.user.role);
  if (isAdmin) return session;

  let canMessage: boolean;
  try {
    canMessage = await resolveApproverCanMessageByEmail(session.user.email);
  } catch (err) {
    // Fail closed, same as every settings-tab gate: an unresolvable grant is
    // not a grant, and 500 keeps "the roster could not be read" distinguishable
    // from "you were not granted this".
    console.error("[require-message-access] could not resolve AP-1 message grant", err);
    return NextResponse.json(
      { ok: false, error: "ตรวจสอบสิทธิ์เข้าถึงไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" },
      { status: 500 },
    );
  }

  if (!decideMessageTabAccess(isAdmin, canMessage)) {
    return NextResponse.json(
      { ok: false, error: "ไม่มีสิทธิ์เข้าถึงการตั้งค่านี้" },
      { status: 403 },
    );
  }

  return session;
}
