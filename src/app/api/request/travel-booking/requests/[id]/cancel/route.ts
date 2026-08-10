import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveLoginEmail } from "@/lib/auth-email";
import { findActiveEmployeeByEmail } from "@/lib/hr/employee-lookup";
import { cancelByRequester, type Actor } from "@/lib/acc/travel-booking/approval";
import { processQueue } from "@/lib/acc/email-queue";

/* ── POST /api/request/travel-booking/requests/[id]/cancel ──
   Owner check (CreatedBy, ≤24h since submit) is enforced inside the service. */

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (Number.isNaN(id)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  try {
    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email });
    const { employee } = await findActiveEmployeeByEmail(loginEmail);
    const actor: Actor = {
      staffId: employee?.staffId ?? null,
      userId: Number(session.user.id),
      email: loginEmail,
    };
    const updated = await cancelByRequester(id, actor);
    void processQueue().catch(() => {});
    return NextResponse.json({ ok: true, data: updated });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
