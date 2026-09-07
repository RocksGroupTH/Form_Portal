import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveLoginEmail } from "@/lib/auth-email";
import { resolveEmployeeForActor } from "@/lib/hr/employee-lookup";
import { getPerDiemEmployeeLogWithSource } from "@/lib/acc/travel-booking/allowance-log";
import { uatByEnvironment } from "@/lib/acc/travel-booking/perdiem-uat-gate";
import { resolveFormEnvironment } from "@/lib/form-environment";
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
 * unchanged. `allowanceSource` is new: `"uat"` when a tester's own configured
 * rate answered instead of the HR log, so the modal's footer can name the log
 * that is actually priced rather than always crediting HR.
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const requesterStaffIdRaw = req.nextUrl.searchParams.get("requesterStaffId");
    const requesterStaffId = requesterStaffIdRaw ? Number(requesterStaffIdRaw) : null;

    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email });
    if (!loginEmail) {
      return NextResponse.json({
        ok: true,
        data: { entries: [], countryRates: [], allowanceSource: "hr" },
      });
    }

    const emp = await resolveEmployeeForActor(loginEmail, requesterStaffId);

    // No record id exists while a draft is being filled, so this is the one
    // place the resolved environment is the right signal. See perdiem-uat-gate.
    const uat = uatByEnvironment(await resolveFormEnvironment());

    const [resolved, countryRates] = await Promise.all([
      getPerDiemEmployeeLogWithSource(emp.id, emp.staffId ?? null, uat),
      listPerDiemCountryRates(),
    ]);

    // The modal's footer names the source, and an HR footer over UAT rates is a
    // false statement about where to change them.
    return NextResponse.json({
      ok: true,
      data: { entries: resolved.log, countryRates, allowanceSource: resolved.source },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    console.error("[api/request/travel-booking/allowance-log] GET", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
