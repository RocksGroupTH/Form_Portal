import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { canAccessBookingArea } from "@/lib/acc/booking-access";
import { requireBookingBrandScope } from "@/lib/acc/travel-booking/require-booking-brand-scope";
import { buildAccActor } from "@/lib/acc/actor-context";
import { completeRequest } from "@/lib/acc/travel-booking/admin-service";
import { processQueue } from "@/lib/acc/email-queue";

/**
 * POST /api/request/travel-booking/admin/requests/[id]/complete
 * Admin closes the request — ManagerApproved → Completed — once every required booking is
 * filled in with a booking number, price, and at least one attachment. Requires auth +
 * account area access (approver or admin).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  if (!(await canAccessBookingArea(session.user.email, session.user.role))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { id: rawId } = await params;
  const requestId = Number(rawId);
  if (Number.isNaN(requestId)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  // Being in the area is not the same as being allowed this request's brand. A
  // scoped approver holding the id from a link or a page loaded before the scope
  // was narrowed is refused here, where the queue would merely not have shown it.
  const scoped = await requireBookingBrandScope(session.user, requestId);
  if (scoped) return scoped;

  try {
    const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);
    const data = await completeRequest(requestId, actor);
    void processQueue().catch(() => {});
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
