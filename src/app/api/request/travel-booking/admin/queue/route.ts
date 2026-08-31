import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { canAccessBookingArea } from "@/lib/acc/booking-access";
import { resolveBookingBrandAccess } from "@/lib/acc/travel-booking/booking-approver-brands";
import { listAdminQueue } from "@/lib/acc/travel-booking/admin-service";

/**
 * GET /api/request/travel-booking/admin/queue
 * AP-17 requests that finished Manager approval and are waiting on Admin to fill bookings.
 * Requires auth + account area access (approver or admin).
 */
export async function GET(_req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  if (!(await canAccessBookingArea(session.user.email, session.user.role))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  try {
    // Membership decides whether this area opens at all; the brand scope
    // decides which of its rows this person sees. Two questions, resolved
    // separately and in that order.
    const access = await resolveBookingBrandAccess(session.user.email, session.user.role);
    const data = await listAdminQueue(access);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/travel-booking/admin/queue] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
