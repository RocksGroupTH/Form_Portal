import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { uatActorGate } from "@/lib/acc/travel-booking/uat-gate";
import { resolveLoginEmail } from "@/lib/auth-email";
import { findActiveEmployeeByEmail } from "@/lib/hr/employee-lookup";
import { isAdminRole } from "@/lib/roles";
import { getAccPool, sql } from "@/lib/acc/pool";
import { getRequestHost } from "@/lib/acc/erp-environment";
import { isManagerDevBypassHost } from "@/lib/acc/manager-auth";
import { approveByManager, type Actor } from "@/lib/acc/travel-booking/approval";
import { processQueue } from "@/lib/acc/email-queue";
import { AP17_FORM_CODE } from "@/features/travel-booking/constants";

/* ── POST /api/request/travel-booking/requests/[id]/approve ──
   Manager-only, single-step finalize (AP-17 has no ACCOUNT step — Admin fill-in follows). */

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

  // A UAT record is invisible outside the tester group — the id selected the
  // database, membership decides who may touch what it found.
  const uatGate = await uatActorGate(session);
  if (uatGate) return uatGate;

  const pool = await getAccPool();
  const own = await pool.request()
    .input("id", sql.Int, id)
    .input("form", sql.NVarChar, AP17_FORM_CODE)
    .query(`SELECT ManagerStaffId FROM [dbo].[AccRequest] WHERE Id=@id AND FormCode=@form`);
  if (own.recordset.length === 0) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  const managerStaffId = (own.recordset[0]?.ManagerStaffId as number | null) ?? null;

  const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email });
  const { employee } = await findActiveEmployeeByEmail(loginEmail);
  const staffId = employee?.staffId ?? null;

  const isManager = staffId != null && staffId === managerStaffId;
  const isAdmin = isAdminRole(session.user.role);
  // Local dev only, and only when ACC_MANAGER_DEV_BYPASS=1 on a non-production
  // build — see `isManagerDevBypassHost`. The Host header alone no longer opens
  // this, on any host.
  const devBypass = isManagerDevBypassHost(await getRequestHost());
  if (!isManager && !isAdmin && !devBypass) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    // Acting on behalf without an HR record: fall back to the assigned manager's StaffId.
    const actorStaffId = staffId ?? (devBypass ? managerStaffId : null);
    const actor: Actor = {
      staffId: actorStaffId,
      userId: Number(session.user.id),
      email: loginEmail,
      // An admin standing in for the manager is allowed here (AP-1 does not
      // allow it) but must be recorded as such — the approval row otherwise
      // reads as an approval by somebody who is not the assigned manager, with
      // nothing to explain it. See `Actor.onBehalfOfManagerStaffId`.
      onBehalfOfManagerStaffId: !isManager && managerStaffId != null ? managerStaffId : null,
    };
    const updated = await approveByManager(id, actor);
    void processQueue().catch(() => {});
    return NextResponse.json({ ok: true, data: updated });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
