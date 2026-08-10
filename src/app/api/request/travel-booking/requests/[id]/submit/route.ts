import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveLoginEmail } from "@/lib/auth-email";
import { getAccPool, sql } from "@/lib/acc/pool";
import { submitTravelBookingGroup } from "@/lib/acc/travel-booking/request-service";
import { processQueue } from "@/lib/acc/email-queue";
import { isSharePointConfigured, moveSharePointFolder } from "@/lib/sharepoint";
import { buildAccFolderPath, yearFromRequestNo } from "@/lib/acc/sharepoint-path";
import { AP17_FORM_CODE } from "@/features/travel-booking/constants";

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

  try {
    const groupKey = await resolveGroupKey(id);
    if (!groupKey) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }

    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email });
    const submitted = await submitTravelBookingGroup(groupKey, Number(session.user.id), loginEmail);
    void processQueue().catch(() => {});

    // Move each submitted tab's draft SharePoint folder into {year}/{requestNo} (best-effort).
    if (isSharePointConfigured()) {
      for (const req of submitted) {
        if (req.id == null || !req.requestNo) continue;
        const from = buildAccFolderPath({
          requestNo: null, requestId: req.id, year: null, formCode: AP17_FORM_CODE,
        });
        const to = buildAccFolderPath({
          requestNo: req.requestNo, requestId: req.id, year: yearFromRequestNo(req.requestNo), formCode: AP17_FORM_CODE,
        });
        void moveSharePointFolder(from, to);
      }
    }

    return NextResponse.json({ ok: true, data: submitted });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
