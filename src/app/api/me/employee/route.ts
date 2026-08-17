import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveLoginEmail } from "@/lib/auth-email";
import { resolveManagerInfo } from "@/lib/acc/employee-context";
import { findActiveEmployeeByEmail } from "@/lib/hr/employee-lookup";

/**
 * GET /api/me/employee[?form=AP-1]
 * Active Employee from Rocks_Portal_HR matched by login email only.
 *
 * `form` names the form whose manager card is being drawn. This route is not
 * form-specific, so per-form routing classifies it as Production for everyone —
 * without the hint a tester in UAT mode would be previewed their real HR
 * manager and then have the request assigned to their UAT manager. Callers that
 * only want identity (the navbar photo, the profile modal) omit it and are
 * unaffected.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;

    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email });
    if (!loginEmail) {
      return NextResponse.json({
        ok: true,
        data: {
          email: null,
          employee: null,
          matchMethod: null,
          hint: "No email on session — sign out and sign in again",
        },
      });
    }

    const { employee, matchMethod } = await findActiveEmployeeByEmail(loginEmail);
    const formCode = req.nextUrl.searchParams.get("form");
    const managerRes = await resolveManagerInfo(loginEmail, formCode);

    return NextResponse.json({
      ok: true,
      data: {
        email: loginEmail,
        employee,
        matchMethod,
        hint: employee
          ? null
          : "No active Employee record for this email in HR",
        manager: managerRes.manager,
        managerReason: managerRes.reason,
      },
    });
  } catch (err: unknown) {
    console.error("[api/me/employee] GET", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { ok: false, error: "Failed to load employee data" },
      { status: 500 },
    );
  }
}
