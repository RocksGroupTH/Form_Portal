import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { statusForAccError } from "@/lib/acc/request-errors";
import { uatActorGate } from "@/lib/acc/travel-booking/uat-gate";
import { resolveLoginEmail } from "@/lib/auth-email";
import { getAccPool, sql } from "@/lib/acc/pool";
import { submitTravelBookingGroup } from "@/lib/acc/travel-booking/request-service";
import { processQueue } from "@/lib/acc/email-queue";
import { isSharePointConfigured, moveSharePointFolder } from "@/lib/sharepoint";
import { buildAccFolderPath, yearFromRequestNo } from "@/lib/acc/sharepoint-path";
import { AP17_FORM_CODE } from "@/features/travel-booking/constants";
import { resolveFormEnvironment } from "@/lib/form-environment";

/** This tab's GroupKey — submit acts on the whole draft group, producing N documents. */
async function resolveGroupKey(requestId: number): Promise<string | null> {
  const pool = await getAccPool();
  const r = await pool.request().input("id", sql.Int, requestId)
    .query(`SELECT GroupKey FROM [dbo].[AccTravelBooking] WHERE RequestId = @id`);
  return (r.recordset[0]?.GroupKey as string) ?? null;
}

/* ── POST /api/request/travel-booking/requests/[id]/submit — submits the whole group ── */

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

  // Tester-only on a UAT record. See `uatActorGate`.
  const uatGate = await uatActorGate(session);
  if (uatGate) return uatGate;

  try {
    const groupKey = await resolveGroupKey(id);
    if (!groupKey) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }

    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email });
    const submitted = await submitTravelBookingGroup(groupKey, Number(session.user.id), loginEmail);
    void processQueue().catch(() => {});

    // Move each submitted tab's draft SharePoint folder into {year}/{requestNo} (best-effort).
    // Both ends need the same environment: a UAT draft's files were uploaded
    // under `_UAT`, so a move computed against the production tree would look
    // for a folder that is not there and leave the draft folder behind.
    if (isSharePointConfigured()) {
      const environment = await resolveFormEnvironment();
      for (const req of submitted) {
        if (req.id == null || !req.requestNo) continue;
        const from = buildAccFolderPath({
          requestNo: null, requestId: req.id, year: null, formCode: AP17_FORM_CODE, environment,
        });
        const to = buildAccFolderPath({
          requestNo: req.requestNo, requestId: req.id, year: yearFromRequestNo(req.requestNo),
          formCode: AP17_FORM_CODE, environment,
        });
        void moveSharePointFolder(from, to);
      }
    }

    return NextResponse.json({ ok: true, data: submitted });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    // 409 when the in-transaction claim found a tab already submitted, so the
    // client reloads instead of being offered a retry that cannot succeed.
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(e) });
  }
}
