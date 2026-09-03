import { getAccPool, sql } from "@/lib/acc/pool";
import { getPaymentDates } from "@/lib/acc/payment-calendar";
import { getRequest } from "@/lib/acc/request-service";
import { listApprovers } from "@/lib/acc/settings-service";
import { queueEmail } from "@/lib/acc/email-queue";
import { buildEmail, type AccTrigger } from "@/lib/acc/email-templates";
import { requireActorStaffId } from "@/lib/acc/actor-context";
import { AP1_FORM_CODE, type StepCode } from "@/features/accounting/constants";

export interface Actor {
  userId: number;
  email: string | null;
  staffId: number | null;
  /**
   * Set when an IT/System Admin is actioning AP-17's manager step in place of
   * the assigned manager, carrying that manager's HR StaffId.
   *
   * AP-17's approve/reject/return routes permit an admin to action the manager
   * step (AP-1's shared guard deliberately does not). That is kept, but it used
   * to leave no trace of itself: the approval row and the activity log recorded
   * an approval by somebody who is not the assigned manager, with nothing to say
   * why, so the audit trail read as an unexplained anomaly. When this is set the
   * engine writes an extra activity-log line naming the real actor and the
   * manager they stood in for.
   */
  onBehalfOfManagerStaffId?: number | null;
}

/** Queue an email built from the current request state to one recipient. */
async function notify(requestId: number, trigger: AccTrigger, toEmail: string | null, note?: string) {
  if (!toEmail) return;
  const req = await getRequest(requestId);
  if (!req) return;
  const mail = buildEmail(trigger, req, note);
  await queueEmail({
    requestId, toEmail, subject: mail.subject, bodyHtml: mail.html, triggerType: trigger,
  });
}

/** Step 1 — Manager approves: advance to the Account step. State-guarded against double-processing. */
export async function approveManager(requestId: number, actor: Actor): Promise<void> {
  const staffId = requireActorStaffId(actor);
  const pool = await getAccPool();
  const approvers = await listApprovers(true);
  const tx = pool.transaction();
  await tx.begin();
  try {
    // Gate: only advance a request that is actually still at the MANAGER step.
    const upd = await tx.request().input("rid", sql.Int, requestId)
      .input("form", sql.NVarChar, AP1_FORM_CODE)
      .query(`UPDATE [dbo].[AccRequest] SET Status='ManagerApproved', CurrentStepCode='ACCOUNT', UpdatedAt=SYSDATETIME()
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
      .query(`UPDATE [dbo].[AccApproval] SET Status='Approved', ActionedByStaffId=@staff,
              ActionedAt=SYSDATETIME(),
              AssignedEmail=CASE WHEN @email IS NOT NULL AND LTRIM(RTRIM(@email)) <> '' THEN @email ELSE AssignedEmail END
              WHERE RequestId=@rid AND StepCode='MANAGER' AND Status='Pending'`);
    // Single ACCOUNT approval row (any active approver may action it).
    await tx.request().input("rid", sql.Int, requestId)
      .query(`INSERT INTO [dbo].[AccApproval] (RequestId, StepCode, StepOrder, AssignedEmail, Status)
              VALUES (@rid, 'ACCOUNT', 2, NULL, 'Pending')`);
    await tx.request().input("rid", sql.Int, requestId).input("by", sql.Int, actor.userId)
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action) VALUES (@rid, @by, 'manager_approved')`);
    await tx.commit();
  } catch (e) { await tx.rollback().catch(() => {}); throw e; }

  // Notify every active accounting approver — and the requester, who otherwise
  // hears nothing between submitting and final approval and has to come back and
  // look. The same "รอตรวจสอบ (บัญชี)" template answers for both: it says where
  // the request now is, which is what each of them wants to know.
  for (const a of approvers) {
    await notify(requestId, "ManagerApproved", a.email);
  }
  const req = await getRequest(requestId);
  await notify(requestId, "ManagerApproved", req?.requesterEmail ?? null);
}

