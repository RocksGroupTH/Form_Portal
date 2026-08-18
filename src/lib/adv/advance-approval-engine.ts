import { getAccPool, sql } from "@/lib/adv/pool";
import { getPaymentDates } from "@/lib/acc/payment-calendar";
import { listAdvanceApproverEmails } from "@/lib/adv/adv-config";
import { queueEmail } from "@/lib/acc/email-queue";
import { requireActorStaffId } from "@/lib/acc/actor-context";
import type { Actor } from "@/lib/acc/approval-engine";
import type { StepCode } from "@/features/accounting/constants";
import { getRequest } from "@/lib/adv/advance-request-service";

/**
 * AP-2 approval transitions. The status machine is identical to AP-1 (it only
 * touches AccRequest / AccApproval / AccActivityLog, which are form-agnostic and
 * share the same pool), so the SQL mirrors approval-engine.ts. What differs is
 * the notification: it loads the advance request and links to /request/advance.
 */

type AdvanceTrigger = "ManagerApproved" | "Approved" | "Rejected" | "Returned";

/** Queue an advance email to one recipient. TODO(T9): move HTML to advance-email-templates.ts. */
async function notify(requestId: number, trigger: AdvanceTrigger, toEmail: string | null, note?: string) {
  if (!toEmail) return;
  const req = await getRequest(requestId);
  if (!req) return;
  const no = req.requestNo ?? `#${requestId}`;
  const link = `<p><a href="/request/advance/${requestId}">เปิดคำขอ</a></p>`;
  const noteHtml = note?.trim() ? `<p>หมายเหตุ: ${note}</p>` : "";
  const subjectByTrigger: Record<AdvanceTrigger, string> = {
    ManagerApproved: `เบิกเงินทดรองจ่าย ${no} รออนุมัติ (บัญชี)`,
    Approved: `เบิกเงินทดรองจ่าย ${no} อนุมัติแล้ว`,
    Rejected: `เบิกเงินทดรองจ่าย ${no} ไม่อนุมัติ`,
    Returned: `เบิกเงินทดรองจ่าย ${no} ส่งกลับแก้ไข`,
  };
  const bodyByTrigger: Record<AdvanceTrigger, string> = {
    ManagerApproved: `<p>คำขอเบิกเงินทดรองจ่าย <b>${no}</b> ผ่านผู้จัดการแล้ว รอการอนุมัติของบัญชี</p>`,
    Approved: `<p>คำขอเบิกเงินทดรองจ่าย <b>${no}</b> ได้รับการอนุมัติแล้ว</p>`,
    Rejected: `<p>คำขอเบิกเงินทดรองจ่าย <b>${no}</b> ไม่ได้รับการอนุมัติ</p>`,
    Returned: `<p>คำขอเบิกเงินทดรองจ่าย <b>${no}</b> ถูกส่งกลับให้แก้ไข</p>`,
  };
  await queueEmail({
    requestId,
    toEmail,
    subject: subjectByTrigger[trigger],
    bodyHtml: bodyByTrigger[trigger] + noteHtml + link,
    triggerType: trigger,
  });
}

/** Step 1 — Manager approves: advance to the Account step. State-guarded. */
export async function approveManager(requestId: number, actor: Actor): Promise<void> {
  const staffId = requireActorStaffId(actor);
  const pool = await getAccPool();
  const approverEmails = await listAdvanceApproverEmails();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const upd = await tx.request().input("rid", sql.Int, requestId)
      .query(`UPDATE [dbo].[AccRequest] SET Status='ManagerApproved', CurrentStepCode='ACCOUNT', UpdatedAt=SYSDATETIME()
              WHERE Id=@rid AND CurrentStepCode='MANAGER' AND Status='Submitted';
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
    await tx.request().input("rid", sql.Int, requestId)
      .query(`INSERT INTO [dbo].[AccApproval] (RequestId, StepCode, StepOrder, AssignedEmail, Status)
              VALUES (@rid, 'ACCOUNT', 2, NULL, 'Pending')`);
    await tx.request().input("rid", sql.Int, requestId).input("by", sql.Int, actor.userId)
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action) VALUES (@rid, @by, 'manager_approved')`);
    await tx.commit();
  } catch (e) { await tx.rollback().catch(() => {}); throw e; }

  for (const email of approverEmails) {
    await notify(requestId, "ManagerApproved", email);
  }
}

/** Step 2 — Account approves: requires Check + a valid PaymentDate. Finalizes the request. */
export async function approveAccount(
  requestId: number, actor: Actor, paymentDate: string, isChecked: boolean,
): Promise<void> {
  const staffId = requireActorStaffId(actor);
  if (!isChecked) throw new Error("ต้องกด Check ก่อนอนุมัติ");
  const valid = await getPaymentDates();
  if (!valid.includes(paymentDate)) throw new Error("วันที่จ่ายไม่อยู่ในรอบที่กำหนด (ศุกร์ที่ 2 หรือ 4)");

  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const upd = await tx.request().input("rid", sql.Int, requestId).input("pd", sql.Date, paymentDate)
      .query(`UPDATE [dbo].[AccRequest] SET Status='Approved', CurrentStepCode=NULL,
              PaymentDate=@pd, UpdatedAt=SYSDATETIME()
              WHERE Id=@rid AND CurrentStepCode='ACCOUNT' AND Status='ManagerApproved';
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
      .query(`UPDATE [dbo].[AccRequest] SET Status='Rejected', CurrentStepCode=NULL, UpdatedAt=SYSDATETIME()
              WHERE Id=@rid AND CurrentStepCode=@step AND Status=@status;
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
      .query(`UPDATE [dbo].[AccRequest] SET Status='Returned', CurrentStepCode=NULL, UpdatedAt=SYSDATETIME()
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
 * Requester self-cancel within 24h of submit while still pending the manager.
 * Caller must already be authorized as the requester (route checks ownership).
 */
export async function cancelByRequester(requestId: number, actor: Actor): Promise<void> {
  const staffId = requireActorStaffId(actor);
  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const upd = await tx.request().input("rid", sql.Int, requestId).input("by", sql.Int, actor.userId)
      .query(`UPDATE [dbo].[AccRequest] SET Status='Cancelled', CurrentStepCode=NULL,
              CancelledBy=@by, CancelledAt=SYSDATETIME(), UpdatedAt=SYSDATETIME()
              WHERE Id=@rid AND Status = 'Submitted'
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
