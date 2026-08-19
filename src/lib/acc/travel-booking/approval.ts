import { getAccPool, sql } from "@/lib/acc/pool";
import { requireActorStaffId } from "@/lib/acc/actor-context";
import type { Actor } from "@/lib/acc/approval-engine";
import { listApprovers } from "@/lib/acc/settings-service";
import { queueEmail, processQueue } from "@/lib/acc/email-queue";
import { buildTravelBookingEmail, type TravelBookingTrigger } from "@/lib/acc/travel-booking/email-templates";
import { computePayoutDate } from "@/lib/acc/travel-booking/payment-month";
import { getTravelBookingRequest } from "@/lib/acc/travel-booking/request-service";
import { AP17_FORM_CODE } from "@/features/travel-booking/constants";
import type { TravelBookingRequest } from "@/features/travel-booking/types";

/**
 * AP-17 approval actions (Manager step only — see spec §7). Mirrors the guarded-transition
 * pattern in `src/lib/acc/approval-engine.ts` (AP-1): `UPDATE ... WHERE <expected state>;
 * SELECT @@ROWCOUNT`, rollback + throw a Thai error on 0 rows (double-processing guard),
 * else commit then fire-and-forget email notifications.
 *
 * `Actor` is re-exported from AP-1's approval-engine — structurally identical to the shape
 * the brief specifies (`{staffId, userId, email}`) and already produced by the shared
 * `buildAccActor()` helper in `actor-context.ts`, so API routes (Task 8) can reuse it as-is.
 */
export type { Actor };

/**
 * AccRequest.RequesterEmail — `TravelBookingRequest` (request-service's read shape) exposes
 * only display fields, not the requester's email address, so approval/admin actions that
 * need a "to" address resolve it directly against the shared header table. Exported for
 * `admin-service.ts`'s `completeRequest`, which needs the same lookup.
 */
export async function getRequesterEmail(requestId: number): Promise<string | null> {
  const pool = await getAccPool();
  const r = await pool.request().input("id", sql.Int, requestId)
    .query(`SELECT RequesterEmail FROM [dbo].[AccRequest] WHERE Id=@id`);
  return (r.recordset[0]?.RequesterEmail as string) ?? null;
}

/** Date column input → 'YYYY-MM-DD' using local getters (server is Thai time, never toISOString). */
function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Queue an email built from the current request state to one recipient. Best-effort — never throws. */
async function notify(requestId: number, trigger: TravelBookingTrigger, toEmail: string | null, note?: string): Promise<void> {
  if (!toEmail) return;
  try {
    const req = await getTravelBookingRequest(requestId);
    if (!req) return;
    const mail = buildTravelBookingEmail(trigger, req, note);
    await queueEmail({ requestId, toEmail, subject: mail.subject, bodyHtml: mail.html, triggerType: trigger });
  } catch {
    // Notification failures must never fail the approval action itself.
  }
}

async function requireTravelBookingRequest(id: number): Promise<TravelBookingRequest> {
  const req = await getTravelBookingRequest(id);
  if (!req) throw new Error("ไม่พบคำขอ");
  return req;
}

/**
 * Manager approves — Submitted → ManagerApproved, handing off to Admin for booking fill-in
 * (spec §7: "Manager → Admin fill-in → done"; AP-17 has no separate ACCOUNT approval step).
 * Sets `PaymentDate` = end-of-month payout (>20th rolls to next month, see payment-month.ts).
 *
 * When the request needs nothing booked (ข้อ10.1 / ข้อ12.2 / ข้อ15.1 all false) there is no
 * Admin work to queue, so it closes straight to `Completed` — only the per-diem payout is
 * left, and that is already carried by `PaymentDate`.
 */
/**
 * Write the "acted for the assigned manager" line, when that is what happened.
 *
 * Inside the caller's transaction, so an admin action is either fully recorded
 * with its explanation or not recorded at all — an approval whose audit line was
 * rolled back separately would be worse than none.
 */
