import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { uatActorGate } from "@/lib/acc/travel-booking/uat-gate";
import { canAccessBookingArea } from "@/lib/acc/booking-access";
import { buildAccActor } from "@/lib/acc/actor-context";
import { approveByAccount } from "@/lib/acc/travel-booking/approval";
import { processQueue } from "@/lib/acc/email-queue";

/* ── POST /api/request/travel-booking/requests/[id]/account-approve ──
   Accounting's sign-off: ManagerApproved/ACCOUNT → Completed — the step after the Admin
   booking desk hands a request on (`completeRequest`, admin-service.ts). Gated the same way
   the admin queue routes are: auth, the UAT tester barrier, then `AccBookingApprover`
   membership or admin. */

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

  // A UAT record is invisible outside the tester group — the id selected the
  // database, membership decides who may touch what it found.
  const uatGate = await uatActorGate(session);
  if (uatGate) return uatGate;

  if (!(await canAccessBookingArea(session.user.email, session.user.role))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  try {
    const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);
    const updated = await approveByAccount(id, actor);
    void processQueue().catch(() => {});
    return NextResponse.json({ ok: true, data: updated });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
