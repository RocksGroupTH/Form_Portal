import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { buildAccActor, resolveAccActorForAction } from "@/lib/acc/actor-context";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { canActManagerApi, MANAGER_AUTH_ERROR } from "@/lib/acc/manager-auth";
import { getRequestHost } from "@/lib/acc/erp-environment";
import { processQueue } from "@/lib/acc/email-queue";
import { statusForAccError } from "@/lib/acc/request-errors";
import { getReimburseRequest } from "@/lib/acc/reimburse/request-service";
import { rejectReimburse } from "@/lib/acc/reimburse/approval-service";
import { NOT_AT_STEP_ERROR, isReimburseStepCode } from "@/lib/acc/reimburse/approval-policy";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";

/* ── POST /api/request/reimburse/requests/[id]/reject ── */

/**
 * Reject at whichever of AP-4's three steps is pending. A rejection ends the
 * request: `Rejected`, `CurrentStepCode` cleared, the reason on the timeline.
 *
 * The step comes from the record, never from the body, for the same reason the
 * approve route works that way. The **reason** does come from the body, and the
 * service refuses an empty one — see `rejectReimburse`; the dialog's disabled
 * button is a courtesy, not the control.
 */
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

  const gate = await authorizeAccRequest(session, id, "read", AP4_FORM_CODE);
  if (gate instanceof Response) return gate;

  const request = await getReimburseRequest(id);
  if (!request) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const step = request.currentStepCode;
  if (!isReimburseStepCode(step)) {
    return NextResponse.json({ ok: false, error: NOT_AT_STEP_ERROR }, { status: 409 });
  }

  const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);

  if (step === "MANAGER") {
    // AP-1's rule: the assigned manager only, plus the default-off dev bypass.
    const host = await getRequestHost();
    const pending =
      request.approvals?.find((a) => a.stepCode === "MANAGER" && a.status === "Pending") ?? null;
    if (
      !canActManagerApi(
        actor.staffId,
        request.managerStaffId,
        session.user.role,
        host,
        pending,
        actor.email,
      )
    ) {
      return NextResponse.json({ ok: false, error: MANAGER_AUTH_ERROR }, { status: 403 });
    }
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { comment?: unknown };
    const actionActor =
      step === "MANAGER"
        ? await resolveAccActorForAction(actor, session.user.role, request.managerStaffId)
        : actor;

    await rejectReimburse(id, actionActor, step, body?.comment);

    void processQueue().catch(() => {});

    const updated = await getReimburseRequest(id);
    return NextResponse.json({ ok: true, data: updated });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(e) });
  }
}