/** Step 2 — Account approves: requires Check + a valid PaymentDate. Finalizes the request. */
export async function approveAccount(
  requestId: number, actor: Actor, paymentDate: string, isChecked: boolean,
): Promise<void> {
  const staffId = requireActorStaffId(actor);
  if (!isChecked) throw new Error("ต้องกด Check ก่อนอนุมัติ");
  /* One month back, not zero. The round belongs to the claim and is fixed when
     the manager signs, so a queue worked a week late must still be able to stamp
     the round the claim actually made — otherwise the suggestion beside the
     control names a date this line refuses, and only an admin can then set it
     through the correction route, which has taken a backward window all along. */
  const valid = await getPaymentDates(new Date(), 4, 1);
  if (!valid.includes(paymentDate)) throw new Error("วันที่จ่ายไม่อยู่ในรอบที่กำหนด (ศุกร์ที่ 2 หรือ 4)");

  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const upd = await tx.request().input("rid", sql.Int, requestId).input("pd", sql.Date, paymentDate)
      .input("form", sql.NVarChar, AP1_FORM_CODE)
      .query(`UPDATE [dbo].[AccRequest] SET Status='Approved', CurrentStepCode=NULL,
              PaymentDate=@pd, UpdatedAt=SYSDATETIME()
              WHERE Id=@rid AND FormCode=@form AND CurrentStepCode='ACCOUNT' AND Status='ManagerApproved';
              SELECT @@ROWCOUNT AS n`);
    if ((upd.recordset[0].n as number) === 0) {
      await tx.rollback();
      throw new Error("คำขอไม่อยู่ในขั้นรออนุมัติของบัญชี");
    }
    await tx.request()
      .input("rid", sql.Int, requestId)
      .input("staff", sql.Int, staffId)
      .input("email", sql.NVarChar, actor.email ?? null)
      .query(`UPDATE [dbo].[AccApproval] SET Status='Approved', IsChecked=1,
              ActionedByStaffId=@staff,
              AssignedEmail=CASE WHEN @email IS NOT NULL AND LTRIM(RTRIM(@email)) <> '' THEN @email ELSE AssignedEmail END,
              ActionedAt=SYSDATETIME()
              WHERE RequestId=@rid AND StepCode='ACCOUNT' AND Status='Pending'`);
    await tx.request().input("rid", sql.Int, requestId).input("by", sql.Int, actor.userId)
      .input("pd", sql.NVarChar, paymentDate)
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note)
              VALUES (@rid, @by, 'account_approved', @pd)`);
    await tx.commit();
  } catch (e) { await tx.rollback().catch(() => {}); throw e; }

  const req = await getRequest(requestId);
  if (req) {
    await notify(requestId, "Approved", req.requesterEmail);
    await notify(requestId, "Approved", req.managerEmail);
  }
}

/** Reject at the given step. Comment required. Stops the workflow. State-guarded. */
export async function reject(
  requestId: number, actor: Actor, stepCode: StepCode, comment: string,
): Promise<void> {
  const staffId = requireActorStaffId(actor);
  if (!comment?.trim()) throw new Error("กรุณาระบุเหตุผลที่ไม่อนุมัติ");
  const expectedStatus = stepCode === "MANAGER" ? "Submitted" : "ManagerApproved";
  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const upd = await tx.request().input("rid", sql.Int, requestId)
      .input("step", sql.NVarChar, stepCode).input("status", sql.NVarChar, expectedStatus)
      .input("form", sql.NVarChar, AP1_FORM_CODE)
      .query(`UPDATE [dbo].[AccRequest] SET Status='Rejected', CurrentStepCode=NULL, UpdatedAt=SYSDATETIME()
              WHERE Id=@rid AND FormCode=@form AND CurrentStepCode=@step AND Status=@status;
              SELECT @@ROWCOUNT AS n`);
    if ((upd.recordset[0].n as number) === 0) {
      await tx.rollback();
      throw new Error("คำขอไม่อยู่ในขั้นที่สามารถไม่อนุมัติได้");
    }
    await tx.request()
      .input("rid", sql.Int, requestId).input("step", sql.NVarChar, stepCode)
      .input("staff", sql.Int, staffId)
      .input("email", sql.NVarChar, actor.email ?? null)
      .input("c", sql.NVarChar, comment)
      .query(`UPDATE [dbo].[AccApproval] SET Status='Rejected', Comment=@c,
              ActionedByStaffId=@staff,
              AssignedEmail=CASE WHEN @email IS NOT NULL AND LTRIM(RTRIM(@email)) <> '' THEN @email ELSE AssignedEmail END,
              ActionedAt=SYSDATETIME()
              WHERE RequestId=@rid AND StepCode=@step AND Status='Pending'`);
    await tx.request().input("rid", sql.Int, requestId).input("by", sql.Int, actor.userId)
      .input("c", sql.NVarChar, comment)
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note)
              VALUES (@rid, @by, 'rejected', @c)`);
    await tx.commit();
  } catch (e) { await tx.rollback().catch(() => {}); throw e; }

  const req = await getRequest(requestId);
  if (req) await notify(requestId, "Rejected", req.requesterEmail, comment);
}

