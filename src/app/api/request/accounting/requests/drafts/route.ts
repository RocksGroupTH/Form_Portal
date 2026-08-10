import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveLoginEmail } from "@/lib/auth-email";
import { listMyTravelDrafts } from "@/lib/acc/request-service";
import { findActiveEmployeeByEmail } from "@/lib/hr/employee-lookup";

/** GET /api/request/accounting/requests/drafts — editable AP-1 drafts for current user */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const userId = Number(session.user.id);
    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email });
    let staffId: number | null = null;
    if (loginEmail) {
      const { employee } = await findActiveEmployeeByEmail(loginEmail);
      staffId = employee?.staffId ?? null;
    }

    const data = await listMyTravelDrafts(userId, staffId);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
