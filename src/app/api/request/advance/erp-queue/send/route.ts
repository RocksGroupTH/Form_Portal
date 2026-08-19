import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { buildAccActor } from "@/lib/acc/actor-context";
import { isAdvanceApprover } from "@/lib/adv/advance-approver-service";
import { sendAdvanceErpBatch, AdvanceQueueDriftError } from "@/lib/adv/advance-erp-send";

/** POST — send approved AP-2 requests to BC; one journal (one No. Series) per Company. */
export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);
  const isAdmin = session.user.role === "IT Admin" || session.user.role === "System Admin";
  if (!isAdmin) {
    const [h, o, d] = await Promise.all([
      isAdvanceApprover(actor.email, "HEAD_ACC"),
      isAdvanceApprover(actor.email, "ACC_OFFICER"),
      isAdvanceApprover(actor.email, "DIRECTOR"),
    ]);
    if (!h && !o && !d) {
      return NextResponse.json(
        { ok: false, error: "เฉพาะผู้อนุมัติบัญชี/แอดมินเท่านั้นที่ส่ง Interface ได้" },
        { status: 403 },
      );
    }
  }

  const body = (await req.json().catch(() => ({}))) as { ids?: number[] };
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => Number.isFinite(x)) : [];
  if (ids.length === 0) {
    return NextResponse.json({ ok: false, error: "ไม่ได้เลือกรายการ" }, { status: 400 });
  }

  try {
    const results = await sendAdvanceErpBatch(ids, actor.userId);
    const okCount = results.filter((r) => r.ok).length;
    return NextResponse.json({ ok: okCount > 0, okCount, failCount: results.length - okCount, results });
  } catch (err) {
    if (err instanceof AdvanceQueueDriftError) {
      return NextResponse.json({ ok: false, drift: true, error: err.message }, { status: 409 });
    }
    console.error("[api/request/advance/erp-queue/send] POST", err);
    const message = err instanceof Error ? err.message : "ส่งเข้า ERP ไม่สำเร็จ";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
