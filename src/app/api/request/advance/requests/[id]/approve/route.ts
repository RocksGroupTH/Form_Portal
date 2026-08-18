import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getRequest } from "@/lib/adv/advance-request-service";
import { approveManager, approveAccount } from "@/lib/adv/advance-approval-engine";
import { buildAccActor, resolveAccActorForAction } from "@/lib/acc/actor-context";
import { canAccessAccountArea } from "@/lib/acc/access";
import { canActManagerApi, MANAGER_AUTH_ERROR } from "@/lib/acc/manager-auth";
import { getRequestHost } from "@/lib/acc/erp-environment";
import { processQueue } from "@/lib/acc/email-queue";

/* ── POST /api/request/advance/requests/[id]/approve ── */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (Number.isNaN(id)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  const accReq = await getRequest(id);
  if (!accReq) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);

  try {
    if (accReq.currentStepCode === "MANAGER") {
      const host = await getRequestHost();
      const pendingMgr =
        accReq.approvals?.find((a) => a.stepCode === "MANAGER" && a.status === "Pending") ?? null;
      if (
        !canActManagerApi(
          actor.staffId,
          accReq.managerStaffId,
          session.user.role,
          host,
          pendingMgr,
          actor.email,
        )
      ) {
        return NextResponse.json({ ok: false, error: MANAGER_AUTH_ERROR }, { status: 403 });
      }
      const actionActor = await resolveAccActorForAction(actor, session.user.role, accReq.managerStaffId);
      await approveManager(id, actionActor);
    } else if (accReq.currentStepCode === "ACCOUNT") {
      if (!(await canAccessAccountArea(actor.email, session.user.role))) {
        return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
      }
      const body = (await req.json()) as { paymentDate: string; isChecked: boolean };
      const actionActor = await resolveAccActorForAction(actor, session.user.role, null);
      await approveAccount(id, actionActor, body.paymentDate, body.isChecked);
    } else {
      return NextResponse.json({ ok: false, error: "ไม่อยู่ในขั้นอนุมัติ" }, { status: 400 });
    }

    const updated = await getRequest(id);
    void processQueue().catch(() => {});
    return NextResponse.json({ ok: true, data: updated });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
