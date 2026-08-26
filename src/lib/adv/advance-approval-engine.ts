import { getAccPool, sql } from "@/lib/adv/pool";
import { getPaymentDates } from "@/lib/acc/payment-calendar";
import { queueEmail } from "@/lib/acc/email-queue";
import { requireActorStaffId } from "@/lib/acc/actor-context";
import type { Actor } from "@/lib/acc/approval-engine";
import { getRequest } from "@/lib/adv/advance-request-service";
import { listApproverEmailsByRole } from "@/lib/adv/advance-approver-service";
import {
  needsPayment,
  stepApproverRole,
  STEP_LABEL,
  type StepType,
} from "@/lib/adv/approval-steps";

/**
 * AP-2's dynamic, amount-driven approval chain, on its OWN table
 * (AccAdvanceApproval) — never the shared AccApproval. The step sequence for a
 * request is fixed at submit from the amount matrix; each step is either the
 * requester's manager (HEAD_DEPT) or a configured approver role.
 */

export interface CurrentStep {
  id: number;
  stepType: StepType;
  stepOrder: number;
}

/** The lowest-order still-Pending step, or null when the chain is complete. */
export async function getCurrentApprovalStep(requestId: number): Promise<CurrentStep | null> {
  const pool = await getAccPool();
  const r = await pool.request().input("rid", sql.Int, requestId).query(`
    SELECT TOP 1 Id, StepType, StepOrder FROM [dbo].[AccAdvanceApproval]
    WHERE RequestId = @rid AND Status = 'Pending' ORDER BY StepOrder`);
  if (!r.recordset.length) return null;
  const x = r.recordset[0] as Record<string, unknown>;
  return { id: x.Id as number, stepType: x.StepType as StepType, stepOrder: x.StepOrder as number };
}

/** Notify the approvers who can act on a given step type. */
async function notifyStep(requestId: number, stepType: StepType, requestNo: string) {
  const role = stepApproverRole(stepType);
  let emails: string[] = [];
  if (role) {
    emails = await listApproverEmailsByRole(role);
  } else {
    // HEAD_DEPT — the assigned manager on the row.
    const pool = await getAccPool();
    const r = await pool.request().input("rid", sql.Int, requestId)
      .query(`SELECT AssignedEmail FROM [dbo].[AccAdvanceApproval]
              WHERE RequestId=@rid AND StepType='HEAD_DEPT' AND Status='Pending'`);
    emails = (r.recordset as { AssignedEmail: string | null }[])
      .map((x) => x.AssignedEmail).filter((e): e is string => !!e);
  }
  const subject = `เบิกเงินทดรองจ่าย ${requestNo} รออนุมัติ (${STEP_LABEL[stepType]})`;
  const body =
    `<p>มีคำขอเบิกเงินทดรองจ่าย <b>${requestNo}</b> รอการอนุมัติของท่าน (${STEP_LABEL[stepType]})</p>` +
    `<p><a href="/request/advance/${requestId}">เปิดคำขอ</a></p>`;
  for (const toEmail of emails) {
    await queueEmail({ requestId, toEmail, subject, bodyHtml: body, triggerType: "ManagerApproved" });
  }
}

