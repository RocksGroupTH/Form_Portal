import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listPendingAdvances } from "@/lib/clr/clear-advance-request-service";
import { resolveLoginEmail } from "@/lib/auth-email";
import { assertMayClearFor } from "@/lib/clr/clear-on-behalf-service";

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
    // Whose advances the เคลียร์แทน picker is asking about. Gated: this answers
    // with somebody's approved advances — number, amount, purpose and payee —
    // and the picker's own list is presentation, not a check.
    const staffRaw = searchParams.get("staffId");
    const requesterStaffId = staffRaw ? Number(staffRaw) || null : null;
    try {
      await assertMayClearFor(loginEmail, requesterStaffId);
    } catch (refusal) {
      // 403, not the 500 the catch below would give it. A refusal answering as a
      // server fault reads as a bug to whoever hits it, and this one is meant to
      // be hit — it is the check behind a picker that only offers one department.
      const message = refusal instanceof Error ? refusal.message : "ไม่มีสิทธิ์";
      return NextResponse.json({ ok: false, error: message }, { status: 403 });
    }
    const data = await listPendingAdvances(loginEmail, exclude, brand, requesterStaffId);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