async function logManagerOnBehalf(
  tx: ReturnType<Awaited<ReturnType<typeof getAccPool>>["transaction"]>,
  requestId: number,
  actor: Actor,
  actionLabel: string,
): Promise<void> {
  const onBehalf = actor.onBehalfOfManagerStaffId;
  if (onBehalf == null) return;

  const note =
    `${actionLabel} โดยผู้ดูแลระบบแทนผู้จัดการ` +
    ` — ผู้ดำเนินการจริง: ${actor.email ?? "(unknown)"}` +
    ` (StaffId ${actor.staffId ?? "-"}), แทน ManagerStaffId ${onBehalf}`;

  await tx
    .request()
    .input("rid", sql.Int, requestId)
    .input("by", sql.Int, actor.userId)
    .input("note", sql.NVarChar, note.slice(0, 2000))
    .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note)
            VALUES (@rid, @by, 'manager_acted_on_behalf', @note)`);
}

export async function approveByManager(requestId: number, actor: Actor): Promise<TravelBookingRequest> {
  const staffId = requireActorStaffId(actor);
  const pool = await getAccPool();
  const payDate = toYmd(computePayoutDate(new Date()));

  const flagRes = await pool.request().input("rid", sql.Int, requestId)
    .query(`SELECT NeedsRoomBooking, GoNeedsTicketBooking, ReturnNeedsTicketBooking, NeedsRentBooking
            FROM [dbo].[AccTravelBooking] WHERE RequestId=@rid`);
  const flags = flagRes.recordset[0] as Record<string, boolean> | undefined;
  const needsBooking =
    !!flags &&
    (!!flags.NeedsRoomBooking ||
      !!flags.GoNeedsTicketBooking ||
      !!flags.ReturnNeedsTicketBooking ||
      !!flags.NeedsRentBooking);

  const tx = pool.transaction();
  await tx.begin();
  try {
    const upd = await tx.request()
      .input("rid", sql.Int, requestId)
      .input("form", sql.NVarChar, AP17_FORM_CODE)
      .input("pd", sql.Date, payDate)
      .input("status", sql.NVarChar(30), needsBooking ? "ManagerApproved" : "Completed")
      .input("step", sql.NVarChar(30), needsBooking ? "ADMIN" : null)
      .query(`UPDATE [dbo].[AccRequest] SET Status=@status, CurrentStepCode=@step,
              PaymentDate=@pd, UpdatedAt=SYSDATETIME()
              WHERE Id=@rid AND FormCode=@form AND CurrentStepCode='MANAGER' AND Status='Submitted';
              SELECT @@ROWCOUNT AS n`);
    if ((upd.recordset[0].n as number) === 0) {
      await tx.rollback();
      throw new Error("คำขอไม่อยู่ในขั้นรออนุมัติของผู้จัดการ");
    }
    await tx.request()
      .input("rid", sql.Int, requestId)
      .input("staff", sql.Int, staffId)
      .input("email", sql.NVarChar, actor.email ?? null)
      .query(`UPDATE [dbo].[AccApproval] SET Status='Approved', ActionedByStaffId=@staff, ActionedAt=SYSDATETIME(),
              AssignedEmail=CASE WHEN @email IS NOT NULL AND LTRIM(RTRIM(@email)) <> '' THEN @email ELSE AssignedEmail END
              WHERE RequestId=@rid AND StepCode='MANAGER' AND Status='Pending'`);
    await tx.request().input("rid", sql.Int, requestId).input("by", sql.Int, actor.userId)
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action) VALUES (@rid, @by, 'manager_approved')`);
    if (!needsBooking) {
      await tx.request().input("rid", sql.Int, requestId).input("by", sql.Int, actor.userId)
        .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note)
                VALUES (@rid, @by, 'completed', N'ไม่มีรายการที่ต้องจอง — ปิดงานอัตโนมัติ')`);
    }
    await logManagerOnBehalf(tx, requestId, actor, "อนุมัติ");
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }

  // Email requester (Approved — carries the payout month + per-diem total, which is the whole
  // outcome when nothing needs booking) and, only when there IS Admin work, ping every active
  // accounting/admin approver (spec §7's "Admin (accounting team)" — the same AccApprover
  // roster AP-1 notifies at its ManagerApproved step).
  const requesterEmail = await getRequesterEmail(requestId);
  await notify(requestId, "Approved", requesterEmail);
  if (needsBooking) {
    const admins = await listApprovers(true);
    for (const a of admins) {
      await notify(requestId, "ReadyForAdmin", a.email);
    }
  }
  void processQueue().catch(() => {});

  return requireTravelBookingRequest(requestId);
}

/** Manager rejects — Submitted → Rejected (terminal). Comment required. State-guarded. */
export async function rejectRequest(requestId: number, actor: Actor, comment: string): Promise<TravelBookingRequest> {
  const staffId = requireActorStaffId(actor);
  if (!comment?.trim()) throw new Error("กรุณาระบุเหตุผลที่ไม่อนุมัติ");
  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const upd = await tx.request().input("rid", sql.Int, requestId)
      .query(`UPDATE [dbo].[AccRequest] SET Status='Rejected', CurrentStepCode=NULL, UpdatedAt=SYSDATETIME()
              WHERE Id=@rid AND CurrentStepCode='MANAGER' AND Status='Submitted';
              SELECT @@ROWCOUNT AS n`);
    if ((upd.recordset[0].n as number) === 0) {
      await tx.rollback();
      throw new Error("คำขอไม่อยู่ในขั้นที่สามารถไม่อนุมัติได้");
    }
    await tx.request()
      .input("rid", sql.Int, requestId)
      .input("staff", sql.Int, staffId)
      .input("email", sql.NVarChar, actor.email ?? null)
      .input("c", sql.NVarChar, comment)
      .query(`UPDATE [dbo].[AccApproval] SET Status='Rejected', Comment=@c, ActionedByStaffId=@staff, ActionedAt=SYSDATETIME(),
              AssignedEmail=CASE WHEN @email IS NOT NULL AND LTRIM(RTRIM(@email)) <> '' THEN @email ELSE AssignedEmail END
              WHERE RequestId=@rid AND StepCode='MANAGER' AND Status='Pending'`);
    await tx.request().input("rid", sql.Int, requestId).input("by", sql.Int, actor.userId)
      .input("c", sql.NVarChar, comment)
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note) VALUES (@rid, @by, 'rejected', @c)`);
    await logManagerOnBehalf(tx, requestId, actor, "ไม่อนุมัติ");
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }

  const requesterEmail = await getRequesterEmail(requestId);
  await notify(requestId, "Rejected", requesterEmail, comment);
  void processQueue().catch(() => {});

  return requireTravelBookingRequest(requestId);
}

