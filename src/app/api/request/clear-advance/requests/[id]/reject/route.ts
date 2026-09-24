import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getRequest } from "@/lib/clr/clear-advance-request-service";
import { reject } from "@/lib/clr/clear-advance-approval-engine";
import { isClrApprover } from "@/lib/clr/clear-advance-approver-service";
import { buildAccActor, resolveAccActorForAction } from "@/lib/acc/actor-context";
import { mayActOnManagerStepApi, MANAGER_AUTH_ERROR } from "@/lib/acc/manager-auth";
import { getRequestHost } from "@/lib/acc/erp-environment";
import { processQueue } from "@/lib/acc/email-queue";
import { isAdminRole } from "@/lib/roles";

/* ── POST /api/request/clear-advance/requests/[id]/reject ── */

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

  const clrReq = await getRequest(id);
  if (!clrReq) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  const step = clrReq.currentStepCode;
  if (step !== "MANAGER" && step !== "ACCOUNT") {
    return NextResponse.json({ ok: false, error: "ไม่อยู่ในขั้นที่สามารถปฏิเสธได้" }, { status: 400 });
  }

  const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);

  // Who HR (or UatTester, in UAT) says is the requester's manager RIGHT NOW.
  // Null means HR has nothing usable to say, and the snapshot below answers
  // instead — see `current-manager.ts` for why absence abstains.
  const currentManager = clrReq.currentManager;

  if (step === "MANAGER") {
    const host = await getRequestHost();
    const pendingMgr =
      clrReq.approvals?.find((a) => a.stepCode === "MANAGER" && a.status === "Pending") ?? null;
    if (
      !mayActOnManagerStepApi(
        { staffId: actor.staffId, email: actor.email },
        {
          current: currentManager,
          snapshotStaffId: clrReq.managerStaffId,
          approval: pendingMgr ? { assignedTo: pendingMgr.assignedStaffId, assignedEmail: pendingMgr.assignedEmail, status: pendingMgr.status } : null,
        },
        host,
      )
    ) {
      return NextResponse.json({ ok: false, error: MANAGER_AUTH_ERROR }, { status: 403 });
    }
  } else {
    const allowed = (await isClrApprover(actor.email, step)) || isAdminRole(session.user.role);
    if (!allowed) {
      return NextResponse.json({ ok: false, error: "ไม่มีสิทธิ์ในขั้นนี้" }, { status: 403 });
    }
  }

  try {
    const body = (await req.json()) as { comment: string };
    const fallbackStaffId = step === "MANAGER" ? clrReq.managerStaffId : null;
    const actionActor = await resolveAccActorForAction(actor, session.user.role, fallbackStaffId);
    await reject(id, actionActor, step, body.comment);
    const updated = await getRequest(id);
    void processQueue().catch(() => {});
    return NextResponse.json({ ok: true, data: updated });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
