import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getRequest } from "@/lib/acc/request-service";
import { approveManager, approveAccount } from "@/lib/acc/approval-engine";
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

/* ── POST /api/request/accounting/requests/[id]/approve ── */

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
  // and, on a UAT id, an active tester. Without this a real accountant could
  // approve test data by typing its number. See `request-acl-policy`.
  // AP-1 only. Every Acc* form shares [dbo].[AccRequest], and AP-4 parks a
  // request at the same (ManagerApproved, ACCOUNT) tuple this route's account
  // step claims — so without the form pin an AP-1 accountant could finalize an
  // AP-4 claim through this URL, skipping AP-4's ACCOUNT_FINAL step and its
  // two-person rule entirely. A foreign id now 404s here, and every claim in
  // `approval-engine` names FormCode as well.
  const gate = await authorizeAccRequest(session, id, "read", AP1_FORM_CODE);
  if (gate instanceof Response) return gate;

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
      const actionActor = await resolveAccActorForAction(
        actor,
        session.user.role,
        accReq.managerStaffId,
      );
      await approveManager(id, actionActor);
    } else if (accReq.currentStepCode === "ACCOUNT") {
      if (!(await canAccessAccountArea(actor.email, session.user.role))) {
        return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
      }
    // Interface scope, not just "works in accounting". A KSI-only approver
    // could approve and reject PCTH's claims — the ERP-prep list filtered rows
    // by interface brand but these workflow actions never did, and approving is
    // what puts a document in the send queue in the first place.
    //
    // Scoped to *this request's* form, not AP-1. This route reaches an
    // `AccRequest` by id and every Accounting form writes to that table, so the
    // record here need not be AP-1's. The interface map it resolves is an
    // authorization input — `canActOnClaimBrand` reads it to decide whose books
    // these are — so resolving AP-1's map for an AP-17 request would authorize
    // the approval against another form's brand scoping the moment a
    // form-specific `AccBrandErpInterface` row exists. Identical today, because
    // every row in that table is still a default.
    const [access, deptCtx] = await Promise.all([
      resolveApproverInterfaceAccess(actor.email, session.user.role),
      loadPrepDeptContext(accReq.formCode),
    ]);
    if (!canActOnClaimBrand(access, interfaceByClaimMapToRecord(deptCtx.interfaceByClaim), accReq.brandCode)) {
      return NextResponse.json({ ok: false, error: INTERFACE_SCOPE_ERROR }, { status: 403 });
    }
      const body = (await req.json()) as { paymentDate: string; isChecked: boolean };
      const actionActor = await resolveAccActorForAction(actor, session.user.role, null);
      await approveAccount(id, actionActor, body.paymentDate, body.isChecked);
    } else {
      return NextResponse.json(
        { ok: false, error: "ไม่อยู่ในขั้นอนุมัติ" },
        { status: 400 },
      );
    }

    const updated = await getRequest(id);
    void processQueue().catch(() => {});
    return NextResponse.json({ ok: true, data: updated });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
