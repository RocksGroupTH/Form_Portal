import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveLoginEmail } from "@/lib/auth-email";
import { resolveEmployeeForActor } from "@/lib/hr/employee-lookup";
import { listTravelBookingDateRanges } from "@/lib/acc/travel-booking/request-service";

/**
 * GET /api/request/travel-booking/date-ranges?requesterStaffId=&excludeGroupKey=
 * The requester's other (non-rejected) travel-date ranges — used to lock overlapping days
 * in the date picker. Honours the on-behalf requester (same-department authorized).
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const sp = req.nextUrl.searchParams;
    const requesterStaffIdRaw = sp.get("requesterStaffId");
    const requesterStaffId = requesterStaffIdRaw ? Number(requesterStaffIdRaw) : null;
    const excludeGroupKey = sp.get("excludeGroupKey") || null;

    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email }) ?? "";
    const emp = await resolveEmployeeForActor(loginEmail, requesterStaffId);
    const data = await listTravelBookingDateRanges(emp.staffId, excludeGroupKey);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
