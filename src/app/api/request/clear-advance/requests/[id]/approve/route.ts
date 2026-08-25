import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getRequest } from "@/lib/clr/clear-advance-request-service";
import { approveCurrentStep } from "@/lib/clr/clear-advance-approval-engine";
import { isClrApprover } from "@/lib/clr/clear-advance-approver-service";
import { buildAccActor, resolveAccActorForAction } from "@/lib/acc/actor-context";
import { canActManagerApi, MANAGER_AUTH_ERROR } from "@/lib/acc/manager-auth";
import { getRequestHost } from "@/lib/acc/erp-environment";
import { processQueue } from "@/lib/acc/email-queue";
import { isAdminRole } from "@/lib/roles";

/* ── POST /api/request/clear-advance/requests/[id]/approve ── */

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
  if (step !== "MANAGER" && step !== "ACCOUNT" && step !== "HEAD") {
    return NextResponse.json({ ok: false, error: "ไม่อยู่ในขั้นอนุมัติ" }, { status: 400 });
  }

  const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);

  try {
    if (step === "MANAGER") {
      const host = await getRequestHost();
      const pendingMgr =
        clrReq.approvals?.find((a) => a.stepCode === "MANAGER" && a.status === "Pending") ?? null;
      if (
        !canActManagerApi(
          actor.staffId,
          clrReq.managerStaffId,
          session.user.role,
          host,
          pendingMgr ? { assignedTo: pendingMgr.assignedStaffId, assignedEmail: pendingMgr.assignedEmail, status: pendingMgr.status } : null,
          actor.email,
        )
      ) {
        return NextResponse.json({ ok: false, error: MANAGER_AUTH_ERROR }, { status: 403 });
      }
      const actionActor = await resolveAccActorForAction(actor, session.user.role, clrReq.managerStaffId);
      await approveCurrentStep(id, actionActor);
    } else {
      // ACCOUNT or HEAD — configured AP-3 approver of that role, or an admin.
      const role = step; // "ACCOUNT" | "HEAD"
      const allowed = (await isClrApprover(actor.email, role)) || isAdminRole(session.user.role);
      if (!allowed) {
        return NextResponse.json({ ok: false, error: "ไม่มีสิทธิ์อนุมัติในขั้นนี้" }, { status: 403 });
      }
      const body = (await req.json().catch(() => ({}))) as {
        isChecked?: boolean;
        pvDocNo?: string | null;
        paymentDate?: string | null;
      };
      await approveCurrentStep(id, actor, {
        isChecked: body.isChecked,
        pvDocNo: body.pvDocNo ?? null,
        paymentDate: body.paymentDate ?? null,
      });
    }

    const updated = await getRequest(id);
    void processQueue().catch(() => {});
    return NextResponse.json({ ok: true, data: updated });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
