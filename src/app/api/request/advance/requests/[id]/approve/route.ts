import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getRequest } from "@/lib/adv/advance-request-service";
import { approveCurrentStep } from "@/lib/adv/advance-approval-engine";
import { isAdvanceApprover } from "@/lib/adv/advance-approver-service";
import { stepApproverRole, isStepType } from "@/lib/adv/approval-steps";
import { buildAccActor, resolveAccActorForAction } from "@/lib/acc/actor-context";
import { processQueue } from "@/lib/acc/email-queue";

const NOT_APPROVER = "คุณไม่ได้เป็นผู้อนุมัติในขั้นนี้ของ AP-2";

/**
 * Can this actor act on the current step?
 *  HEAD_DEPT  → the requester's manager (or an admin)
 *  role steps → an active approver of that role (or an admin)
 */
async function canAct(stepType: string, actor: { staffId: number | null; email: string | null }, managerStaffId: number | null, isAdmin: boolean): Promise<boolean> {
  if (isAdmin) return true;
  if (!isStepType(stepType)) return false;
  const role = stepApproverRole(stepType);
  if (role) return isAdvanceApprover(actor.email, role);
  return actor.staffId != null && actor.staffId === managerStaffId; // HEAD_DEPT
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  const { id: rawId } = await params;
  const id = Number(rawId);
  if (Number.isNaN(id)) return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });

  const accReq = await getRequest(id);
  if (!accReq) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const stepType = accReq.currentStepCode;
  if (!stepType) return NextResponse.json({ ok: false, error: "ไม่อยู่ในขั้นอนุมัติ" }, { status: 400 });

  const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);
  const isAdmin = session.user.role === "IT Admin" || session.user.role === "System Admin";
  if (!(await canAct(stepType, actor, accReq.managerStaffId, isAdmin))) {
    return NextResponse.json({ ok: false, error: NOT_APPROVER }, { status: 403 });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { paymentDate?: string; isChecked?: boolean };
    const actionActor = await resolveAccActorForAction(actor, session.user.role, null);
    await approveCurrentStep(id, actionActor, { paymentDate: body.paymentDate, isChecked: body.isChecked });
    const updated = await getRequest(id);
    void processQueue().catch(() => {});
    return NextResponse.json({ ok: true, data: updated });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 400 });
  }
}
