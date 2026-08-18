import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getRequest } from "@/lib/adv/advance-request-service";
import { rejectCurrentStep } from "@/lib/adv/advance-approval-engine";
import { isAdvanceApprover } from "@/lib/adv/advance-approver-service";
import { stepApproverRole, isStepType } from "@/lib/adv/approval-steps";
import { buildAccActor, resolveAccActorForAction } from "@/lib/acc/actor-context";
import { processQueue } from "@/lib/acc/email-queue";

const NOT_APPROVER = "คุณไม่ได้เป็นผู้อนุมัติในขั้นนี้ของ AP-2";

async function canAct(stepType: string, actor: { staffId: number | null; email: string | null }, managerStaffId: number | null, isAdmin: boolean): Promise<boolean> {
  if (isAdmin) return true;
  if (!isStepType(stepType)) return false;
  const role = stepApproverRole(stepType);
  if (role) return isAdvanceApprover(actor.email, role);
  return actor.staffId != null && actor.staffId === managerStaffId;
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
  if (!stepType) return NextResponse.json({ ok: false, error: "ไม่อยู่ในขั้นที่ปฏิเสธได้" }, { status: 400 });

  const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);
  const isAdmin = session.user.role === "IT Admin" || session.user.role === "System Admin";
  if (!(await canAct(stepType, actor, accReq.managerStaffId, isAdmin))) {
    return NextResponse.json({ ok: false, error: NOT_APPROVER }, { status: 403 });
  }

  try {
    const body = (await req.json()) as { comment: string };
    const actionActor = await resolveAccActorForAction(actor, session.user.role, null);
    await rejectCurrentStep(id, actionActor, body.comment);
    const updated = await getRequest(id);
    void processQueue().catch(() => {});
    return NextResponse.json({ ok: true, data: updated });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "error" }, { status: 400 });
  }
}
