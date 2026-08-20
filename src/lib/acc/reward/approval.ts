import { getAccPool, sql } from "@/lib/acc/pool";
import { requireActorStaffId } from "@/lib/acc/actor-context";
import type { Actor } from "@/lib/acc/approval-engine";
import { queueEmail, processQueue } from "@/lib/acc/email-queue";
import { AccConflictError } from "@/lib/acc/request-errors";
import { buildRewardEmail, type RewardTrigger } from "@/lib/acc/reward/email-templates";
import { getRewardRequest } from "@/lib/acc/reward/request-service";
import { listRewardOfficers } from "@/lib/acc/reward/access";
import { issueStock, readHeldStock, releaseStock, writeHold } from "@/lib/acc/reward/stock-ledger";
import { AP11_FORM_CODE } from "@/features/reward/constants";
import type { RewardRequest } from "@/features/reward/types";

/**
 * AP-11 approval and fulfilment actions.
 *
 * Same guarded-transition shape as AP-1's `approval-engine.ts` and AP-17's
 * `travel-booking/approval.ts`: `UPDATE … WHERE <expected state>; SELECT
 * @@ROWCOUNT`, rollback and throw on 0 rows so a double-click cannot process
 * twice, then commit and notify.
 *
 * What is new here is stock. Three of these functions move counters, and each
 * does it **inside the same transaction as the status change**, so the two can
 * never disagree:
 *
 * - reject (either step) → `releaseStock`, the only path that gives stock back
 * - received             → `issueStock`, held becomes issued in one statement
 * - return               → nothing, deliberately; a Returned request keeps its
 *                          hold, because the owner's rule is that only a Reject
 *                          returns stock
 */

export type { Actor };

async function notify(
  requestId: number,
  trigger: RewardTrigger,
  toEmail: string | null,
  note?: string,
): Promise<void> {
  if (!toEmail) return;
  try {
    const req = await getRewardRequest(requestId);
    if (!req) return;
    const mail = buildRewardEmail(trigger, req, note);
    await queueEmail({
      requestId,
      toEmail,
      subject: mail.subject,
      bodyHtml: mail.html,
      triggerType: trigger,
    });
  } catch {
    // A notification failure must never fail the action it describes.
  }
}

async function requireRequest(id: number): Promise<RewardRequest> {
  const req = await getRewardRequest(id);
  if (!req) throw new Error("ไม่พบคำขอ");
  return req;
}

async function requesterEmailOf(requestId: number): Promise<string | null> {
  const pool = await getAccPool();
  const r = await pool
    .request()
    .input("id", sql.Int, requestId)
    .query(`SELECT RequesterEmail FROM [dbo].[AccRequest] WHERE Id=@id`);
  return (r.recordset[0]?.RequesterEmail as string) ?? null;
}

/* ── Step 1 — Manager ── */

/** Manager approves: Submitted → ManagerApproved, handing off to the Assist AP queue. */
export async function approveByManager(requestId: number, actor: Actor): Promise<RewardRequest> {
  const staffId = requireActorStaffId(actor);
  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const upd = await tx
      .request()
      .input("rid", sql.Int, requestId)
      .input("form", sql.NVarChar, AP11_FORM_CODE)
      .query(
        `UPDATE [dbo].[AccRequest]
            SET Status='ManagerApproved', CurrentStepCode='REWARD', UpdatedAt=SYSDATETIME()
          WHERE Id=@rid AND FormCode=@form AND CurrentStepCode='MANAGER' AND Status='Submitted';
         SELECT @@ROWCOUNT AS n`,
      );
    if ((upd.recordset[0].n as number) === 0) {
      await tx.rollback();
      throw new AccConflictError("คำขอไม่อยู่ในขั้นรออนุมัติของผู้จัดการ");
    }
    await tx
      .request()
      .input("rid", sql.Int, requestId)
      .input("staff", sql.Int, staffId)
      .input("email", sql.NVarChar, actor.email ?? null)
      .query(
        `UPDATE [dbo].[AccApproval]
            SET Status='Approved', ActionedByStaffId=@staff, ActionedAt=SYSDATETIME(),
                AssignedEmail=CASE WHEN @email IS NOT NULL AND LTRIM(RTRIM(@email)) <> ''
                                   THEN @email ELSE AssignedEmail END
          WHERE RequestId=@rid AND StepCode='MANAGER' AND Status='Pending'`,
      );
    // One REWARD row — any active officer may action it, the way AP-1's single
    // ACCOUNT row works.
    await tx
      .request()
      .input("rid", sql.Int, requestId)
      .query(
        `INSERT INTO [dbo].[AccApproval] (RequestId, StepCode, StepOrder, AssignedEmail, Status)
         VALUES (@rid, 'REWARD', 2, NULL, 'Pending')`,
      );
    await tx
      .request()
      .input("rid", sql.Int, requestId)
      .input("by", sql.Int, actor.userId)
      .query(
        `INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action)
         VALUES (@rid, @by, 'manager_approved')`,
      );
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }

  for (const officer of await listRewardOfficers(true)) {
    await notify(requestId, "ManagerApproved", officer.email);
  }
  void processQueue().catch(() => {});
  return requireRequest(requestId);
}