/** Manager returns the request to the requester for edits. Comment required. State-guarded. */
export async function returnForEdit(requestId: number, actor: Actor, comment: string): Promise<void> {
  const staffId = requireActorStaffId(actor);
  if (!comment?.trim()) throw new Error("กรุณาระบุสิ่งที่ต้องแก้ไข");
  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const upd = await tx.request().input("rid", sql.Int, requestId)
      .input("form", sql.NVarChar, AP1_FORM_CODE)
      .query(`UPDATE [dbo].[AccRequest] SET Status='Returned', CurrentStepCode=NULL, UpdatedAt=SYSDATETIME()
              WHERE Id=@rid AND FormCode=@form AND CurrentStepCode='MANAGER' AND Status='Submitted';
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
      .query(`UPDATE [dbo].[AccApproval] SET Status='Returned', Comment=@c,
              ActionedByStaffId=@staff,
              AssignedEmail=CASE WHEN @email IS NOT NULL AND LTRIM(RTRIM(@email)) <> '' THEN @email ELSE AssignedEmail END,
              ActionedAt=SYSDATETIME()
              WHERE RequestId=@rid AND StepCode='MANAGER' AND Status='Pending'`);
    await tx.request().input("rid", sql.Int, requestId).input("by", sql.Int, actor.userId)
      .input("c", sql.NVarChar, comment)
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note)
              VALUES (@rid, @by, 'returned', @c)`);
    await tx.commit();
  } catch (e) { await tx.rollback().catch(() => {}); throw e; }

  const req = await getRequest(requestId);
  if (req) await notify(requestId, "Returned", req.requesterEmail, comment);
}

/**
 * Requester self-cancel: allowed within 24h of SubmittedAt while still pending the
 * manager (Status = Submitted). Caller must already be authorized as the requester
 * (the API route checks ownership). Closes pending approvals and marks the request Cancelled.
 */
export async function cancelByRequester(requestId: number, actor: Actor): Promise<void> {
  const staffId = requireActorStaffId(actor);
  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const upd = await tx.request().input("rid", sql.Int, requestId).input("by", sql.Int, actor.userId)
      .input("form", sql.NVarChar, AP1_FORM_CODE)
      .query(`UPDATE [dbo].[AccRequest] SET Status='Cancelled', CurrentStepCode=NULL,
              CancelledBy=@by, CancelledAt=SYSDATETIME(), UpdatedAt=SYSDATETIME()
              WHERE Id=@rid AND FormCode=@form AND Status = 'Submitted'
                AND SubmittedAt IS NOT NULL AND DATEDIFF(HOUR, SubmittedAt, SYSDATETIME()) <= 24;
              SELECT @@ROWCOUNT AS n`);
    if ((upd.recordset[0].n as number) === 0) {
      await tx.rollback();
      throw new Error("ไม่สามารถยกเลิกได้ — เกิน 1 วันหลังส่ง หรือสถานะไม่ถูกต้อง กรุณาติดต่อเจ้าของฟอร์ม");
    }
    await tx.request()
      .input("rid", sql.Int, requestId)
      .input("staff", sql.Int, staffId)
      .query(`UPDATE [dbo].[AccApproval] SET Status='Returned', ActionedByStaffId=@staff, ActionedAt=SYSDATETIME()
              WHERE RequestId=@rid AND Status='Pending'`);
    await tx.request().input("rid", sql.Int, requestId).input("by", sql.Int, actor.userId)
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action) VALUES (@rid, @by, 'cancelled')`);
    await tx.commit();
  } catch (e) { await tx.rollback().catch(() => {}); throw e; }
}