/** Manager returns for edits — Submitted → Returned, back to CurrentStepCode='MANAGER' for resubmit. Comment required. */
export async function returnRequest(requestId: number, actor: Actor, comment: string): Promise<TravelBookingRequest> {
  const staffId = requireActorStaffId(actor);
  if (!comment?.trim()) throw new Error("กรุณาระบุสิ่งที่ต้องแก้ไข");
  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const upd = await tx.request().input("rid", sql.Int, requestId)
      .query(`UPDATE [dbo].[AccRequest] SET Status='Returned', CurrentStepCode='MANAGER', UpdatedAt=SYSDATETIME()
              WHERE Id=@rid AND CurrentStepCode='MANAGER' AND Status='Submitted';
              SELECT @@ROWCOUNT AS n`);
    if ((upd.recordset[0].n as number) === 0) {
      await tx.rollback();
      throw new Error("คำขอไม่อยู่ในขั้นที่สามารถส่งกลับแก้ไขได้");
    }
    await tx.request()
      .input("rid", sql.Int, requestId)
      .input("staff", sql.Int, staffId)
      .input("email", sql.NVarChar, actor.email ?? null)
      .input("c", sql.NVarChar, comment)
      .query(`UPDATE [dbo].[AccApproval] SET Status='Returned', Comment=@c, ActionedByStaffId=@staff, ActionedAt=SYSDATETIME(),
              AssignedEmail=CASE WHEN @email IS NOT NULL AND LTRIM(RTRIM(@email)) <> '' THEN @email ELSE AssignedEmail END
              WHERE RequestId=@rid AND StepCode='MANAGER' AND Status='Pending'`);
    await tx.request().input("rid", sql.Int, requestId).input("by", sql.Int, actor.userId)
      .input("c", sql.NVarChar, comment)
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note) VALUES (@rid, @by, 'returned', @c)`);
    await logManagerOnBehalf(tx, requestId, actor, "ส่งกลับแก้ไข");
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }

  const requesterEmail = await getRequesterEmail(requestId);
  await notify(requestId, "Returned", requesterEmail, comment);
  void processQueue().catch(() => {});

  return requireTravelBookingRequest(requestId);
}

/* ── Admin (booking) stage — spec §8.1: Admin can bounce a request instead of booking it ── */

/**
 * Guarded transition out of the Admin booking stage (`ManagerApproved` / `CurrentStepCode='ADMIN'`).
 * `PaymentDate` is cleared because it is recomputed at the next manager approval.
 */
async function transitionFromAdminStage(
  requestId: number,
  actor: Actor,
  comment: string,
  target: { status: "Returned" | "Rejected"; stepCode: "MANAGER" | null; action: string; blockedError: string },
): Promise<void> {
  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const upd = await tx.request()
      .input("rid", sql.Int, requestId)
      .input("status", sql.NVarChar(30), target.status)
      .input("step", sql.NVarChar(30), target.stepCode)
      .query(`UPDATE [dbo].[AccRequest] SET Status=@status, CurrentStepCode=@step,
              PaymentDate=NULL, UpdatedAt=SYSDATETIME()
              WHERE Id=@rid AND CurrentStepCode='ADMIN' AND Status='ManagerApproved';
              SELECT @@ROWCOUNT AS n`);
    if ((upd.recordset[0].n as number) === 0) {
      await tx.rollback();
      throw new Error(target.blockedError);
    }
    await tx.request().input("rid", sql.Int, requestId).input("by", sql.Int, actor.userId)
      .input("action", sql.NVarChar(50), target.action)
      .input("c", sql.NVarChar, comment)
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note) VALUES (@rid, @by, @action, @c)`);
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}

