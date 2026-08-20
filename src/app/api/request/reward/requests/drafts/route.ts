import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listMyRewardDrafts } from "@/lib/acc/reward/request-service";

/* ── GET /api/request/reward/requests/drafts — resumable work ── */

/**
 * Drafts *and* Returned requests, which is what Home's "continue where you left
 * off" strip means by resumable. AP-11 can tell the two apart in its own UI;
 * the shared strip does not, so both arrive on one list.
 */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const data = await listMyRewardDrafts(Number(session.user.id));
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/reward/requests/drafts] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
