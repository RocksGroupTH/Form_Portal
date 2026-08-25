import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { buildAccActor } from "@/lib/acc/actor-context";
import { isAdvanceApprover } from "@/lib/adv/advance-approver-service";
import { previewAdvanceErpJournal } from "@/lib/adv/advance-erp-send";

/** POST — preview the BC journal for approved AP-2 requests (before sending). */
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
      return NextResponse.json({ ok: false, error: "เฉพาะผู้อนุมัติบัญชี/แอดมิน" }, { status: 403 });
    }
  }

  const body = (await req.json().catch(() => ({}))) as { ids?: number[] };
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => Number.isFinite(x)) : [];
  if (ids.length === 0) return NextResponse.json({ ok: true, data: [] });

  const data = await previewAdvanceErpJournal(ids);
  return NextResponse.json({ ok: true, data });
}
