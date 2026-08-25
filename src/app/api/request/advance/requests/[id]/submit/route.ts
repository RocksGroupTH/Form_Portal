import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { submitRequest } from "@/lib/adv/advance-request-service";
import { resolveRequesterForActor } from "@/lib/acc/employee-context";
import { processQueue } from "@/lib/acc/email-queue";
import { resolveLoginEmail } from "@/lib/auth-email";
import { getAccPool } from "@/lib/adv/pool";
import { sql } from "@/lib/db/mssql";

/* ── POST /api/request/advance/requests/[id]/submit ── */
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
    const draft = await pool.request().input("id", sql.Int, id)
      .query(`SELECT StaffId FROM [dbo].[AccRequest] WHERE Id=@id`);
    const savedStaffId = (draft.recordset[0]?.StaffId as number | null) ?? null;
    const requester = await resolveRequesterForActor(loginEmail, savedStaffId);

    const req = await submitRequest(id, requester, Number(session.user.id));
    void processQueue().catch(() => {});
    return NextResponse.json({ ok: true, data: req });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
