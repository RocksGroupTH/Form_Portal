import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listMyWorkRows } from "@/lib/acc/report-service";
import { buildAccActor } from "@/lib/acc/actor-context";

/* ── GET /api/request/accounting/work — requests I have a part in approving ── */

export async function GET(_req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);
    const data = await listMyWorkRows(actor.staffId, session.user.email ?? null);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/accounting/work] GET", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
