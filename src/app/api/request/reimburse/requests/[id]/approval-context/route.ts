import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { buildAccActor } from "@/lib/acc/actor-context";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { canActManagerApi, canActManagerStep } from "@/lib/acc/manager-auth";
import { getRequestHost } from "@/lib/acc/erp-environment";
import { getReimburseRequest } from "@/lib/acc/reimburse/request-service";
import {
  getReimbursePaymentOptions,
  resolveReimburseApprover,
} from "@/lib/acc/reimburse/approval-service";
import {
  accountCheckActorStaffId,
  finalStepRefusal,
  type ReimburseApprovalContext,
} from "@/lib/acc/reimburse/approval-policy";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";

/* ── GET /api/request/reimburse/requests/[id]/approval-context ── */

/**
 * What the signed-in viewer may do to this request right now, and — on the
 * accounting check — the payment rounds they may choose from.
 *
 * This exists because the detail page cannot work any of it out for itself. Who
 * is on `AccReimburseApprover` is a database question the client must not be
 * handed the answer to wholesale (it would mean shipping the roster to every
 * viewer), the payment rounds need `Rocks_Codex.Holiday`, and the two-person
 * rule needs the step-2 actor. Every answer here is recomputed server-side by
 * the approve/reject routes before anything is written — this is what the page
 * draws, never what it is allowed to do.
 *
 * Read-only, and gated by the same `authorizeAccRequest(…, "read")` as the
 * record it describes.
 */
export async function GET(
  _req: NextRequest,
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

  try {
    const request = await getReimburseRequest(id);
    if (!request) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }

    const step = request.currentStepCode;
    const empty: ReimburseApprovalContext = {
      step: step ?? null,
      canAct: false,
      reason: null,
      viaManagerDevBypass: false,
      paymentDates: [],
      defaultPaymentDate: null,
    };
    if (!step) return NextResponse.json({ ok: true, data: empty });

    const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);

    if (step === "MANAGER") {
      const host = await getRequestHost();
      const pending =
        request.approvals?.find((a) => a.stepCode === "MANAGER" && a.status === "Pending") ?? null;
      const assigned = canActManagerStep(
        actor.staffId, actor.email, request.managerStaffId, pending, null, false,
      );
      const withBypass = canActManagerApi(
        actor.staffId, request.managerStaffId, session.user.role, host, pending, actor.email,
      );
      return NextResponse.json({
        ok: true,
        data: { ...empty, canAct: withBypass, viaManagerDevBypass: withBypass && !assigned },
      });
    }

    // Both accounting steps answer to `AccReimburseApprover` — one pool, and
    // AP-4 approvals are not brand-gated the way AP-1's are.
    const approver = await resolveReimburseApprover(actor);
    if (!approver) return NextResponse.json({ ok: true, data: empty });

    if (step === "ACCOUNT_FINAL") {
      // Named refusal, not silence: the person genuinely is an approver, and a
      // missing button with no explanation reads as a bug.
      const refusal = finalStepRefusal(
        approver.staffId,
        accountCheckActorStaffId(request.approvals),
      );
      return NextResponse.json({
        ok: true,
        data: { ...empty, canAct: refusal == null, reason: refusal },
      });
    }

    const options = await getReimbursePaymentOptions();
    return NextResponse.json({
      ok: true,
      data: {
        ...empty,
        canAct: true,
        paymentDates: options.dates,
        defaultPaymentDate: options.defaultDate,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    console.error("[api/request/reimburse/requests/[id]/approval-context] GET", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
