import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getRequest } from "@/lib/adv/advance-request-service";
import { approveCurrentStep } from "@/lib/adv/advance-approval-engine";
import { isAdvanceApprover } from "@/lib/adv/advance-approver-service";
import { stepApproverRole, isStepType } from "@/lib/adv/approval-steps";
import { buildAccActor, resolveAccActorForAction } from "@/lib/acc/actor-context";
import { processQueue } from "@/lib/acc/email-queue";

interface Actor { staffId: number | null; email: string | null }

async function canAct(
  stepType: string, actor: Actor, managerStaffId: number | null, isAdmin: boolean,
): Promise<boolean> {
  if (isAdmin) return true;
  if (!isStepType(stepType)) return false;
  const role = stepApproverRole(stepType);
  if (role) return isAdvanceApprover(actor.email, role);
  return actor.staffId != null && actor.staffId === managerStaffId; // HEAD_DEPT
}

interface ItemResult { id: number; ok: boolean; error?: string }

/** POST — approve the current step of many AP-2 requests at once (bulk). */
export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const body = (await req.json().catch(() => ({}))) as {
    ids?: number[]; paymentDate?: string; isChecked?: boolean;
  };
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => Number.isFinite(x)) : [];
  if (ids.length === 0) {
    return NextResponse.json({ ok: false, error: "ไม่ได้เลือกรายการ" }, { status: 400 });
  }

  const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);
  const isAdmin = session.user.role === "IT Admin" || session.user.role === "System Admin";
  const actionActor = await resolveAccActorForAction(actor, session.user.role, null);

  const results: ItemResult[] = [];
  for (const id of ids) {
    try {
      const reqRow = await getRequest(id);
      if (!reqRow) { results.push({ id, ok: false, error: "ไม่พบคำขอ" }); continue; }
      const stepType = reqRow.currentStepCode;
      if (!stepType) { results.push({ id, ok: false, error: "ไม่อยู่ในขั้นอนุมัติ" }); continue; }
      if (!(await canAct(stepType, actor, reqRow.managerStaffId, isAdmin))) {
        results.push({ id, ok: false, error: "ไม่ใช่ผู้อนุมัติขั้นนี้" }); continue;
      }
      await approveCurrentStep(id, actionActor, {
        paymentDate: body.paymentDate, isChecked: body.isChecked,
      });
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, error: e instanceof Error ? e.message : "ผิดพลาด" });
    }
  }

  void processQueue().catch(() => {});
  const okCount = results.filter((r) => r.ok).length;
  return NextResponse.json({ ok: okCount > 0, okCount, failCount: results.length - okCount, results });
}
