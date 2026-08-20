import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { statusForAccError } from "@/lib/acc/request-errors";
import { authorizeRewardAction } from "@/lib/acc/reward/action-auth";
import { approveByManager, approveByOfficer } from "@/lib/acc/reward/approval";

/* ── POST /api/request/reward/requests/[id]/approve ── */

/**
 * One route for both approval steps.
 *
 * Which step is being granted comes from the request's stored state, never from
 * the caller — so a client cannot post to this path and choose to grant the
 * Assist AP approval on something still sitting with the manager.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  const ctx = await authorizeRewardAction(session, id, req.headers.get("host"));
  if (ctx instanceof Response) return ctx;

  // Already through both approvals — what is left is Ready/Received, not this.
  if (ctx.stage === "FULFIL") {
    return NextResponse.json(
      { ok: false, error: "คำขอนี้ผ่านการอนุมัติแล้ว" },
      { status: 409 },
    );
  }

  try {
    const data =
      ctx.stage === "MANAGER"
        ? await approveByManager(id, ctx.actor)
        : await approveByOfficer(id, ctx.actor);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/reward/requests/[id]/approve] POST", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(err) });
  }
}
