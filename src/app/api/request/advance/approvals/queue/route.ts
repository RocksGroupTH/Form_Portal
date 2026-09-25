import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { buildAccActor } from "@/lib/acc/actor-context";
import { listAdvanceApproveQueue } from "@/lib/adv/advance-queue-service";
import { sweepEmailQueueOnLoad } from "@/lib/acc/email-queue-sweep";

/** GET — AP-2 requests the signed-in viewer can approve now (with Company resolved). */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  try {
    const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);
    const isAdmin = session.user.role === "IT Admin" || session.user.role === "System Admin";
    const data = await listAdvanceApproveQueue(actor.email, actor.staffId, isAdmin);
    // Recover anything the post-action drains left behind. Awaited on purpose:
    // a fire-and-forget recovery recovers from a fire-and-forget failure only
    // by luck. Throttled, batched small, and it never throws — see
    // `sweepEmailQueueOnLoad`.
    await sweepEmailQueueOnLoad();
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/advance/approvals/queue] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
