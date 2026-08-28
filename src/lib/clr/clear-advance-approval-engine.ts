import { env } from "@/env";
import { documentButton, documentUrl } from "@/lib/acc/mail-link";
import { getAccPool, sql } from "@/lib/acc/pool";
import { queueEmail } from "@/lib/acc/email-queue";
import { requireActorStaffId } from "@/lib/acc/actor-context";
import type { Actor } from "@/lib/acc/approval-engine";
import { getRequest, setAccountAction } from "@/lib/clr/clear-advance-request-service";
import { listClrApprovers, roleForStep } from "@/lib/clr/clear-advance-approver-service";
import {
  CLR_NEXT_STEP,
  CLR_STEP_LABEL_TH,
  type ClrStepCode,
} from "@/features/clear-advance/constants";

/** Queue a plain notification email for the AP-3 request to one recipient. */
async function notify(
  requestId: number,
  subject: string,
  bodyHtml: string,
  toEmail: string | null,
  triggerType: string,
) {
  if (!toEmail?.trim()) return;
  await queueEmail({ requestId, toEmail, subject, bodyHtml, triggerType });
}

/**
 * The "open the document" button.
 *
 * Built through `documentButton`, which refuses a relative URL. This function
 * used to emit `<a href="/request/clear-advance/42">` — relative, so it
 * resolved against the mail client, which is nowhere, and the link was dead in
 * every client. AP-1, AP-2, AP-4 and AP-17 all built theirs off
 * NEXT_PUBLIC_APP_URL; AP-3 was the one that did not.
 */
function link(id: number): string {
  return documentButton(documentUrl(env.NEXT_PUBLIC_APP_URL, "/request/clear-advance", id));
}

/**
 * Approve the current step and advance the fixed chain MANAGER → ACCOUNT → HEAD.
 * State-guarded against double-processing. Authorization is enforced by the API route.
 */
