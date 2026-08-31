import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveLoginEmail } from "@/lib/auth-email";
import { resolveEmployeeForActor } from "@/lib/hr/employee-lookup";
import { getAllowanceLog } from "@/lib/acc/travel-booking/allowance-log";
import { listPerDiemCountryRates } from "@/lib/acc/travel-booking/perdiem-source";

/**
 * GET /api/request/travel-booking/allowance-log?requesterStaffId=
 * Effective-dated per-diem allowance history (Rocks_Portal_HR.dbo.EmployeeAllowanceLog) for the
 * signed-in user, or — with requesterStaffId — a same-department colleague (on-behalf). Read-only.
 *
 * Also returns the active per-country rates, because the form's live estimate has
 * to make the same decision the submit will: which log prices this trip. Sending
 * them together is what keeps the estimate from being one fetch behind the
 * country the requester just picked.
 *
 * `entries` keeps its shape and its meaning — AllowanceHistoryModal renders it
 * unchanged.
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const requesterStaffIdRaw = req.nextUrl.searchParams.get("requesterStaffId");
    const requesterStaffId = requesterStaffIdRaw ? Number(requesterStaffIdRaw) : null;

    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email });
    if (!loginEmail) {
      return NextResponse.json({ ok: true, data: { entries: [], countryRates: [] } });
    }

    const emp = await resolveEmployeeForActor(loginEmail, requesterStaffId);
    const [entries, countryRates] = await Promise.all([
      getAllowanceLog(emp.id),
      listPerDiemCountryRates(),
    ]);
    return NextResponse.json({ ok: true, data: { entries, countryRates } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    console.error("[api/request/travel-booking/allowance-log] GET", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
