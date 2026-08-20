import { NextResponse } from "next/server";
import { getAccPool, sql } from "@/lib/acc/pool";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { buildAccActor } from "@/lib/acc/actor-context";
import { canActManagerApi, MANAGER_AUTH_ERROR } from "@/lib/acc/manager-auth";
import { isRewardOfficer } from "@/lib/acc/reward/access";
import { isAdminRole } from "@/lib/roles";
import { AP11_FORM_CODE } from "@/features/reward/constants";
import type { Actor } from "@/lib/acc/approval-engine";

/**
 * Who may action which AP-11 step — one answer, used by every action route.
 *
 * Six routes (approve, reject, return, ready, received) all need the same three
 * things: the object ACL, which step the request is actually at, and whether
 * this caller may act on that step. Deriving the step from the stored status
 * rather than from a parameter is deliberate — a client that posts to
 * `/approve` cannot choose *which* approval it is granting.
 *
 * **An admin may not action the manager step.** AP-17 permits it (and records
 * it); AP-1 does not. AP-11 follows AP-1, because its manager is resolved from
 * HR precisely so that the person approving is the requester's real manager,
 * and an admin override would quietly undo that. The documented localhost dev
 * bypass still applies, gated on a non-production build plus
 * `ACC_MANAGER_DEV_BYPASS=1`.
 */

export type RewardStage = "MANAGER" | "REWARD" | "FULFIL";

export interface RewardActionContext {
  actor: Actor;
  stage: RewardStage;
  status: string;
  isOfficer: boolean;
}

const NOT_THIS_STEP = "คำขอนี้ไม่ได้อยู่ในขั้นที่คุณดำเนินการได้";
const OFFICER_AUTH_ERROR = "ไม่มีสิทธิ์ — เฉพาะทีม Assist AP เท่านั้น";

/**
 * Resolve and authorize an action on one AP-11 request.
 *
 * Returns the context on success, or the `Response` to return — the same shape
 * `requireAuth()` and `authorizeAccRequest()` use, so a route handler stays
 * short.
 */
export async function authorizeRewardAction(
  session: { user: { id?: string | null; email?: string | null; role?: string | null } },
  requestId: number,
  host: string | null,
): Promise<RewardActionContext | Response> {
  // Object ACL first — it owns the 404 for a UAT record reached from outside
  // the tester group, and the FormCode argument stops an AP-1 or AP-17 id from
  // being actioned through an AP-11 route.
  const gate = await authorizeAccRequest(session, requestId, "read", AP11_FORM_CODE);
  if (gate instanceof Response) return gate;

  const email = session.user.email ?? null;
  const role = session.user.role ?? null;
  const actor = await buildAccActor(Number(session.user.id), email);

  const pool = await getAccPool();
  const res = await pool
    .request()
    .input("id", sql.Int, requestId)
    .query(
      `SELECT r.Status, r.CurrentStepCode, r.ManagerStaffId,
              a.AssignedTo, a.AssignedEmail, a.Status AS ApprovalStatus
         FROM [dbo].[AccRequest] r
         LEFT JOIN [dbo].[AccApproval] a
                ON a.RequestId = r.Id AND a.StepCode = r.CurrentStepCode AND a.Status = 'Pending'
        WHERE r.Id = @id`,
    );
  if (!res.recordset.length) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const row = res.recordset[0] as Record<string, unknown>;
  const status = String(row.Status ?? "");
  const stepCode = (row.CurrentStepCode as string) ?? null;
  const isOfficer = isAdminRole(role) || (await isRewardOfficer(email));

  if (stepCode === "MANAGER" && status === "Submitted") {
    const mayAct = canActManagerApi(
      actor.staffId,
      (row.ManagerStaffId as number) ?? null,
      role,
      host,
      {
        assignedTo: (row.AssignedTo as number) ?? null,
        assignedEmail: (row.AssignedEmail as string) ?? null,
        status: String(row.ApprovalStatus ?? "Pending"),
      },
      email,
    );
    if (!mayAct) {
      return NextResponse.json({ ok: false, error: MANAGER_AUTH_ERROR }, { status: 403 });
    }
    return { actor, stage: "MANAGER", status, isOfficer };
  }

  if (stepCode === "REWARD" && status === "ManagerApproved") {
    if (!isOfficer) {
      return NextResponse.json({ ok: false, error: OFFICER_AUTH_ERROR }, { status: 403 });
    }
    return { actor, stage: "REWARD", status, isOfficer };
  }

  // Ready / Received are fulfilment, not approval — the request has no pending
  // step, and only the Assist AP team touches it.
  if (status === "Approved" || status === "Ready") {
    if (!isOfficer) {
      return NextResponse.json({ ok: false, error: OFFICER_AUTH_ERROR }, { status: 403 });
    }
    return { actor, stage: "FULFIL", status, isOfficer };
  }

  return NextResponse.json({ ok: false, error: NOT_THIS_STEP }, { status: 409 });
}
