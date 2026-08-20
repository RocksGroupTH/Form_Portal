import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { statusForAccError } from "@/lib/acc/request-errors";
import { authorizeRewardAction } from "@/lib/acc/reward/action-auth";
import { returnByManager, returnByOfficer } from "@/lib/acc/reward/approval";

/* ── POST /api/request/reward/requests/[id]/return ── */

/**
 * Send back for edits, from either approval step. A note is required.
 *
 * Note what this does **not** do: it does not release the reward stock. A
 * Returned request is still alive and the requester is expected to fix and
 * resend it, so the goods stay reserved for them — the owner's rule is that only
 * a Reject returns stock. `submitRewardRequest` knows this and adjusts the hold
 * by the delta on resubmit instead of taking the whole quantity again.
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
      { ok: false, error: "คำขอนี้ผ่านการอนุมัติแล้ว — ไม่สามารถส่งกลับแก้ไขได้" },
      { status: 409 },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const comment = String(body?.comment ?? "");

    const data =
      ctx.stage === "MANAGER"
        ? await returnByManager(id, ctx.actor, comment)
        : await returnByOfficer(id, ctx.actor, comment);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/reward/requests/[id]/return] POST", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(err) });
  }
}
