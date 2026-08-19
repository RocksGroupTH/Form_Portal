import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { buildAccActor, resolveAccActorForAction } from "@/lib/acc/actor-context";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { canActManagerApi, MANAGER_AUTH_ERROR } from "@/lib/acc/manager-auth";
import { getRequestHost } from "@/lib/acc/erp-environment";
import { processQueue } from "@/lib/acc/email-queue";
import { statusForAccError } from "@/lib/acc/request-errors";
import { getReimburseRequest } from "@/lib/acc/reimburse/request-service";
import { returnReimburse } from "@/lib/acc/reimburse/approval-service";
import {
  NOT_AT_STEP_ERROR,
  isReimburseStepCode,
  stepTokenRefusal,
} from "@/lib/acc/reimburse/approval-policy";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";

/* ── POST /api/request/reimburse/requests/[id]/return ── */

/**
 * Send the request back to the requester for edits, from whichever of AP-4's
 * three steps is pending.
 *
 * The correction path. Without it a submitted claim could only be approved or
 * rejected, and a rejection is terminal — so a fixable mistake cost a second
 * `RBM` number and a full re-key. Nothing downstream needed building: the
 * requester's resume prompt, the drafts query and `submitReimburseRequest`'s
 * keep-the-existing-number branch were all already written against `Returned`
 * and simply unreachable.
 *
 * Deliberately **not** AP-1's `returnForEdit`. That engine is pinned to
 * `AP1_FORM_CODE` — correctly, and pinning it is what removed AP-4's only way
 * back — and it offers the manager step alone.
 *
 * Shaped exactly like the reject route beside it, and for the same reasons:
 *
 *  - the step acted on comes from the **record**, never from the body;
 *  - the body's `step` is an optimistic-concurrency token and nothing else
 *    (`stepTokenRefusal`), so a tab left open at the accounting check cannot
 *    return a claim from a step its owner never saw;
 *  - the note *does* come from the body, and `returnReimburse` refuses an empty
 *    one — a return with no note tells the requester nothing about what to fix,
 *    which is the entire purpose of the action. The dialog's disabled button is
 *    a courtesy, not the control.
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

  const body = (await req.json().catch(() => ({}))) as { step?: unknown; comment?: unknown };
  const stale = stepTokenRefusal(body?.step, step);
  if (stale) {
    return NextResponse.json({ ok: false, error: stale.error }, { status: stale.status });
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
    const actionActor =
      step === "MANAGER"
        ? await resolveAccActorForAction(actor, session.user.role, request.managerStaffId)
        : actor;

    // The accounting pool and the two-person rule are asserted inside the
    // service's own transaction, where no other caller can route around them.
    await returnReimburse(id, actionActor, step, body?.comment);

    void processQueue().catch(() => {});

    const updated = await getReimburseRequest(id);
    return NextResponse.json({ ok: true, data: updated });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(e) });
  }
}
