import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import {
  getReimburseRequest,
  submitReimburseRequest,
} from "@/lib/acc/reimburse/request-service";
import { processQueue } from "@/lib/acc/email-queue";
import { isSharePointConfigured, moveSharePointFolder } from "@/lib/sharepoint";
import { buildAccFolderPath, yearFromRequestNo } from "@/lib/acc/sharepoint-path";
import { resolveFormEnvironment } from "@/lib/form-environment";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { statusForAccError } from "@/lib/acc/request-errors";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";

/* ── POST /api/request/reimburse/requests/[id]/submit ── */

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

  // Owner and editable state before anything else runs. The service's claim
  // also asserts `CreatedBy` inside its transaction, so this is the second of
  // two independent checks rather than the only one — but it is the one that
  // refuses before a manager is resolved out of HR, and the one that carries
  // the UAT tester barrier.
  const gate = await authorizeAccRequest(session, id, "mutate", AP4_FORM_CODE);
  if (gate instanceof Response) return gate;

  try {
    await submitReimburseRequest(id, Number(session.user.id));

    // The service queues the manager notification; nothing sends it. Without
    // this drain the mail sits in AccEmailQueue until some other action
    // happens to flush it, which on a quiet day is hours.
    void processQueue().catch(() => {});

    const request = await getReimburseRequest(id);

    // Move the draft's SharePoint folder into {year}/{requestNo}, best-effort,
    // exactly as AP-1's submit does — otherwise every AP-4 attachment stays
    // filed under `_DRAFT/{id}` forever. Both ends need the same environment: a
    // UAT draft's files went under `_UAT`, so a move computed against the
    // production tree would look for a folder that is not there.
    const requestNo = request?.requestNo ?? null;
    if (isSharePointConfigured() && requestNo) {
      const environment = await resolveFormEnvironment();
      const from = buildAccFolderPath({
        requestNo: null,
        requestId: id,
        year: null,
        formCode: AP4_FORM_CODE,
        environment,
      });
      const to = buildAccFolderPath({
        requestNo,
        requestId: id,
        year: yearFromRequestNo(requestNo),
        formCode: AP4_FORM_CODE,
        environment,
      });
      void moveSharePointFolder(from, to);
    }

    return NextResponse.json({ ok: true, data: request });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    // The service throws named Thai validation messages (400), and
    // `AccConflictError` when the claim finds the row already submitted (409)
    // — the client should reload rather than be offered a retry that cannot
    // succeed. Collapsing both to 400 is what `statusForAccError` exists to
    // stop.
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(e) });
  }
}