/* ── Step 2 — Assist AP ── */

/** Assist AP accepts the request: ManagerApproved → Approved, ready to be prepared. */
export async function approveByOfficer(requestId: number, actor: Actor): Promise<RewardRequest> {
  const staffId = requireActorStaffId(actor);
  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const upd = await tx
      .request()
      .input("rid", sql.Int, requestId)
      .input("form", sql.NVarChar, AP11_FORM_CODE)
      .query(
        `UPDATE [dbo].[AccRequest]
            SET Status='Approved', CurrentStepCode=NULL, UpdatedAt=SYSDATETIME()
          WHERE Id=@rid AND FormCode=@form AND CurrentStepCode='REWARD' AND Status='ManagerApproved';
         SELECT @@ROWCOUNT AS n`,
      );
    if ((upd.recordset[0].n as number) === 0) {
      await tx.rollback();
      throw new AccConflictError("คำขอไม่อยู่ในขั้นรออนุมัติของ Assist AP");
    }
    await tx
      .request()
      .input("rid", sql.Int, requestId)
      .input("staff", sql.Int, staffId)
      .input("email", sql.NVarChar, actor.email ?? null)
      .query(
        `UPDATE [dbo].[AccApproval]
            SET Status='Approved', ActionedByStaffId=@staff, ActionedAt=SYSDATETIME(),
                AssignedEmail=CASE WHEN @email IS NOT NULL AND LTRIM(RTRIM(@email)) <> ''
                                   THEN @email ELSE AssignedEmail END
          WHERE RequestId=@rid AND StepCode='REWARD' AND Status='Pending'`,
      );
    await tx
      .request()
      .input("rid", sql.Int, requestId)
      .input("by", sql.Int, actor.userId)
      .query(
        `INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action)
         VALUES (@rid, @by, 'reward_approved')`,
      );
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }

  await notify(requestId, "Approved", await requesterEmailOf(requestId));
  void processQueue().catch(() => {});
  return requireRequest(requestId);
}

/* ── Reject and Return, shared by both steps ── */

interface StageGuard {
  /** The step this action is valid from. */
  stepCode: "MANAGER" | "REWARD";
  /** The status that step sits in. */
  fromStatus: "Submitted" | "ManagerApproved";
  blockedError: string;
}

const MANAGER_STAGE: StageGuard = {
  stepCode: "MANAGER",
  fromStatus: "Submitted",
  blockedError: "คำขอไม่อยู่ในขั้นรออนุมัติของผู้จัดการ",
};

const OFFICER_STAGE: StageGuard = {
  stepCode: "REWARD",
  fromStatus: "ManagerApproved",
  blockedError: "คำขอไม่อยู่ในขั้นรออนุมัติของ Assist AP",
};

/**
 * Reject from either step — terminal, and **the only path that returns stock**.
 *
 * The release runs inside the same transaction as the status change. Split
 * across two, a crash between them leaves either stock nobody can reach or a
 * rejected request still holding goods, and both are invisible until somebody
 * counts by hand.
 */
