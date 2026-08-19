import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { buildAccActor, resolveAccActorForAction } from "@/lib/acc/actor-context";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { canActManagerApi, MANAGER_AUTH_ERROR } from "@/lib/acc/manager-auth";
import { getRequestHost } from "@/lib/acc/erp-environment";
import { processQueue } from "@/lib/acc/email-queue";
import { statusForAccError } from "@/lib/acc/request-errors";
import { getReimburseRequest } from "@/lib/acc/reimburse/request-service";
import {
  approveReimburseAccountCheck,
  approveReimburseFinal,
  approveReimburseManager,
} from "@/lib/acc/reimburse/approval-service";
import { NOT_AT_STEP_ERROR, stepTokenRefusal } from "@/lib/acc/reimburse/approval-policy";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";

/* ── POST /api/request/reimburse/requests/[id]/approve ── */

/**
 * Approve whichever of AP-4's three steps is currently pending.
 *
 * One endpoint rather than three, as AP-1 does: the request itself says which
 * step it is at, and the dispatch below reads that, never the body.
 *
 * The body does carry a `step`, and it is not the step that gets acted on — it
 * is an optimistic-concurrency token. A client that lies about it can only ever
 * refuse itself; a client that is merely **stale** is the real hazard, and the
 * only one `claimStep` cannot see, because a claim asserts the state the record
 * is in and not the state the actor was looking at. See `stepTokenRefusal`.
 *
 * The URL prefix is what routes this to AP-4's database. `ROUTE_RULES` maps
 * `/api/request/reimburse` to AP-4 and `/api/request/accounting/**` to AP-1, so
 * an AP-1-shaped URL here would silently open the wrong one.
 *
 * Authorization is in two layers, deliberately:
 *  - `authorizeAccRequest` — may this person reach this record at all (and, on a
 *    UAT id, are they a tester). It answers 404 where confirming existence is
 *    itself the leak.
 *  - the step check — the manager step here, because the dev bypass reads the
 *    request `Host`; the accounting pool and the two-person rule inside the
 *    service's own transaction, where no other caller can route around them.
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

  // Read once, after the record is authorized — an unauthorized path still
  // parses nothing — and check the token before anything is dispatched.
  const body = (await req.json().catch(() => ({}))) as {
    step?: unknown;
    paymentDate?: unknown;
  };
  const stale = stepTokenRefusal(body?.step, request.currentStepCode);
  if (stale) {
    return NextResponse.json({ ok: false, error: stale.error }, { status: stale.status });
  }

  const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);

  try {
    if (request.currentStepCode === "MANAGER") {
      // AP-1's rule, not AP-17's: an admin may not action the manager step on
      // somebody's behalf. `canActManagerApi` also carries the dev-host bypass,
      // which is off unless this is a non-production build with
      // ACC_MANAGER_DEV_BYPASS=1 — do not widen it here.
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
      const actionActor = await resolveAccActorForAction(
        actor,
        session.user.role,
        request.managerStaffId,
      );
      await approveReimburseManager(id, actionActor);
    } else if (request.currentStepCode === "ACCOUNT") {
      await approveReimburseAccountCheck(id, actor, body?.paymentDate);
    } else if (request.currentStepCode === "ACCOUNT_FINAL") {
      await approveReimburseFinal(id, actor);
    } else {
      // Already approved, rejected, cancelled or still a draft. 409, not 400:
      // the client should reload rather than be offered a retry.
      return NextResponse.json({ ok: false, error: NOT_AT_STEP_ERROR }, { status: 409 });
    }

    // The services queue their notifications; nothing sends them. Without this
    // drain the mail waits for whatever action happens to flush it next.
    void processQueue().catch(() => {});

    const updated = await getReimburseRequest(id);
    return NextResponse.json({ ok: true, data: updated });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    // 403 for "not your step", 409 for "the request already moved", 400 for a
    // bad payment date — collapsing them to 400 is what `statusForAccError`
    // exists to stop, because 400 is the client's retryable phase.
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(e) });
  }
}
