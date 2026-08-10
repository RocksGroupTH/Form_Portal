import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveLoginEmail } from "@/lib/auth-email";
import { listBlockedTravelDates } from "@/lib/acc/request-service";
import { findActiveEmployeeByEmail } from "@/lib/hr/employee-lookup";

/** GET /api/request/accounting/requests/blocked-travel-dates?excludeId= — dates already used in other requests */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const userId = Number(session.user.id);
    const excludeRaw = req.nextUrl.searchParams.get("excludeId");
    const excludeId = excludeRaw ? Number(excludeRaw) : null;
    const brandCode = req.nextUrl.searchParams.get("brandCode") || null;
    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email });
    let staffId: number | null = null;
    if (loginEmail) {
      const { employee } = await findActiveEmployeeByEmail(loginEmail);
      staffId = employee?.staffId ?? null;
    }

    const data = await listBlockedTravelDates(
      userId,
      staffId,
      excludeId != null && !Number.isNaN(excludeId) ? excludeId : null,
      brandCode,
    );
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
