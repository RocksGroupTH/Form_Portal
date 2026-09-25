import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveLoginEmail } from "@/lib/auth-email";
import { findActiveEmployeeByEmail, listDepartmentColleagues } from "@/lib/hr/employee-lookup";
import { resolveManagerInfo } from "@/lib/acc/employee-context";

/**
 * GET /api/request/clear-advance/requesters — self + same-department colleagues
 * for the เคลียร์แทน picker. HR-only (no form pool), so it is unaffected by
 * per-form environment routing.
 *
 * AP-1, AP-2, AP-4 and AP-17 each carry their own copy of this. A fifth is
 * duplication, and collapsing the five is worth doing — but it is a change to
 * four working forms, not part of giving AP-3 the control it was missing.
 *
 * **The list is not the rule.** `assertMayClearFor` is, and both routes that
 * take a chosen person call it; this only decides what the picker offers.
 */
export async function GET() {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;

    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email });
    if (!loginEmail) {
      return NextResponse.json({ ok: true, data: { self: null, manager: null, colleagues: [] } });
    }

    const { employee } = await findActiveEmployeeByEmail(loginEmail);
    const managerRes = await resolveManagerInfo(loginEmail);
    const deptId = employee?.departmentId ?? null;
    const colleagues = deptId
      ? (await listDepartmentColleagues(deptId)).filter((c) => c.staffId !== employee?.staffId)
      : [];

    return NextResponse.json({
      ok: true,
      data: { self: employee, manager: managerRes.manager, colleagues },
    });
  } catch (err: unknown) {
    console.error("[api/request/clear-advance/requesters] GET", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "Failed to load requesters" }, { status: 500 });
  }
}
