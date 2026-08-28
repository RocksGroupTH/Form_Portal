import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { submitRequest } from "@/lib/clr/clear-advance-request-service";
import { resolveRequesterForActor } from "@/lib/acc/employee-context";
import { processQueue } from "@/lib/acc/email-queue";
import { isSharePointConfigured, moveSharePointFolder } from "@/lib/sharepoint";
import { buildAccFolderPath, yearFromRequestNo } from "@/lib/acc/sharepoint-path";
import { resolveLoginEmail } from "@/lib/auth-email";
import { resolveFormEnvironment } from "@/lib/form-environment";
import { getAccPool } from "@/lib/acc/pool";
import { sql } from "@/lib/db/mssql";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { AP3_FORM_CODE } from "@/features/clear-advance/constants";

/* ── POST /api/request/clear-advance/requests/[id]/submit ── */

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

  // Creator + Draft/Returned — the same gap AP-2's submit carried, and the same
  // fix. `submitRequest` tests the status alone, so any signed-in session could
  // submit anyone else's AP-3 draft, allocate its running number and have its
  // SharePoint draft folder moved under the resulting request number.
  const gate = await authorizeAccRequest(session, id, "mutate", AP3_FORM_CODE);
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