export async function approveCurrentStep(
  requestId: number,
  actor: Actor,
  opts: { isChecked?: boolean; pvDocNo?: string | null; paymentDate?: string | null } = {},
): Promise<void> {
  const staffId = requireActorStaffId(actor);

  const before = await getRequest(requestId);
  if (!before) throw new Error("ไม่พบคำขอ");
  const step = before.currentStepCode;
  if (!step || before.status !== "Submitted") {
    throw new Error("คำขอไม่อยู่ในขั้นรออนุมัติ");
  }
  const nextStep = CLR_NEXT_STEP[step];

  // The Account (AP) step records the PV/PPEX doc no. + (conditional) payment date.
  if (step === "ACCOUNT") {
    const refund = before.clear?.refundToCompany ?? 0;
    if (refund < 0 && !opts.paymentDate) {
      // Company must pay the employee the shortfall — a payment date is required.
      throw new Error("กรณีบริษัทต้องจ่ายเพิ่ม กรุณาระบุวันจ่าย (Payment Date)");
    }
    await setAccountAction(requestId, opts.pvDocNo ?? null, opts.paymentDate ?? null);
  }

  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    // Guard: only act while the request is still at this step.
    const guard = await tx.request().input("rid", sql.Int, requestId).input("step", sql.NVarChar, step)
      .query(`SELECT COUNT(*) AS n FROM [dbo].[AccRequest]
              WHERE Id=@rid AND CurrentStepCode=@step AND Status='Submitted'`);
    if ((guard.recordset[0].n as number) === 0) {
      await tx.rollback();
      throw new Error("คำขอไม่อยู่ในขั้นรออนุมัติของขั้นนี้แล้ว");
    }

    // Mark the current step's pending approval row Approved.
    await tx.request()
      .input("rid", sql.Int, requestId)
      .input("step", sql.NVarChar, step)
      .input("staff", sql.Int, staffId)
      .input("email", sql.NVarChar, actor.email ?? null)
      .input("checked", sql.Bit, opts.isChecked == null ? null : opts.isChecked ? 1 : 0)
      .query(`UPDATE [dbo].[AccClearAdvanceApproval] SET Status='Approved', IsChecked=@checked,
              ActionedByStaffId=@staff, ActionedAt=SYSDATETIME(),
              AssignedEmail=CASE WHEN @email IS NOT NULL AND LTRIM(RTRIM(@email)) <> '' THEN @email ELSE AssignedEmail END
              WHERE RequestId=@rid AND StepCode=@step AND Status='Pending'`);

    if (nextStep) {
      await tx.request().input("rid", sql.Int, requestId).input("next", sql.NVarChar, nextStep)
        .query(`UPDATE [dbo].[AccRequest] SET CurrentStepCode=@next, UpdatedAt=SYSDATETIME() WHERE Id=@rid`);
      const stepOrder = nextStep === "ACCOUNT" ? 2 : 3;
      await tx.request().input("rid", sql.Int, requestId)
        .input("step", sql.NVarChar, nextStep).input("order", sql.Int, stepOrder)
        .query(`INSERT INTO [dbo].[AccClearAdvanceApproval] (RequestId, StepCode, StepOrder, Status)
                VALUES (@rid, @step, @order, 'Pending')`);
    } else {
      await tx.request().input("rid", sql.Int, requestId)
        .query(`UPDATE [dbo].[AccRequest] SET Status='Approved', CurrentStepCode=NULL, UpdatedAt=SYSDATETIME() WHERE Id=@rid`);
    }

    await tx.request().input("rid", sql.Int, requestId).input("by", sql.Int, actor.userId)
      .input("note", sql.NVarChar, `${step} approved`)
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note)
              VALUES (@rid, @by, 'approved', @note)`);

    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }

  const req = await getRequest(requestId);
  if (!req) return;
  const no = req.requestNo ?? String(requestId);

  if (nextStep) {
    const role = roleForStep(nextStep);
    const subject = `เคลียร์เงินทดรองจ่าย ${no} รออนุมัติ (${CLR_STEP_LABEL_TH[nextStep]})`;
    const body = `<p>คำขอเคลียร์คืนเงินทดรองจ่าย <b>${no}</b> รอการอนุมัติขั้น ${CLR_STEP_LABEL_TH[nextStep]}</p>` + link(requestId);
    if (role) {
      const approvers = await listClrApprovers(role);
      for (const a of approvers) await notify(requestId, subject, body, a.email, "StepAdvanced");
    }
  } else {
    const subject = `เคลียร์เงินทดรองจ่าย ${no} อนุมัติครบแล้ว`;
    const body =
      `<p>คำขอเคลียร์คืนเงินทดรองจ่าย <b>${no}</b> ได้รับการอนุมัติครบทุกขั้นแล้ว</p>` +
      `<p>ต้องโอนคืนบริษัท: ${(req.clear?.refundToCompany ?? 0).toLocaleString()} บาท</p>` + link(requestId);
    await notify(requestId, subject, body, req.requesterEmail, "Approved");
  }
}

/** Reject at the given step. Comment required. Stops the workflow. */
export async function reject(
  requestId: number,
  actor: Actor,
  stepCode: ClrStepCode,
  comment: string,
): Promise<void> {
  const staffId = requireActorStaffId(actor);
  if (!comment?.trim()) throw new Error("กรุณาระบุเหตุผลที่ไม่อนุมัติ");

  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const upd = await tx.request().input("rid", sql.Int, requestId).input("step", sql.NVarChar, stepCode)
      .query(`UPDATE [dbo].[AccRequest] SET Status='Rejected', CurrentStepCode=NULL, UpdatedAt=SYSDATETIME()
              WHERE Id=@rid AND CurrentStepCode=@step AND Status='Submitted';
              SELECT @@ROWCOUNT AS n`);
    if ((upd.recordset[0].n as number) === 0) {
      await tx.rollback();
      throw new Error("คำขอไม่อยู่ในขั้นที่สามารถไม่อนุมัติได้");
    }
    await tx.request()
      .input("rid", sql.Int, requestId).input("step", sql.NVarChar, stepCode)
      .input("staff", sql.Int, staffId).input("email", sql.NVarChar, actor.email ?? null)
      .input("c", sql.NVarChar, comment)
      .query(`UPDATE [dbo].[AccClearAdvanceApproval] SET Status='Rejected', Comment=@c,
              ActionedByStaffId=@staff, ActionedAt=SYSDATETIME(),
              AssignedEmail=CASE WHEN @email IS NOT NULL AND LTRIM(RTRIM(@email)) <> '' THEN @email ELSE AssignedEmail END
              WHERE RequestId=@rid AND StepCode=@step AND Status='Pending'`);
    await tx.request().input("rid", sql.Int, requestId).input("by", sql.Int, actor.userId)
      .input("c", sql.NVarChar, comment)
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note)
              VALUES (@rid, @by, 'rejected', @c)`);
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }

  const req = await getRequest(requestId);
  if (req) {
    const no = req.requestNo ?? String(requestId);
    await notify(
      requestId,
      `เคลียร์เงินทดรองจ่าย ${no} ไม่อนุมัติ`,
      `<p>คำขอ <b>${no}</b> ไม่ได้รับการอนุมัติ</p><p>เหตุผล: ${comment}</p>` + link(requestId),
      req.requesterEmail,
      "Rejected",
    );
  }
}