/**
 * Admin sends the request back to the requester for revision — ManagerApproved → Returned.
 * `CurrentStepCode` returns to 'MANAGER' because a resubmit wipes the approval rows and runs
 * the manager step again from scratch (see `submitTravelBookingGroup`).
 */
export async function returnByAdmin(requestId: number, actor: Actor, comment: string): Promise<TravelBookingRequest> {
  if (!comment?.trim()) throw new Error("กรุณาระบุสิ่งที่ต้องแก้ไข");
  await transitionFromAdminStage(requestId, actor, comment, {
    status: "Returned",
    stepCode: "MANAGER",
    action: "admin_returned",
    blockedError: "คำขอไม่อยู่ในขั้นที่ Admin สามารถส่งกลับแก้ไขได้",
  });

  const requesterEmail = await getRequesterEmail(requestId);
  await notify(requestId, "Returned", requesterEmail, comment);
  void processQueue().catch(() => {});

  return requireTravelBookingRequest(requestId);
}

/** Admin rejects at the booking stage — ManagerApproved → Rejected (terminal). Comment required. */
export async function rejectByAdmin(requestId: number, actor: Actor, comment: string): Promise<TravelBookingRequest> {
  if (!comment?.trim()) throw new Error("กรุณาระบุเหตุผลที่ไม่อนุมัติ");
  await transitionFromAdminStage(requestId, actor, comment, {
    status: "Rejected",
    stepCode: null,
    action: "admin_rejected",
    blockedError: "คำขอไม่อยู่ในขั้นที่ Admin สามารถไม่อนุมัติได้",
  });

  const requesterEmail = await getRequesterEmail(requestId);
  await notify(requestId, "Rejected", requesterEmail, comment);
  void processQueue().catch(() => {});

  return requireTravelBookingRequest(requestId);
}

/**
 * Requester self-cancel: allowed within 24h of SubmittedAt while still pending the manager
 * (Status = Submitted), and only by the request's own creator (CreatedBy=@uid, checked inside
 * the guarded UPDATE itself — defense in depth even though callers should also check ownership).
 */
export async function cancelByRequester(requestId: number, actor: Actor): Promise<TravelBookingRequest> {
  const staffId = requireActorStaffId(actor);
  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const upd = await tx.request()
      .input("rid", sql.Int, requestId)
      .input("uid", sql.Int, actor.userId)
      .query(`UPDATE [dbo].[AccRequest] SET Status='Cancelled', CurrentStepCode=NULL,
              CancelledBy=@uid, CancelledAt=SYSDATETIME(), UpdatedAt=SYSDATETIME()
              WHERE Id=@rid AND Status='Submitted' AND CreatedBy=@uid
                AND SubmittedAt IS NOT NULL AND DATEDIFF(HOUR, SubmittedAt, SYSDATETIME()) <= 24;
              SELECT @@ROWCOUNT AS n`);
    if ((upd.recordset[0].n as number) === 0) {
      await tx.rollback();
      throw new Error("ไม่สามารถยกเลิกได้ — เกิน 24 ชั่วโมงหลังส่ง หรือสถานะไม่ถูกต้อง กรุณาติดต่อเจ้าของฟอร์ม");
    }
    await tx.request()
      .input("rid", sql.Int, requestId)
      .input("staff", sql.Int, staffId)
      .query(`UPDATE [dbo].[AccApproval] SET Status='Returned', ActionedByStaffId=@staff, ActionedAt=SYSDATETIME()
              WHERE RequestId=@rid AND Status='Pending'`);
    await tx.request().input("rid", sql.Int, requestId).input("by", sql.Int, actor.userId)
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action) VALUES (@rid, @by, 'cancelled')`);
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }

  return requireTravelBookingRequest(requestId);
}
