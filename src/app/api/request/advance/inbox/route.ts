import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listAdvanceApprovalInbox } from "@/lib/adv/advance-request-service";
import { buildAccActor } from "@/lib/acc/actor-context";

/** GET — AP-2 requests waiting for the signed-in viewer to act on (by step). */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  try {
    const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);
    const data = await listAdvanceApprovalInbox(actor.email, actor.staffId);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/advance/inbox] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