/**
 * Any current approver (Manager / Account / Head) returns the request to the
 * requester for revision. Comment required. Sends it back to Draft-editable
 * ("Returned") so the requester can revise and resubmit from the start.
 */
export async function returnForEdit(requestId: number, actor: Actor, comment: string): Promise<void> {
  const staffId = requireActorStaffId(actor);
  if (!comment?.trim()) throw new Error("กรุณาระบุสิ่งที่ต้องแก้ไข");

  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const upd = await tx.request().input("rid", sql.Int, requestId)
      .query(`UPDATE [dbo].[AccRequest] SET Status='Returned', CurrentStepCode=NULL, UpdatedAt=SYSDATETIME()
              WHERE Id=@rid AND Status='Submitted' AND CurrentStepCode IN ('MANAGER','ACCOUNT','HEAD');
              SELECT @@ROWCOUNT AS n`);
    if ((upd.recordset[0].n as number) === 0) {
      await tx.rollback();
      throw new Error("คำขอไม่อยู่ในขั้นที่สามารถส่งกลับแก้ไขได้");
    }
    // Mark the current pending step Returned (whichever step it is).
    await tx.request()
      .input("rid", sql.Int, requestId)
      .input("staff", sql.Int, staffId).input("email", sql.NVarChar, actor.email ?? null)
      .input("c", sql.NVarChar, comment)
      .query(`UPDATE [dbo].[AccClearAdvanceApproval] SET Status='Returned', Comment=@c,
              ActionedByStaffId=@staff, ActionedAt=SYSDATETIME(),
              AssignedEmail=CASE WHEN @email IS NOT NULL AND LTRIM(RTRIM(@email)) <> '' THEN @email ELSE AssignedEmail END
              WHERE RequestId=@rid AND Status='Pending'`);
    await tx.request().input("rid", sql.Int, requestId).input("by", sql.Int, actor.userId)
      .input("c", sql.NVarChar, comment)
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note)
              VALUES (@rid, @by, 'returned', @c)`);
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }

  const req = await getRequest(requestId);
  if (req) {
    const no = req.requestNo ?? String(requestId);
    await notify(
      requestId,
      `เคลียร์เงินทดรองจ่าย ${no} ส่งกลับแก้ไข`,
      `<p>คำขอ <b>${no}</b> ถูกส่งกลับให้แก้ไข</p><p>หมายเหตุ: ${comment}</p>` + link(requestId),
      req.requesterEmail,
      "Returned",
    );
  }
}

/**
 * Requester self-cancel: allowed within 24h of SubmittedAt while still pending the
 * manager (Status = Submitted, step = MANAGER) — i.e. before it reaches Account.
 * The route enforces requester ownership. Notifies the manager + requester by email.
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
              WHERE Id=@rid AND Status='Submitted' AND CurrentStepCode='MANAGER'
                AND SubmittedAt IS NOT NULL AND DATEDIFF(HOUR, SubmittedAt, SYSDATETIME()) <= 24;
              SELECT @@ROWCOUNT AS n`);
    if ((upd.recordset[0].n as number) === 0) {
      await tx.rollback();
      throw new Error("ไม่สามารถยกเลิกได้ — เกิน 24 ชม. หลังส่ง หรือคำขอเลยขั้นผู้จัดการไปแล้ว กรุณาติดต่อฝ่ายบัญชี");
    }
    await tx.request().input("rid", sql.Int, requestId).input("staff", sql.Int, staffId)
      .query(`UPDATE [dbo].[AccClearAdvanceApproval] SET Status='Returned', ActionedByStaffId=@staff, ActionedAt=SYSDATETIME()
              WHERE RequestId=@rid AND Status='Pending'`);
    await tx.request().input("rid", sql.Int, requestId).input("by", sql.Int, actor.userId)
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action) VALUES (@rid, @by, 'cancelled')`);
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }

  const req = await getRequest(requestId);
  if (req) {
    const no = req.requestNo ?? String(requestId);
    const subject = `เคลียร์เงินทดรองจ่าย ${no} ถูกยกเลิกโดยผู้ขอ`;
    const body =
      `<p>คำขอเคลียร์คืนเงินทดรองจ่าย <b>${no}</b> ถูกยกเลิกโดยผู้ขอ (ก่อนถึงขั้นบัญชี) — ไม่ต้องดำเนินการอนุมัติ</p>` +
      `<p>ผู้ขอ: ${req.requesterFullName ?? "-"}</p>` + link(requestId);
    await notify(requestId, subject, body, req.managerEmail, "Cancelled");
    await notify(requestId, subject, body, req.requesterEmail, "Cancelled");
  }
}
