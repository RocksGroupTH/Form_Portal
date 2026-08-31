import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { uatActorGate } from "@/lib/acc/travel-booking/uat-gate";
import { resolveLoginEmail } from "@/lib/auth-email";
import { findActiveEmployeeByEmail } from "@/lib/hr/employee-lookup";
import { isAdminRole } from "@/lib/roles";
import { getAccPool, sql } from "@/lib/acc/pool";
import { canAccessBookingArea } from "@/lib/acc/booking-access";
import { requireBookingBrandScope } from "@/lib/acc/travel-booking/require-booking-brand-scope";
import { getRequestHost } from "@/lib/acc/erp-environment";
import { isManagerDevBypassHost } from "@/lib/acc/manager-auth";
import { returnRequest, returnByAdmin, returnByAccount, type Actor } from "@/lib/acc/travel-booking/approval";
import { processQueue } from "@/lib/acc/email-queue";
import { AP17_FORM_CODE } from "@/features/travel-booking/constants";

/* ── POST /api/request/travel-booking/requests/[id]/return ──
   Manager step (Submitted) → manager returns it. Admin booking step (ManagerApproved/ADMIN) →
   account-area Admin bounces it back to the requester instead of booking it (spec §8.1).
   Accounting step (ManagerApproved/ACCOUNT) → the sign-off desk hands it back one step, to
   Admin, for the booking to be corrected — the request stays approved and alive.

   The step, not the status: `ManagerApproved` names both post-manager stages, and each of the
   three services claims its own `CurrentStepCode` in its own UPDATE, so picking the wrong
   branch here is refused rather than mis-applied. Before the accounting stage existed, an
   ACCOUNT request fell through to the manager branch and was refused outright — leaving the
   accountant with no exit but approve. */

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

  // A UAT record is invisible outside the tester group — the id selected the
  // database, membership decides who may touch what it found.
  const uatGate = await uatActorGate(session);
  if (uatGate) return uatGate;

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
  const atAccountStage = row.Status === "ManagerApproved" && row.CurrentStepCode === "ACCOUNT";

  const loginEmail = resolveLoginEmail(session.user, null, { email: session.user.email });
  const { employee } = await findActiveEmployeeByEmail(loginEmail);
  const staffId = employee?.staffId ?? null;

  const isManager = staffId != null && staffId === managerStaffId;
  const isAdmin = isAdminRole(session.user.role);
  // Local dev only, and only when ACC_MANAGER_DEV_BYPASS=1 on a non-production
  // build — see `isManagerDevBypassHost`. The Host header alone no longer opens
  // this, on any host.
  const devBypass = isManagerDevBypassHost(await getRequestHost());
  // Both post-manager stages are the booking area's own, so both are authorized
  // the way the ACCOUNT step's other route (`account-approve`) is.
  const allowed = atAdminStage || atAccountStage
    ? await canAccessBookingArea(loginEmail, session.user.role)
    : isManager || isAdmin || devBypass;
  if (!allowed) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  // The brand scope applies to the booking area's own two stages. A manager
  // acting on their own report, or an owner, is not scoped by it — they are
  // authorized by the branch above, which the roster never entered.
  if (atAdminStage || atAccountStage) {
    const scoped = await requireBookingBrandScope(session.user, id);
    if (scoped) return scoped;
  }

  try {
    const body = (await req.json()) as { comment?: string };
    const comment = body.comment?.trim() ?? "";
    if (!comment) {
      return NextResponse.json(
        { ok: false, error: "กรุณาระบุสิ่งที่ต้องแก้ไข" },
        { status: 400 },
      );
    }
    // Acting on behalf without an HR record: fall back to the assigned manager's StaffId.
    const actorStaffId = staffId ?? (devBypass ? managerStaffId : null);
    const actor: Actor = {
      staffId: actorStaffId,
      userId: Number(session.user.id),
      email: loginEmail,
      // Recorded when an admin stands in for the assigned manager. Not set at
      // the Admin stage, where acting is the actor's own role rather than
      // somebody else's. See `Actor.onBehalfOfManagerStaffId`.
      onBehalfOfManagerStaffId:
        !atAdminStage && !atAccountStage && !isManager && managerStaffId != null
          ? managerStaffId
          : null,
    };
    const updated = atAccountStage
      ? await returnByAccount(id, actor, comment)
      : atAdminStage
        ? await returnByAdmin(id, actor, comment)
        : await returnRequest(id, actor, comment);
    void processQueue().catch(() => {});
    return NextResponse.json({ ok: true, data: updated });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
