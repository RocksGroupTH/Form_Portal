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
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { statusForAccError } from "@/lib/acc/request-errors";
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

  // Owner and editable state, before the requester is even resolved. The route
  // used to submit whatever id it was handed: `submitRequest` checked the
  // status but never `CreatedBy`, so any authenticated session could submit
  // somebody else's draft — under that person's name, to that person's manager.
  const gate = await authorizeAccRequest(session, id, "mutate");
  if (gate instanceof Response) return gate;

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
    // 409 when the in-transaction claim found the row already submitted, so the
    // client reloads instead of being offered a retry that cannot succeed.
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(e) });
  }
}
