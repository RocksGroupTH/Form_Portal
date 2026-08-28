import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveLoginEmail } from "@/lib/auth-email";
import { listBlockedTravelDates } from "@/lib/acc/request-service";
import { resolveRequesterForActor } from "@/lib/acc/employee-context";

/**
 * GET /api/request/accounting/requests/blocked-travel-dates
 *   ?excludeId=&brandCode=&requesterStaffId=
 *
 * The days the picker greys out — for the requester the form is filling in
 * for, not for whoever is holding the keyboard.
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const excludeRaw = req.nextUrl.searchParams.get("excludeId");
    const excludeId = excludeRaw ? Number(excludeRaw) : null;
    const brandCode = req.nextUrl.searchParams.get("brandCode") || null;

    // Whose calendar this is. The signed-in user by default, but the person
    // being filed for when the form says so — this route used to resolve the
    // session's own email unconditionally and never look at the parameter, so
    // filing on behalf of a colleague showed the **filer's** blocked days and
    // hid the colleague's real ones. AP-17's equivalent has always passed it.
    //
    // `resolveRequesterForActor` is the same resolver the submit route uses, so
    // the calendar and the rule answer for the same person, and it authorizes
    // the on-behalf pairing rather than trusting the number in the query string.
    const requesterRaw = req.nextUrl.searchParams.get("requesterStaffId");
    const requesterStaffId = requesterRaw ? Number(requesterRaw) : null;
    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email }) ?? "";
    const requester = await resolveRequesterForActor(
      loginEmail,
      requesterStaffId != null && !Number.isNaN(requesterStaffId) ? requesterStaffId : null,
    );

    const data = await listBlockedTravelDates(
      requester.staffId ?? null,
      excludeId != null && !Number.isNaN(excludeId) ? excludeId : null,
      brandCode,
    );
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