/** Approve the current step. Advances to the next, or finalises the request. */
export async function approveCurrentStep(
  requestId: number,
  actor: Actor,
  opts: { paymentDate?: string; isChecked?: boolean } = {},
): Promise<void> {
  const staffId = requireActorStaffId(actor);
  const step = await getCurrentApprovalStep(requestId);
  if (!step) throw new Error("คำขอไม่อยู่ในขั้นรออนุมัติ");

  if (needsPayment(step.stepType)) {
    if (!opts.isChecked) throw new Error("ต้องกด Check ก่อนอนุมัติ");
    const valid = await getPaymentDates();
    if (!opts.paymentDate || !valid.includes(opts.paymentDate)) {
      throw new Error("วันที่จ่ายไม่อยู่ในรอบที่กำหนด (ศุกร์ที่ 2 หรือ 4)");
    }
    // AP-2: the debit posts to a Vendor, so the Accounting Officer must have a
    // confirmed vendor before this step can complete. (Belt: the send guard and
    // the payload builder also refuse, but the gate lives here so the queue only
    // ever receives complete rows.)
    const pool = await getAccPool();
    const vr = await pool.request().input("rid", sql.Int, requestId)
      .query(`SELECT MatchedVendorNo, VendorMatchStatus FROM [dbo].[AccAdvance] WHERE RequestId=@rid`);
    const vrow = vr.recordset[0] as { MatchedVendorNo?: string | null; VendorMatchStatus?: string | null } | undefined;
    if (!vrow?.MatchedVendorNo || vrow.VendorMatchStatus !== "confirmed") {
      throw new Error("ต้องยืนยัน Vendor ก่อนอนุมัติ (เลือก Vendor ในหน้ารายละเอียด)");
    }
  }

  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  let nextType: StepType | null = null;
  try {
    const upd = await tx.request().input("sid", sql.Int, step.id)
      .input("staff", sql.Int, staffId).input("email", sql.NVarChar, actor.email ?? null)
      .input("chk", sql.Bit, needsPayment(step.stepType) ? 1 : null)
      .input("pd", sql.Date, opts.paymentDate ?? null)
      .query(`UPDATE [dbo].[AccAdvanceApproval] SET Status='Approved',
                ActionedByStaffId=@staff, ActionedByEmail=@email, ActionedAt=SYSDATETIME(),
                IsChecked=COALESCE(@chk, IsChecked), PaymentDate=COALESCE(@pd, PaymentDate)
              WHERE Id=@sid AND Status='Pending';
              SELECT @@ROWCOUNT AS n`);
    if ((upd.recordset[0].n as number) === 0) {
      await tx.rollback();
      throw new Error("ขั้นนี้ถูกดำเนินการไปแล้ว");
    }
    const next = await tx.request().input("rid", sql.Int, requestId).query(`
      SELECT TOP 1 StepType FROM [dbo].[AccAdvanceApproval]
      WHERE RequestId=@rid AND Status='Pending' ORDER BY StepOrder`);
    if (next.recordset.length) {
      nextType = next.recordset[0].StepType as StepType;
      await tx.request().input("rid", sql.Int, requestId).input("t", sql.NVarChar, nextType)
        .query(`UPDATE [dbo].[AccRequest] SET CurrentStepCode=@t, UpdatedAt=SYSDATETIME() WHERE Id=@rid`);
    } else {
      await tx.request().input("rid", sql.Int, requestId).input("pd", sql.Date, opts.paymentDate ?? null)
        .query(`UPDATE [dbo].[AccRequest] SET Status='Approved', CurrentStepCode=NULL,
                  PaymentDate=COALESCE(@pd, PaymentDate), UpdatedAt=SYSDATETIME() WHERE Id=@rid`);
    }
    await tx.request().input("rid", sql.Int, requestId).input("by", sql.Int, actor.userId)
      .input("note", sql.NVarChar, `approved:${step.stepType}`)
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note)
              VALUES (@rid, @by, 'approved', @note)`);
    await tx.commit();
  } catch (e) { await tx.rollback().catch(() => {}); throw e; }

  const req = await getRequest(requestId);
  const no = req?.requestNo ?? `#${requestId}`;
  if (nextType) {
    await notifyStep(requestId, nextType, no);
  } else if (req?.requesterEmail) {
    await queueEmail({
      requestId, toEmail: req.requesterEmail,
      subject: `เบิกเงินทดรองจ่าย ${no} อนุมัติแล้ว`,
      bodyHtml: `<p>คำขอ <b>${no}</b> ได้รับการอนุมัติครบทุกขั้นแล้ว</p>`,
      triggerType: "Approved",
    });
  }
}

