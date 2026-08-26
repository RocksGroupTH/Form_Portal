import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getReimburseRequest } from "@/lib/acc/reimburse/request-service";
import { deleteReimburseDraft } from "@/lib/acc/reimburse/delete-service";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { statusForAccError } from "@/lib/acc/request-errors";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";

/* ── GET /api/request/reimburse/requests/[id] ── */

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

  // The record carries the requester's name, department, every line of what
  // they spent and the ids of their receipts, behind a small sequential
  // integer. Authorize the object before reading it, not just the session.
  // Pinned to AP-4: `AccRequest` holds every form, so an AP-1 id would
  // otherwise be authorized here and then read as a request that does not
  // exist. It answers 404, which is also the UAT barrier's answer.
  const gate = await authorizeAccRequest(session, id, "read", AP4_FORM_CODE);
  if (gate instanceof Response) return gate;

  try {
    const request = await getReimburseRequest(id);
    if (!request) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, data: request });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    console.error("[api/request/reimburse/requests/[id]] GET", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/* ── DELETE /api/request/reimburse/requests/[id] — discard an editable draft ── */

/**
 * Creator-only, `Draft`/`Returned` only, through the same object ACL every other
 * by-id path uses — and pinned to AP-4, so an AP-1 or AP-17 id answers 404 here
 * rather than being deleted by AP-4's code.
 *
 * The gate is not the whole control: `deleteReimburseDraft` claims the state
 * again with a conditional `UPDATE` inside its transaction, because the ACL read
 * and the delete are two round trips and a submit can land between them.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  const gate = await authorizeAccRequest(session, id, "mutate", AP4_FORM_CODE);
  if (gate instanceof Response) return gate;

  try {
    await deleteReimburseDraft(id, Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    console.error("[api/request/reimburse/requests/[id]] DELETE", message);
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(e) });
  }
}
