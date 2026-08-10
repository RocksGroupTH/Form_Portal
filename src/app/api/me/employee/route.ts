import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveLoginEmail } from "@/lib/auth-email";
import { resolveManagerInfo } from "@/lib/acc/employee-context";
import { findActiveEmployeeByEmail } from "@/lib/hr/employee-lookup";

/**
 * GET /api/me/employee
 * Active Employee from Rocks_Portal_HR matched by login email only.
 */
export async function GET() {
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
    const managerRes = await resolveManagerInfo(loginEmail);

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
