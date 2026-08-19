import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveLoginEmail } from "@/lib/auth-email";
import { findActiveEmployeeByEmail, resolveEmployeeForActor } from "@/lib/hr/employee-lookup";
import { setSetting } from "@/lib/acc/settings-service";
import { decideIdCardConsentWrite } from "@/lib/acc/travel-booking/id-card-access";
import { idCardReuseConsentKey } from "@/features/travel-booking/constants";

/**
 * POST /api/request/travel-booking/id-card/consent  body: { requesterStaffId?, consent: boolean }
 *
 * Records whether the **signed-in employee** allows their own ID card to be
 * reused on their future requests. Stored per HR StaffId — no saved request
 * needed, so it can be answered the moment a card is picked on a brand-new trip.
 *
 * `requesterStaffId` is still accepted, because the form posts it, but it may
 * now only name the caller. It used to be resolved through
 * `resolveEmployeeForActor`, which authorizes an on-behalf target by shared
 * department — so a colleague could record consent for someone else's national-
 * ID scan and then, through `id-card/previous`, read it. Consent given by
 * another person is not consent; see `@/lib/acc/travel-booking/id-card-access`.
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

    const actor = (await findActiveEmployeeByEmail(loginEmail)).employee;
    if (!actor) {
      return NextResponse.json(
        { ok: false, error: "ไม่พบข้อมูลพนักงานของคุณในระบบ HR" },
        { status: 403 },
      );
    }

    const verdict = decideIdCardConsentWrite({
      actorStaffId: actor.staffId,
      subjectStaffId: requesterStaffId,
    });
    if (!verdict.ok) {
      return NextResponse.json({ ok: false, error: verdict.error }, { status: verdict.status });
    }

    // `forWrite` because this POST persists: without the flag a tester in UAT
    // could record a consent into the UAT database for a StaffId outside the
    // tester list. The target is the caller themself, so the on-behalf branch
    // of this resolver never runs — it is here for the UAT membership check.
    const emp = await resolveEmployeeForActor(loginEmail, null, { forWrite: true });

    // Keyed on HR StaffId (matches AccRequest.StaffId) — NOT emp.id, which is the Employee GUID.
    //
    // `ap17.idcard.reuse.` is excluded from AccSetting's dual-write
    // (`isEnvironmentSpecificSettingKey`), so this lands in the actor's own
    // database and nowhere else. It has to: the flag decides whether a booking
    // re-attaches a stored national-ID scan, and a tester toggling it in UAT
    // used to change that answer for their **real** bookings too.
    await setSetting(idCardReuseConsentKey(emp.staffId), body.consent ? "true" : "false", Number(session.user.id));
    return NextResponse.json({ ok: true, data: { consent: body.consent } });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[id-card/consent] POST", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
