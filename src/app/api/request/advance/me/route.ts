import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveRequesterForActor } from "@/lib/acc/employee-context";
import { resolveLoginEmail } from "@/lib/auth-email";

/** GET /api/request/advance/me — the logged-in requester's HR snapshot (auto-fill). */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  try {
    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email }) ?? "";
    const r = await resolveRequesterForActor(loginEmail, null);
    return NextResponse.json({
      ok: true,
      data: {
        staffId: r.staffId,
        fullName: r.fullName,
        position: r.position,
        departmentName: r.departmentName,
        hasManager: r.managerStaffId != null,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" },
      { status: 500 },
    );
  }
}
