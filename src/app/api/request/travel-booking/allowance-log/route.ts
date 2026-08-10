import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveLoginEmail } from "@/lib/auth-email";
import { resolveEmployeeForActor } from "@/lib/hr/employee-lookup";
import { getAllowanceLog } from "@/lib/acc/travel-booking/allowance-log";

/**
 * GET /api/request/travel-booking/allowance-log?requesterStaffId=
 * Effective-dated per-diem allowance history (Rocks_Portal_HR.dbo.EmployeeAllowanceLog) for the
 * signed-in user, or — with requesterStaffId — a same-department colleague (on-behalf). Read-only.
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const requesterStaffIdRaw = req.nextUrl.searchParams.get("requesterStaffId");
    const requesterStaffId = requesterStaffIdRaw ? Number(requesterStaffIdRaw) : null;

    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email });
    if (!loginEmail) return NextResponse.json({ ok: true, data: { entries: [] } });

    const emp = await resolveEmployeeForActor(loginEmail, requesterStaffId);
    const entries = await getAllowanceLog(emp.id);
    return NextResponse.json({ ok: true, data: { entries } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    console.error("[api/request/travel-booking/allowance-log] GET", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
