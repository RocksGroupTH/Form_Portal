import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveLoginEmail } from "@/lib/auth-email";
import { resolveEmployeeForActor } from "@/lib/hr/employee-lookup";
import { setSetting } from "@/lib/acc/settings-service";
import { idCardReuseConsentKey } from "@/features/travel-booking/constants";

/**
 * POST /api/request/travel-booking/id-card/consent  body: { requesterStaffId?, consent: boolean }
 * Records whether the requester (ผู้ขอเบิก — self, or a same-department colleague) allows their ID
 * card to be reused on future requests. Stored per requester HR StaffId — no saved request needed,
 * so it can be answered the moment a card is picked on a brand-new trip.
 */
export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const body = (await req.json()) as { requesterStaffId?: number | null; consent?: boolean };
    if (typeof body.consent !== "boolean") {
      return NextResponse.json({ ok: false, error: "consent is required" }, { status: 400 });
    }
    const requesterStaffId = body.requesterStaffId ? Number(body.requesterStaffId) : null;

    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email });
    if (!loginEmail) return NextResponse.json({ ok: false, error: "No login email" }, { status: 400 });

    // `forWrite` because this POST persists: it is the only id-card route that
    // writes, and without the flag a tester in UAT could record a consent keyed
    // to a non-tester colleague's StaffId in the UAT AccSetting table.
    const emp = await resolveEmployeeForActor(loginEmail, requesterStaffId, { forWrite: true });
    // Keyed on HR StaffId (matches AccRequest.StaffId) — NOT emp.id, which is the Employee GUID.
    await setSetting(idCardReuseConsentKey(emp.staffId), body.consent ? "true" : "false", Number(session.user.id));
    return NextResponse.json({ ok: true, data: { consent: body.consent } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[id-card/consent] POST", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
