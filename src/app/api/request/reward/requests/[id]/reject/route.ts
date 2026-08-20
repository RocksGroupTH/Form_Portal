import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { statusForAccError } from "@/lib/acc/request-errors";
import { authorizeRewardAction } from "@/lib/acc/reward/action-auth";
import { rejectByManager, rejectByOfficer } from "@/lib/acc/reward/approval";

/* ── POST /api/request/reward/requests/[id]/reject ── */

/**
 * Reject from either approval step. A reason is required by the brief for both
 * steps, and it is enforced in the service rather than here so the rule holds
 * for every caller.
 *
 * This is also **the only path that returns reward stock**. See
 * `rejectFromStage` in `approval.ts` for why the release shares the status
 * change's transaction.
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

  if (ctx.stage === "FULFIL") {
    return NextResponse.json(
      { ok: false, error: "คำขอนี้ผ่านการอนุมัติแล้ว — ไม่สามารถไม่อนุมัติได้" },
      { status: 409 },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const comment = String(body?.comment ?? "");

    const data =
      ctx.stage === "MANAGER"
        ? await rejectByManager(id, ctx.actor, comment)
        : await rejectByOfficer(id, ctx.actor, comment);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/reward/requests/[id]/reject] POST", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(err) });
  }
}
