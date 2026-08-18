import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { resolveLoginEmail } from "@/lib/auth-email";
import { findActiveEmployeeByEmail } from "@/lib/hr/employee-lookup";
import { isAdminRole } from "@/lib/roles";
import { getAccPool, sql } from "@/lib/acc/pool";
import { canAccessAccountArea } from "@/lib/acc/access";
import { getRequestHost } from "@/lib/acc/erp-environment";
import { isManagerDevBypassHost } from "@/lib/acc/manager-auth";
import { rejectRequest, rejectByAdmin, type Actor } from "@/lib/acc/travel-booking/approval";
import { processQueue } from "@/lib/acc/email-queue";
import { AP17_FORM_CODE } from "@/features/travel-booking/constants";

/* ── POST /api/request/travel-booking/requests/[id]/reject ──
   Manager step (Submitted) → manager rejects. Admin booking step (ManagerApproved) →
   account-area Admin rejects instead of booking it (spec §8.1). */

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

  const pool = await getAccPool();
  const own = await pool.request()
    .input("id", sql.Int, id)
    .input("form", sql.NVarChar, AP17_FORM_CODE)
    .query(`SELECT ManagerStaffId, Status, CurrentStepCode FROM [dbo].[AccRequest] WHERE Id=@id AND FormCode=@form`);
  if (own.recordset.length === 0) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  const row = own.recordset[0] as { ManagerStaffId: number | null; Status: string; CurrentStepCode: string | null };
  const managerStaffId = row.ManagerStaffId ?? null;
  const atAdminStage = row.Status === "ManagerApproved" && row.CurrentStepCode === "ADMIN";

  const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email });
  const { employee } = await findActiveEmployeeByEmail(loginEmail);
  const staffId = employee?.staffId ?? null;

  const isManager = staffId != null && staffId === managerStaffId;
  const isAdmin = isAdminRole(session.user.role);
  // Local dev (localhost:3081) — any logged-in user may action the manager step, same as AP-1.
  const devBypass = isManagerDevBypassHost(await getRequestHost());
  const allowed = atAdminStage
    ? await canAccessAccountArea(loginEmail, session.user.role)
    : isManager || isAdmin || devBypass;
  if (!allowed) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = (await req.json()) as { comment?: string };
    const comment = body.comment?.trim() ?? "";
    if (!comment) {
      return NextResponse.json(
        { ok: false, error: "กรุณาระบุเหตุผลที่ไม่อนุมัติ" },
        { status: 400 },
      );
    }
    // Acting on behalf without an HR record: fall back to the assigned manager's StaffId.
    const actorStaffId = staffId ?? (devBypass ? managerStaffId : null);
    const actor: Actor = { staffId: actorStaffId, userId: Number(session.user.id), email: loginEmail };
    const updated = atAdminStage
      ? await rejectByAdmin(id, actor, comment)
      : await rejectRequest(id, actor, comment);
    void processQueue().catch(() => {});
    return NextResponse.json({ ok: true, data: updated });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
