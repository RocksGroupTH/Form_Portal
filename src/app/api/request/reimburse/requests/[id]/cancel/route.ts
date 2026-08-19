import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { buildAccActor } from "@/lib/acc/actor-context";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { processQueue } from "@/lib/acc/email-queue";
import { statusForAccError } from "@/lib/acc/request-errors";
import { getReimburseRequest } from "@/lib/acc/reimburse/request-service";
import { cancelReimburseByRequester } from "@/lib/acc/reimburse/approval-service";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";

/* ── POST /api/request/reimburse/requests/[id]/cancel ── */

/**
 * The requester withdraws their own claim, within 24 hours of submitting and
 * only while the manager still has it (spec §5.3).
 *
 * No body, and no step token: there is exactly one state this can be invoked
 * from, and the claim inside `cancelReimburseByRequester` names it. Nothing here
 * is a decision — the service reads the creator, the status, the step and the
 * server's own clock, refuses with the one of three messages that fits, and then
 * re-asserts all three conditions inside the transaction that writes.
 *
 * `"read"` on the object ACL rather than `"mutate"`, like approve and reject:
 * `decideRequestMutate` admits `Draft`/`Returned` only, and a request eligible
 * for withdrawal is by definition `Submitted`. The gate that matters for this
 * action is the creator check, and it is the service's, applied against
 * `AccRequest.CreatedBy` rather than anything the caller sends.
 */
export async function POST(
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
    const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);
    await cancelReimburseByRequester(id, actor);

    // The service queues the manager's notification; nothing sends it.
    void processQueue().catch(() => {});

    const updated = await getReimburseRequest(id);
    return NextResponse.json({ ok: true, data: updated });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    // 403 for "not your request", 409 for "the manager already acted" and for
    // "past the window" — both of which reloading explains and retrying cannot
    // fix. 400 is the client's retryable phase and would invite exactly that.
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(e) });
  }
}