/** Reject the current step. Stops the chain. */
export async function rejectCurrentStep(requestId: number, actor: Actor, comment: string): Promise<void> {
  const staffId = requireActorStaffId(actor);
  if (!comment?.trim()) throw new Error("กรุณาระบุเหตุผลที่ไม่อนุมัติ");
  const step = await getCurrentApprovalStep(requestId);
  if (!step) throw new Error("คำขอไม่อยู่ในขั้นที่ปฏิเสธได้");
  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    await tx.request().input("sid", sql.Int, step.id).input("staff", sql.Int, staffId)
      .input("email", sql.NVarChar, actor.email ?? null).input("c", sql.NVarChar, comment)
      .query(`UPDATE [dbo].[AccAdvanceApproval] SET Status='Rejected', Comment=@c,
                ActionedByStaffId=@staff, ActionedByEmail=@email, ActionedAt=SYSDATETIME()
              WHERE Id=@sid AND Status='Pending'`);
    await tx.request().input("rid", sql.Int, requestId)
      .query(`UPDATE [dbo].[AccRequest] SET Status='Rejected', CurrentStepCode=NULL, UpdatedAt=SYSDATETIME() WHERE Id=@rid`);
    await tx.request().input("rid", sql.Int, requestId).input("by", sql.Int, actor.userId).input("c", sql.NVarChar, comment)
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note) VALUES (@rid, @by, 'rejected', @c)`);
    await tx.commit();
  } catch (e) { await tx.rollback().catch(() => {}); throw e; }
  const req = await getRequest(requestId);
  if (req?.requesterEmail) await queueEmail({
    requestId, toEmail: req.requesterEmail,
    subject: `เบิกเงินทดรองจ่าย ${req.requestNo ?? `#${requestId}`} ไม่อนุมัติ`,
    bodyHtml: `<p>คำขอถูกปฏิเสธ</p><p>หมายเหตุ: ${comment}</p>`, triggerType: "Rejected",
  });
}

/**
 * Requester self-cancel within 24h of submit, while still at the first step.
 * Caller must already be authorized as the requester (route checks ownership).
 */
export async function cancelByRequester(requestId: number, actor: Actor): Promise<void> {
  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    // Cancel window: within 24h of submit AND Head Accounting has not approved
    // yet (Status still Submitted/ManagerApproved, no HEAD_ACC step Approved).
    const upd = await tx.request().input("rid", sql.Int, requestId).input("by", sql.Int, actor.userId)
      .query(`UPDATE [dbo].[AccRequest] SET Status='Cancelled', CurrentStepCode=NULL,
                CancelledBy=@by, CancelledAt=SYSDATETIME(), UpdatedAt=SYSDATETIME()
              WHERE Id=@rid AND Status IN ('Submitted','ManagerApproved')
                AND SubmittedAt IS NOT NULL AND DATEDIFF(HOUR, SubmittedAt, SYSDATETIME()) <= 24
                AND NOT EXISTS (SELECT 1 FROM [dbo].[AccAdvanceApproval]
                                WHERE RequestId=@rid AND StepType='HEAD_ACC' AND Status='Approved');
              SELECT @@ROWCOUNT AS n`);
    if ((upd.recordset[0].n as number) === 0) {
      await tx.rollback();
      throw new Error("ไม่สามารถยกเลิกได้ — เกิน 1 วันหลังส่ง หรือ Head Accounting อนุมัติไปแล้ว");
    }
    await tx.request().input("rid", sql.Int, requestId)
      .query(`UPDATE [dbo].[AccAdvanceApproval] SET Status='Returned', ActionedAt=SYSDATETIME()
              WHERE RequestId=@rid AND Status='Pending'`);
    await tx.request().input("rid", sql.Int, requestId).input("by", sql.Int, actor.userId)
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action) VALUES (@rid, @by, 'cancelled')`);
    await tx.commit();
  } catch (e) { await tx.rollback().catch(() => {}); throw e; }

  // Notify Head Accounting + cc the requester that the request was withdrawn
  // (best-effort — never fail the cancel over an email).
  try {
    const info = await pool.request().input("rid", sql.Int, requestId)
      .query(`SELECT RequestNo, RequesterEmail, RequesterFullName FROM [dbo].[AccRequest] WHERE Id=@rid`);
    const row = info.recordset[0] as { RequestNo: string | null; RequesterEmail: string | null; RequesterFullName: string | null } | undefined;
    const requestNo = row?.RequestNo || `#${requestId}`;
    const headEmails = await listApproverEmailsByRole("HEAD_ACC");
    const recipients = Array.from(new Set([
      ...headEmails.filter((e): e is string => !!e),
      ...(row?.RequesterEmail ? [row.RequesterEmail] : []),
    ]));
    const subject = `ยกเลิกคำขอเบิกเงินทดรองจ่าย ${requestNo}`;
    const bodyHtml =
      `<p>คำขอเบิกเงินทดรองจ่าย <b>${requestNo}</b> ถูก<b>ยกเลิก</b>โดยผู้ขอ` +
      `${row?.RequesterFullName ? ` (${row.RequesterFullName})` : ""} ก่อนการอนุมัติของ Head Accounting</p>` +
      `<p>ไม่ต้องดำเนินการอนุมัติคำขอนี้อีก</p>`;
    for (const toEmail of recipients) {
      await queueEmail({ requestId, toEmail, subject, bodyHtml, triggerType: "Cancelled" });
    }
  } catch { /* email is best-effort */ }
}

/** Return the current step to the requester for edits. */
export async function returnCurrentStep(requestId: number, actor: Actor, comment: string): Promise<void> {
  const staffId = requireActorStaffId(actor);
  if (!comment?.trim()) throw new Error("กรุณาระบุสิ่งที่ต้องแก้ไข");
  const step = await getCurrentApprovalStep(requestId);
  if (!step) throw new Error("คำขอไม่อยู่ในขั้นที่ส่งกลับได้");
  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    await tx.request().input("sid", sql.Int, step.id).input("staff", sql.Int, staffId)
      .input("email", sql.NVarChar, actor.email ?? null).input("c", sql.NVarChar, comment)
      .query(`UPDATE [dbo].[AccAdvanceApproval] SET Status='Returned', Comment=@c,
                ActionedByStaffId=@staff, ActionedByEmail=@email, ActionedAt=SYSDATETIME()
              WHERE Id=@sid AND Status='Pending'`);
    await tx.request().input("rid", sql.Int, requestId)
      .query(`UPDATE [dbo].[AccRequest] SET Status='Returned', CurrentStepCode=NULL, UpdatedAt=SYSDATETIME() WHERE Id=@rid`);
    await tx.request().input("rid", sql.Int, requestId).input("by", sql.Int, actor.userId).input("c", sql.NVarChar, comment)
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note) VALUES (@rid, @by, 'returned', @c)`);
    await tx.commit();
  } catch (e) { await tx.rollback().catch(() => {}); throw e; }
  const req = await getRequest(requestId);
  if (req?.requesterEmail) await queueEmail({
    requestId, toEmail: req.requesterEmail,
    subject: `เบิกเงินทดรองจ่าย ${req.requestNo ?? `#${requestId}`} ส่งกลับแก้ไข`,
    bodyHtml: `<p>คำขอถูกส่งกลับให้แก้ไข</p><p>${comment}</p>`, triggerType: "Returned",
  });
}
