import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { submitRequest } from "@/lib/acc/request-service";
import { resolveRequesterForActor } from "@/lib/acc/employee-context";
import { processQueue } from "@/lib/acc/email-queue";
import { isSharePointConfigured, moveSharePointFolder } from "@/lib/sharepoint";
import { buildAccFolderPath, yearFromRequestNo } from "@/lib/acc/sharepoint-path";
import { resolveLoginEmail } from "@/lib/auth-email";
import { resolveFormEnvironment } from "@/lib/form-environment";
import { getAccPool } from "@/lib/acc/pool";
import { sql } from "@/lib/db/mssql";

/* ── POST /api/request/accounting/requests/[id]/submit ── */

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
    const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email }) ?? "";
    const pool = await getAccPool();
    const draft = await pool.request().input("id", sql.Int, Number(id))
      .query(`SELECT StaffId FROM [dbo].[AccRequest] WHERE Id=@id`);
    const savedStaffId = (draft.recordset[0]?.StaffId as number | null) ?? null;
    const requester = await resolveRequesterForActor(loginEmail, savedStaffId);

    const req = await submitRequest(id, requester, Number(session.user.id));
    void processQueue().catch(() => {});

    // Move the draft's SharePoint folder into {year}/{requestNo} (best-effort).
    // Both ends need the same environment: a UAT draft's files were uploaded
    // under `_UAT`, so a move computed against the production tree would look
    // for a folder that is not there and leave the draft folder behind.
    const requestNo = req.requestNo ?? null;
    if (isSharePointConfigured() && requestNo) {
      const environment = await resolveFormEnvironment();
      const from = buildAccFolderPath({ requestNo: null, requestId: id, year: null, environment });
      const to = buildAccFolderPath({
        requestNo, requestId: id, year: yearFromRequestNo(requestNo), environment,
      });
      void moveSharePointFolder(from, to);
    }

    return NextResponse.json({ ok: true, data: req });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
