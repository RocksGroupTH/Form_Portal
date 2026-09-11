import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { buildAccActor } from "@/lib/acc/actor-context";
import { isClrApprover } from "@/lib/clr/clear-advance-approver-service";
import { isAdminRole } from "@/lib/roles";
import { pullBackFailedSend } from "@/lib/clr/clear-advance-erp-send";

/**
 * POST { id } — return a failed AP-3 clearing to the "รอส่ง" queue.
 *
 * Failed only. A Sent clearing has a document in BC that someone may already be
 * working on, and clearing our side of that quietly would leave the two ledgers
 * disagreeing with nothing to say so.
 */
export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);
  if (!isAdminRole(session.user.role)) {
    // The account roster only: head accounting was removed from AP-3 on
    // 2026-09-11 and its rows no longer grant anything.
    if (!(await isClrApprover(actor.email, "ACCOUNT"))) {
      return NextResponse.json(
        { ok: false, error: "เฉพาะผู้อนุมัติบัญชี/แอดมินเท่านั้น" },
        { status: 403 },
      );
    }
  }

  const body = (await req.json().catch(() => ({}))) as { id?: number };
  const id = Number(body.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ ok: false, error: "ไม่พบรายการ" }, { status: 400 });
  }

  try {
    await pullBackFailedSend(id, actor.userId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "ดึงกลับไม่สำเร็จ" },
      { status: 400 },
    );
  }
}