async function rejectFromStage(
  requestId: number,
  actor: Actor,
  comment: string,
  stage: StageGuard,
  action: string,
): Promise<RewardRequest> {
  const staffId = requireActorStaffId(actor);
  if (!comment?.trim()) throw new Error("กรุณาระบุเหตุผลที่ไม่อนุมัติ");

  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const upd = await tx
      .request()
      .input("rid", sql.Int, requestId)
      .input("form", sql.NVarChar, AP11_FORM_CODE)
      .input("step", sql.NVarChar(30), stage.stepCode)
      .input("from", sql.NVarChar(30), stage.fromStatus)
      .query(
        `UPDATE [dbo].[AccRequest]
            SET Status='Rejected', CurrentStepCode=NULL, UpdatedAt=SYSDATETIME()
          WHERE Id=@rid AND FormCode=@form AND CurrentStepCode=@step AND Status=@from;
         SELECT @@ROWCOUNT AS n`,
      );
    if ((upd.recordset[0].n as number) === 0) {
      await tx.rollback();
      throw new AccConflictError(stage.blockedError);
    }

    // Give the stock back, then zero the request's own record of its hold.
    //
    // Read inside the transaction so the release acts on the same row the guard
    // above just claimed. Zeroing matters as much as the release: `LockedQty` on
    // the request is what the reconciliation check re-derives the reward's
    // counters from, so leaving it set would report the released amount as still
    // held forever.
    const held = await readHeldStock(tx, requestId);
    if (held) {
      await releaseStock(tx, held.rewardId, held.qty);
      await writeHold(tx, requestId, null, 0);
    }

    await tx
      .request()
      .input("rid", sql.Int, requestId)
      .input("staff", sql.Int, staffId)
      .input("email", sql.NVarChar, actor.email ?? null)
      .input("c", sql.NVarChar, comment)
      .input("step", sql.NVarChar(30), stage.stepCode)
      .query(
        `UPDATE [dbo].[AccApproval]
            SET Status='Rejected', Comment=@c, ActionedByStaffId=@staff, ActionedAt=SYSDATETIME(),
                AssignedEmail=CASE WHEN @email IS NOT NULL AND LTRIM(RTRIM(@email)) <> ''
                                   THEN @email ELSE AssignedEmail END
          WHERE RequestId=@rid AND StepCode=@step AND Status='Pending'`,
      );
    await tx
      .request()
      .input("rid", sql.Int, requestId)
      .input("by", sql.Int, actor.userId)
      .input("action", sql.NVarChar(50), action)
      .input("c", sql.NVarChar, comment)
      .query(
        `INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note)
         VALUES (@rid, @by, @action, @c)`,
      );
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }

  await notify(requestId, "Rejected", await requesterEmailOf(requestId), comment);
  void processQueue().catch(() => {});
  return requireRequest(requestId);
}

/**
 * Return for edits from either step.
 *
 * `CurrentStepCode` goes back to `MANAGER` because a resubmit wipes the
 * approval rows and runs the chain from scratch. **Stock is not released** — the
 * request is still alive and the requester is expected to fix and resend it, so
 * the goods stay reserved for them. `submitRewardRequest` knows this and adjusts
 * by the delta rather than taking the whole quantity a second time.
 */
async function returnFromStage(
  requestId: number,
  actor: Actor,
  comment: string,
  stage: StageGuard,
  action: string,
): Promise<RewardRequest> {
  const staffId = requireActorStaffId(actor);
  if (!comment?.trim()) throw new Error("กรุณาระบุสิ่งที่ต้องแก้ไข");

  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const upd = await tx
      .request()
      .input("rid", sql.Int, requestId)
      .input("form", sql.NVarChar, AP11_FORM_CODE)
      .input("step", sql.NVarChar(30), stage.stepCode)
      .input("from", sql.NVarChar(30), stage.fromStatus)
      .query(
        `UPDATE [dbo].[AccRequest]
            SET Status='Returned', CurrentStepCode='MANAGER', UpdatedAt=SYSDATETIME()
          WHERE Id=@rid AND FormCode=@form AND CurrentStepCode=@step AND Status=@from;
         SELECT @@ROWCOUNT AS n`,
      );
    if ((upd.recordset[0].n as number) === 0) {
      await tx.rollback();
      throw new AccConflictError(stage.blockedError);
    }
    await tx
      .request()
      .input("rid", sql.Int, requestId)
      .input("staff", sql.Int, staffId)
      .input("email", sql.NVarChar, actor.email ?? null)
      .input("c", sql.NVarChar, comment)
      .input("step", sql.NVarChar(30), stage.stepCode)
      .query(
        `UPDATE [dbo].[AccApproval]
            SET Status='Returned', Comment=@c, ActionedByStaffId=@staff, ActionedAt=SYSDATETIME(),
                AssignedEmail=CASE WHEN @email IS NOT NULL AND LTRIM(RTRIM(@email)) <> ''
                                   THEN @email ELSE AssignedEmail END
          WHERE RequestId=@rid AND StepCode=@step AND Status='Pending'`,
      );
    await tx
      .request()
      .input("rid", sql.Int, requestId)
      .input("by", sql.Int, actor.userId)
      .input("action", sql.NVarChar(50), action)
      .input("c", sql.NVarChar, comment)
      .query(
        `INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note)
         VALUES (@rid, @by, @action, @c)`,
      );
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }

  await notify(requestId, "Returned", await requesterEmailOf(requestId), comment);
  void processQueue().catch(() => {});
  return requireRequest(requestId);
}

export const rejectByManager = (requestId: number, actor: Actor, comment: string) =>
  rejectFromStage(requestId, actor, comment, MANAGER_STAGE, "manager_rejected");

