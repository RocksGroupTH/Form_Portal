import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveLoginEmail } from "@/lib/auth-email";
import { findActiveEmployeeByEmail, listDepartmentColleagues } from "@/lib/hr/employee-lookup";
import { resolveManagerInfo } from "@/lib/acc/employee-context";
import { resolveFormAccess } from "@/lib/form-environment";
import { AP1_FORM_CODE } from "@/features/accounting/constants";

/** A positive integer id, or null — anything else is ignored, never an error. */
function parseRequestId(raw: string | null): number | null {
  if (!raw) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * GET /api/request/accounting/requesters[?id=123] — self + same-department
 * colleagues for the on-behalf picker.
 *
 * The form code is named explicitly because this route is an aggregate ("BOTH"),
 * so the path alone resolves Production and would preview a tester real HR
 * managers. `id` names the record being resumed, so the picker is judged by the
 * same id rule the submit is.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    if (session instanceof Response) return session;

    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email });
    if (!loginEmail) {
      return NextResponse.json({
        ok: true,
        data: { self: null, manager: null, colleagues: [], environment: "Production" },
      });
    }

    const requestId = parseRequestId(req.nextUrl.searchParams.get("id"));
    const { employee } = await findActiveEmployeeByEmail(loginEmail);
    const managerRes = await resolveManagerInfo(loginEmail, AP1_FORM_CODE, requestId);
    const access = await resolveFormAccess(AP1_FORM_CODE, requestId);
    const deptId = employee?.departmentId ?? null;
    const colleagues = deptId
      ? (
          await listDepartmentColleagues(deptId, {
            formCode: AP1_FORM_CODE,
            requestId,
          })
        ).filter((c) => c.staffId !== employee?.staffId)
      : [];

    return NextResponse.json({
      ok: true,
      data: {
        self: employee,
        manager: managerRes.manager,
        colleagues,
        // The picker's "no manager" copy points at HR in production and at
        // Settings → UAT Users in UAT; the client cannot tell which it is looking at.
        environment: access.environment,
      },
    });
  } catch (err: unknown) {
    console.error("[api/request/accounting/requesters] GET", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "Failed to load requesters" }, { status: 500 });
  }
}
