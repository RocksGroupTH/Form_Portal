import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { canAccessRewardArea } from "@/lib/acc/reward/access";
import { listRewardQueue } from "@/lib/acc/reward/report-service";

/* ── GET /api/request/reward/admin/queue — the Assist AP work queue ── */

export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  // The reward roster, not `AccApprover` — an AP-1 approver has no business in
  // this queue.
  if (!(await canAccessRewardArea(session.user.email, session.user.role))) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  try {
    const data = await listRewardQueue();
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/reward/admin/queue] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
