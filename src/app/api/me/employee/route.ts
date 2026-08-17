import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveLoginEmail } from "@/lib/auth-email";
import { resolveManagerInfo } from "@/lib/acc/employee-context";
import { findActiveEmployeeByEmail } from "@/lib/hr/employee-lookup";
import { isFormCode } from "@/lib/form-environment/classify-path";

/** A positive integer id, or null — anything else is ignored, never an error. */
function parseRequestId(raw: string | null): number | null {
  if (!raw) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * GET /api/me/employee[?form=AP-1][&id=123]
 * Active Employee from Rocks_Portal_HR matched by login email only.
 *
 * `form` names the form whose manager card is being drawn. This route is not
 * form-specific, so per-form routing classifies it as Production for everyone —
 * without the hint a tester in UAT mode would be previewed their real HR
 * manager and then have the request assigned to their UAT manager. Callers that
 * only want identity (the navbar photo, the profile modal) omit it and are
 * unaffected.
 *
 * `id` names the record being resumed, when there is one. The submit carries its
 * id in the path and is routed by it; this route carries none, so without the
 * hint the card and the submit can land in different databases — previewing one
 * manager and assigning another, and refusing a real Returned claim's resubmit
 * over a UAT setting that has nothing to do with it.
 *
 * Both are hints, not commands: unrecognised text is dropped rather than
 * rejected, and the answer falls back to the path. `form` in particular is
 * narrowed to the known codes before it is used as a lookup key.
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
    const formParam = req.nextUrl.searchParams.get("form");
    const formCode = isFormCode(formParam) ? formParam : null;
    const requestId = parseRequestId(req.nextUrl.searchParams.get("id"));
    const managerRes = await resolveManagerInfo(loginEmail, formCode, requestId);

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
