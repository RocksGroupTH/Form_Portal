import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getRequest } from "@/lib/clr/clear-advance-request-service";
import { cancelByRequester } from "@/lib/clr/clear-advance-approval-engine";
import { buildAccActor } from "@/lib/acc/actor-context";
import { processQueue } from "@/lib/acc/email-queue";
import { isAdminRole } from "@/lib/roles";

/* ── POST /api/request/clear-advance/requests/[id]/cancel ── */

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

  const clrReq = await getRequest(id);
  if (!clrReq) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const isOwner = clrReq.submittedBy != null && clrReq.submittedBy === Number(session.user.id);
  if (!isOwner && !isAdminRole(session.user.role)) {
    return NextResponse.json({ ok: false, error: "ไม่มีสิทธิ์ยกเลิกคำขอนี้" }, { status: 403 });
  }

  const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);

  try {
    await cancelByRequester(id, actor);
    const updated = await getRequest(id);
    void processQueue().catch(() => {});
    return NextResponse.json({ ok: true, data: updated });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
