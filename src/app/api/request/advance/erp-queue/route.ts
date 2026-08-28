import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { buildAccActor } from "@/lib/acc/actor-context";
import { isAdvanceApprover } from "@/lib/adv/advance-approver-service";
import { listAdvanceErpQueue } from "@/lib/adv/advance-queue-service";

/** GET — approved AP-2 requests ready for (or already sent to) BC, per Company. */
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  // `listAdvanceErpQueue()` takes no viewer: it returns every approved AP-2
  // request — payee, purpose, amounts, matched vendor, PV number — so
  // `requireAuth()` alone published the whole ERP interface queue to any
  // signed-in session. The five sibling handlers under `erp-queue/` that *act*
  // on these rows already apply exactly this predicate; the two that only read
  // them did not.
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

  try {
    const data = await listAdvanceErpQueue();
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/advance/erp-queue] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
