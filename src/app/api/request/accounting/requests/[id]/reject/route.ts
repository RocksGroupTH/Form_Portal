import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getRequest } from "@/lib/acc/request-service";
import { reject } from "@/lib/acc/approval-engine";
import { buildAccActor, resolveAccActorForAction } from "@/lib/acc/actor-context";
import { canAccessAccountArea } from "@/lib/acc/access";
import {
  canActOnClaimBrand,
  INTERFACE_SCOPE_ERROR,
  resolveApproverInterfaceAccess,
} from "@/lib/acc/approver-interface-access";
import {
  interfaceByClaimMapToRecord,
  loadPrepDeptContext,
} from "@/lib/acc/erp-prep-service";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { AP1_FORM_CODE } from "@/features/accounting/constants";
import { canActManagerApi, MANAGER_AUTH_ERROR } from "@/lib/acc/manager-auth";
import { getRequestHost } from "@/lib/acc/erp-environment";
import { processQueue } from "@/lib/acc/email-queue";

/* ── POST /api/request/accounting/requests/[id]/reject ── */

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

  // Reaching the record at all: owner, assigned manager or accounting area —
  // and, on a UAT id, an active tester. See `request-acl-policy`.
  // AP-1 only — a foreign form's id 404s rather than being actioned through
  // AP-1's workflow. See the approve route for why.
  const gate = await authorizeAccRequest(session, id, "read", AP1_FORM_CODE);
  if (gate instanceof Response) return gate;

  const accReq = await getRequest(id);
  if (!accReq) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const stepCode = accReq.currentStepCode;
  if (stepCode !== "MANAGER" && stepCode !== "ACCOUNT") {
    return NextResponse.json(
      { ok: false, error: "ไม่อยู่ในขั้นที่สามารถปฏิเสธได้" },
      { status: 400 },
    );
  }

  const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);

  if (stepCode === "MANAGER") {
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
  }

  if (stepCode === "ACCOUNT") {
    if (!(await canAccessAccountArea(actor.email, session.user.role))) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    // Interface scope, same reasoning as the approve route: rejecting is an
    // action on another interface group's books just as much as approving is —
    // including the form scoping, since this route reaches an `AccRequest` by
    // id and is no more AP-1-specific than the approve route is.
    const [access, deptCtx] = await Promise.all([
      resolveApproverInterfaceAccess(actor.email, session.user.role),
      loadPrepDeptContext(accReq.formCode),
    ]);
    if (!canActOnClaimBrand(access, interfaceByClaimMapToRecord(deptCtx.interfaceByClaim), accReq.brandCode)) {
      return NextResponse.json({ ok: false, error: INTERFACE_SCOPE_ERROR }, { status: 403 });
    }
  }

  try {
    const body = (await req.json()) as { comment: string };
    const fallbackStaffId = stepCode === "MANAGER" ? accReq.managerStaffId : null;
    const actionActor = await resolveAccActorForAction(actor, session.user.role, fallbackStaffId);
    await reject(id, actionActor, stepCode, body.comment);
    const updated = await getRequest(id);
    void processQueue().catch(() => {});
    return NextResponse.json({ ok: true, data: updated });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
