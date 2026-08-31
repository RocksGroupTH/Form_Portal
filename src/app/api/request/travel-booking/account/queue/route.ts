import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { canAccessBookingArea } from "@/lib/acc/booking-access";
import { resolveBookingBrandAccess } from "@/lib/acc/travel-booking/booking-approver-brands";
import { listAccountQueue } from "@/lib/acc/travel-booking/admin-service";

/**
 * GET /api/request/travel-booking/account/queue
 *
 * AP-17 requests Admin has finished booking and handed to accounting —
 * `ManagerApproved` / `CurrentStepCode='ACCOUNT'`. The counterpart to
 * `admin/queue` (Admin's own stage); a separate route rather than a query
 * param because the two stages' rows must never bleed into each other's list.
 *
 * Requires auth + account area access (roster approver or admin) — the same
 * gate `account-approve` and `payment-date` enforce on the rows this list
 * hands out. The page's own `accountApproval` menu flag only decides whether
 * the menu is shown; this is the actual authorization.
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
    const data = await listAccountQueue(access);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/travel-booking/account/queue] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
