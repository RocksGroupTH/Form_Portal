import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveLoginEmail } from "@/lib/auth-email";
import { findActiveEmployeeByEmail, listDepartmentColleagues } from "@/lib/hr/employee-lookup";
import { resolveManagerInfo } from "@/lib/acc/employee-context";
import { AP1_FORM_CODE } from "@/features/accounting/constants";

/** GET /api/request/accounting/requesters — self + same-department colleagues for the on-behalf picker. */
export async function GET() {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;

    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email });
    if (!loginEmail) {
      return NextResponse.json({ ok: true, data: { self: null, manager: null, colleagues: [] } });
    }

    const { employee } = await findActiveEmployeeByEmail(loginEmail);
    // Named explicitly: this route is an aggregate ("BOTH"), so the path alone
    // resolves Production and would preview a tester their real HR manager.
    const managerRes = await resolveManagerInfo(loginEmail, AP1_FORM_CODE);
    const deptId = employee?.departmentId ?? null;
    const colleagues = deptId
      ? (await listDepartmentColleagues(deptId)).filter((c) => c.staffId !== employee?.staffId)
      : [];

    return NextResponse.json({
      ok: true,
      data: { self: employee, manager: managerRes.manager, colleagues },
    });
  } catch (err: unknown) {
    console.error("[api/request/accounting/requesters] GET", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "Failed to load requesters" }, { status: 500 });
  }
}
