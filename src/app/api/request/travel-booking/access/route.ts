import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { isBookingApprover } from "@/lib/acc/booking-access";
import { isAdminRole } from "@/lib/roles";

/* ── GET /api/request/travel-booking/access — viewer's AP-17 capabilities ──
 *
 * Its own endpoint rather than a field on AP-1's, so the two forms' access
 * questions never have to be asked together.
 *
 * These flags drive which menus render. They are NOT the authorization gate:
 * every AP-17 account-area route still calls `canAccessBookingArea` itself, and
 * that function deliberately keeps its admin arm.
 *
 * `account` here is the `AccBookingApprover` roster alone, so an admin who is
 * not on it no longer sees AP-17's queue or report. They keep ตั้งค่า
 * (`adminOnly`), so nobody can lock themselves out — an admin can always grant
 * themselves a row.
 */
export async function GET(_req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const email = session.user.email ?? null;
    const admin = isAdminRole(session.user.role);
    const approver = await isBookingApprover(email);
    return NextResponse.json({ ok: true, data: { account: approver, approver, admin } });
  } catch (err) {
    console.error("[api/request/travel-booking/access] GET", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
