import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { statusForAccError } from "@/lib/acc/request-errors";
import { authorizeRewardAction } from "@/lib/acc/reward/action-auth";
import { markReceived } from "@/lib/acc/reward/approval";

/* ── POST /api/request/reward/requests/[id]/received ── */

/**
 * Assist AP: the requester has collected the goods (brief §work-page 2).
 *
 * Terminal, and the one place `IssuedQty` ever grows — `markReceived` moves the
 * quantity from held to issued in a single UPDATE inside the same transaction
 * as the status change.
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

  if (ctx.stage !== "FULFIL") {
    return NextResponse.json(
      { ok: false, error: "คำขอนี้ยังไม่ผ่านการอนุมัติครบทุกขั้น" },
      { status: 409 },
    );
  }

  try {
    const data = await markReceived(id, ctx.actor);
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/reward/requests/[id]/received] POST", err);
    const message = err instanceof Error ? err.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(err) });
  }
}
