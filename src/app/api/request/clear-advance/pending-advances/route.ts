import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listPendingAdvances } from "@/lib/clr/clear-advance-request-service";
import { resolveLoginEmail } from "@/lib/auth-email";

/**
 * GET /api/request/clear-advance/pending-advances?exclude=<id>
 * Approved AP-2 advances the current user may still clear (dropdown source).
 */
export async function GET(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email }) ?? "";
    const { searchParams } = new URL(req.url);
    const excludeRaw = searchParams.get("exclude");
    const exclude = excludeRaw ? Number(excludeRaw) || null : null;
    const brand = searchParams.get("brand");
    const data = await listPendingAdvances(loginEmail, exclude, brand);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
