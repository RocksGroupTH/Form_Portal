import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import { requireAuth } from "@/lib/api-auth";
import { isAdminRole } from "@/lib/roles";
import { resolveBookingApproverCanMessageByEmail } from "@/lib/acc/travel-booking/booking-approver-message-access";
import { decideMessageTabAccess } from "@/lib/acc/message-grant";

/**
 * The gate on AP-17's Message settings tab — the counterpart of
 * `@/lib/acc/require-message-access`, the same shape on purpose.
 *
 * Resolves `AccBookingApprover.CanMessage` (migration 166), a column rather
 * than an `AccBookingApproverTab` row, for the same reason AP-1's twin gives:
 * that table is shared with ACC Portal and its own saver rewrites an
 * approver's whole tab set with only the keys it recognises. See
 * `@/lib/acc/message-grant`.
 *
 * Returns the session, or the `Response` to return — the same shape
 * `requireAuth()` uses.
 */
export async function requireBookingMessageAccess(): Promise<Session | Response> {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const isAdmin = isAdminRole(session.user.role);
  if (isAdmin) return session;

  let canMessage: boolean;
  try {
    canMessage = await resolveBookingApproverCanMessageByEmail(session.user.email);
  } catch (err) {
    console.error("[require-booking-message-access] could not resolve AP-17 message grant", err);
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