export const returnByManager = (requestId: number, actor: Actor, comment: string) =>
  returnFromStage(requestId, actor, comment, MANAGER_STAGE, "manager_returned");

export const rejectByOfficer = (requestId: number, actor: Actor, comment: string) =>
  rejectFromStage(requestId, actor, comment, OFFICER_STAGE, "reward_rejected");

export const returnByOfficer = (requestId: number, actor: Actor, comment: string) =>
  returnFromStage(requestId, actor, comment, OFFICER_STAGE, "reward_returned");

/* ── Fulfilment — the Assist AP work page ── */

/**
 * "จัดของเสร็จแล้ว" — Approved → Ready, stamping the date and time (brief
 * §"หน้าทำงานของ Assist AP" item 1).
 *
 * No stock movement: the goods are on the counter, not out of the door.
 */
export async function markReady(requestId: number, actor: Actor): Promise<RewardRequest> {
  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const upd = await tx
      .request()
      .input("rid", sql.Int, requestId)
      .input("form", sql.NVarChar, AP11_FORM_CODE)
      .query(
        `UPDATE [dbo].[AccRequest]
            SET Status='Ready', UpdatedAt=SYSDATETIME()
          WHERE Id=@rid AND FormCode=@form AND Status='Approved';
         SELECT @@ROWCOUNT AS n`,
      );
    if ((upd.recordset[0].n as number) === 0) {
      await tx.rollback();
      throw new AccConflictError("คำขอนี้ยังไม่ได้รับอนุมัติ หรือถูกบันทึกไปแล้ว");
    }
    await tx
      .request()
      .input("rid", sql.Int, requestId)
      .input("by", sql.Int, actor.userId)
      .query(
        `UPDATE [dbo].[AccRewardRequest]
            SET ReadyAt=SYSDATETIME(), ReadyBy=@by, UpdatedAt=SYSDATETIME()
          WHERE RequestId=@rid`,
      );
    await tx
      .request()
      .input("rid", sql.Int, requestId)
      .input("by", sql.Int, actor.userId)
      .query(
        `INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action)
         VALUES (@rid, @by, 'reward_ready')`,
      );
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }

  await notify(requestId, "Ready", await requesterEmailOf(requestId));
  void processQueue().catch(() => {});
  return requireRequest(requestId);
}

/**
 * "ผู้ขอรับของแล้ว" — Ready → Received (terminal), stamping the date and time
 * (brief item 2) and moving the quantity from held to issued.
 *
 * This is the one place `IssuedQty` ever grows, and it happens in the same
 * transaction and the same statement pair as the status change: `issueStock`
 * decrements and increments in a single UPDATE, so the committed total never
 * moves even for an instant.
 */
export async function markReceived(requestId: number, actor: Actor): Promise<RewardRequest> {
  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const upd = await tx
      .request()
      .input("rid", sql.Int, requestId)
      .input("form", sql.NVarChar, AP11_FORM_CODE)
      .query(
        `UPDATE [dbo].[AccRequest]
            SET Status='Received', CurrentStepCode=NULL, UpdatedAt=SYSDATETIME()
          WHERE Id=@rid AND FormCode=@form AND Status='Ready';
         SELECT @@ROWCOUNT AS n`,
      );
    if ((upd.recordset[0].n as number) === 0) {
      await tx.rollback();
      throw new AccConflictError("ต้องกด Ready ก่อน หรือคำขอนี้ถูกบันทึกไปแล้ว");
    }

    // Held becomes issued. `LockedQty`/`LockedRewardId` on the request are left
    // exactly as they are: they now record what was *issued* rather than what is
    // held, and the request's terminal `Received` status is what says which of
    // the reward's two counters that quantity sits in. The reconciliation check
    // reads the pair the same way.
    const held = await readHeldStock(tx, requestId);
    if (held) await issueStock(tx, held.rewardId, held.qty);

    await tx
      .request()
      .input("rid", sql.Int, requestId)
      .input("by", sql.Int, actor.userId)
      .query(
        `UPDATE [dbo].[AccRewardRequest]
            SET ReceivedAt=SYSDATETIME(), ReceivedBy=@by, UpdatedAt=SYSDATETIME()
          WHERE RequestId=@rid`,
      );
    await tx
      .request()
      .input("rid", sql.Int, requestId)
      .input("by", sql.Int, actor.userId)
      .query(
        `INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action)
         VALUES (@rid, @by, 'reward_received')`,
      );
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }

  await notify(requestId, "Received", await requesterEmailOf(requestId));
  void processQueue().catch(() => {});
  return requireRequest(requestId);
}
