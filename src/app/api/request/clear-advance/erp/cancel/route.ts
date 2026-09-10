import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { buildAccActor } from "@/lib/acc/actor-context";
import { isClrApprover } from "@/lib/clr/clear-advance-approver-service";
import { isAdminRole } from "@/lib/roles";
import { cancelApprovedClearing } from "@/lib/clr/clear-advance-approval-engine";

/**
 * POST { id, reason } — cancel an approved AP-3 clearing that never reached BC.
 *
 * The same authority as the pull-back beside it: this ends a request other
 * people are waiting on, so it belongs to whoever could have approved it.
 *
 * The engine enforces what may be cancelled (never-sent or Failed, never Sent).
 * A reason is required and is what the requester is told — "cancelled" with no
 * reason is the thing that generates the phone call.
 */
export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);
  if (!isAdminRole(session.user.role)) {
    const [account, head] = await Promise.all([
      isClrApprover(actor.email, "ACCOUNT"),
      isClrApprover(actor.email, "HEAD"),
    ]);
    if (!account && !head) {
      return NextResponse.json(
        { ok: false, error: "เฉพาะผู้อนุมัติบัญชี/แอดมินเท่านั้น" },
        { status: 403 },
      );
    }
  }

  const body = (await req.json().catch(() => ({}))) as { id?: number; reason?: string };
  const id = Number(body.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ ok: false, error: "ไม่พบรายการ" }, { status: 400 });
  }

  try {
    await cancelApprovedClearing(id, actor, body.reason ?? "");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "ยกเลิกไม่สำเร็จ" },
      { status: 400 },
    );
  }
}
