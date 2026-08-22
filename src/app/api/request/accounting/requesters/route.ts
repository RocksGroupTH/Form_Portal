import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveLoginEmail } from "@/lib/auth-email";
import {
  findActiveEmployeeByEmail,
  findColleagueByStaffId,
  listDepartmentColleagues,
  searchActiveEmployees,
} from "@/lib/hr/employee-lookup";
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
 * GET /api/request/accounting/requesters[?id=123][&q=chai] — self, plus the
 * people the on-behalf picker offers: the actor's own department by default,
 * or a search across every active employee once `q` is two characters.
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
    // No query: the actor's own department, which is who they file for almost
    // every time and what the picker opens on. With a query: the whole active
    // roster, searched in SQL — 1,117 people is too many to ship and filter in
    // the browser, which is what the picker did while the list was one
    // department.
    const scope = { formCode: AP1_FORM_CODE, requestId };
    const search = (req.nextUrl.searchParams.get("q") ?? "").trim();
    const one = parseRequestId(req.nextUrl.searchParams.get("staffId"));
    const deptId = employee?.departmentId ?? null;

    // Three modes, one shape.
    //
    // `staffId` resolves exactly one person from HR. The form needs it because
    // the requester it is showing may not be in the department list at all —
    // picked from a search, or carried on a resumed draft by somebody who has
    // since moved department. Without it the card renders a bare "#10075".
    //
    // `q` searches the whole active roster; neither answers with the actor's own
    // department, which is who people file for almost every time.
    const colleagues = (
      one !== null
        ? [await findColleagueByStaffId(one, scope)].filter(
            (c): c is NonNullable<typeof c> => c !== null,
          )
        : search.length >= 2
          ? await searchActiveEmployees(search, scope)
          : deptId
            ? await listDepartmentColleagues(deptId, scope)
            : []
    ).filter((c) => c.staffId !== employee?.staffId);

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
