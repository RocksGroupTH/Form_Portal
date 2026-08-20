import { getAccPool, sql } from "@/lib/acc/pool";
import { allocateRequestNo } from "@/lib/acc/sequence";
import { resolveManagerEmail } from "@/lib/acc/employee-context";
import { resolveEmployeeForActor } from "@/lib/hr/employee-lookup";
import { assertFormWritable, isUatRequest, UAT_MANAGER_MISSING_ERROR } from "@/lib/uat-tester/guards";
import { AccConflictError, SUBMIT_ALREADY_CLAIMED } from "@/lib/acc/request-errors";
import { queueEmail, processQueue } from "@/lib/acc/email-queue";
import { buildRewardEmail } from "@/lib/acc/reward/email-templates";
import { getReward } from "@/lib/acc/reward/settings-service";
import { moveHold, readHeldStock, takeStock, writeHold } from "@/lib/acc/reward/stock-ledger";
import { validateRequestedQty } from "@/lib/acc/reward/stock";
import { resolveNames as resolveMemberNames } from "@/lib/team-member/service";
import {
  AP11_FORM_CODE,
  EDITABLE_STATUSES,
  REWARD_FILE_REFTYPE,
  RUNNING_PREFIX,
  STOCK_HOLDING_STATUSES,
} from "@/features/reward/constants";
import type { RewardListRow, RewardRequest } from "@/features/reward/types";

/**
 * AP-11 request lifecycle — draft, read, submit.
 *
 * The submit is the interesting half. Every other form on this backbone records
 * a claim about something that already happened; AP-11's submit **takes stock
 * that can run out**, so it has to be a claim in the concurrency sense too. See
 * `submitRewardRequest` for the ordering and why it is that order.
 */

function iso(v: unknown): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* ── Reads ── */

const REQUEST_SELECT = `
  SELECT r.Id, r.RequestNo, r.FormCode, r.BrandCode, r.Status, r.CurrentStepCode,
         r.StaffId, r.RequesterFullName, r.RequesterEmail, r.RequesterPosition,
         r.RequesterDepartmentName, r.ManagerStaffId, r.ManagerEmail, r.CompanyName,
         r.SubmittedAt, r.CreatedAt, r.UpdatedAt,
         d.RewardId, d.RewardCode, d.RewardName, d.UnitActualValue, d.UnitBookValue,
         d.Qty, d.Note, d.ReadyAt, d.ReadyBy, d.ReceivedAt, d.ReceivedBy
    FROM [dbo].[AccRequest] r
    LEFT JOIN [dbo].[AccRewardRequest] d ON d.RequestId = r.Id
`;

function mapRequestHead(x: Record<string, unknown>): Omit<RewardRequest, "attachments" | "approvals" | "timeline"> {
  const qty = (x.Qty as number) ?? 0;
  const unitActual = num(x.UnitActualValue);
  return {
    id: x.Id as number,
    requestNo: (x.RequestNo as string) ?? null,
    formCode: x.FormCode as string,
    brandCode: (x.BrandCode as string) ?? null,
    status: x.Status as RewardRequest["status"],
    currentStepCode: (x.CurrentStepCode as string) ?? null,

    staffId: (x.StaffId as number) ?? null,
    requesterFullName: (x.RequesterFullName as string) ?? null,
    requesterEmail: (x.RequesterEmail as string) ?? null,
    requesterPosition: (x.RequesterPosition as string) ?? null,
    requesterDepartmentName: (x.RequesterDepartmentName as string) ?? null,
    managerStaffId: (x.ManagerStaffId as number) ?? null,
    managerEmail: (x.ManagerEmail as string) ?? null,
    companyName: (x.CompanyName as string) ?? null,

    rewardId: (x.RewardId as number) ?? null,
    rewardCode: (x.RewardCode as string) ?? null,
    rewardName: (x.RewardName as string) ?? null,
    unitActualValue: unitActual,
    unitBookValue: num(x.UnitBookValue),
    qty,
    note: (x.Note as string) ?? null,
    // Computed here rather than in the client, so money is derived in exactly
    // one place and the report and the detail page cannot disagree.
    totalActualValue: unitActual == null ? null : Math.round(unitActual * qty * 100) / 100,

    readyAt: iso(x.ReadyAt),
    readyByName: null,
    receivedAt: iso(x.ReceivedAt),
    receivedByName: null,

    submittedAt: iso(x.SubmittedAt),
    createdAt: iso(x.CreatedAt) ?? "",
    updatedAt: iso(x.UpdatedAt) ?? "",
  };
}

/** One request with its attachments, approval chain and timeline. */
export async function getRewardRequest(id: number): Promise<RewardRequest | null> {
  const pool = await getAccPool();
  const r = await pool
    .request()
    .input("id", sql.Int, id)
    .input("form", sql.NVarChar, AP11_FORM_CODE)
    .query(`${REQUEST_SELECT} WHERE r.Id = @id AND r.FormCode = @form`);
  if (!r.recordset.length) return null;

  const head = mapRequestHead(r.recordset[0] as Record<string, unknown>);

  const [files, approvals, log] = await Promise.all([
    pool
      .request()
      .input("id", sql.Int, id)
      .input("ref", sql.NVarChar, REWARD_FILE_REFTYPE)
      .query(
        `SELECT Id, FileName, FileSize, ContentType, UploadedAt
           FROM [dbo].[AccRequestFile]
          WHERE RequestId=@id AND RefType=@ref ORDER BY Id`,
      ),
    pool
      .request()
      .input("id", sql.Int, id)
      .query(
        `SELECT StepCode, StepOrder, Status, AssignedTo, AssignedEmail, ActionedByStaffId, ActionedAt, Comment
           FROM [dbo].[AccApproval] WHERE RequestId=@id ORDER BY StepOrder, Id`,
      ),
    pool
      .request()
      .input("id", sql.Int, id)
      .query(
        // No join to TeamMember. It lives only in the production form database
        // (migration 066 is deliberately not applied to the UAT twin), so a
        // two-part `[dbo].[TeamMember]` threw `Invalid object name` on every
        // UAT read of this page — the route answered 500 and the form rendered
        // "ไม่พบคำขอ" for a draft that was sitting right there. The column it
        // selected, `DisplayName`, does not exist either, so the same query
        // failed in production for a second reason. Author names are resolved
        // below through `@/lib/team-member/service`, which owns every statement
        // that names the table and pins them to the production pool.
        `SELECT Id, Action, Note, CreatedAt, AuthorId
           FROM [dbo].[AccActivityLog]
          WHERE RequestId=@id ORDER BY Id`,
      ),
  ]);

  const authorNames = await resolveMemberNames(
    log.recordset.map((x: Record<string, unknown>) => Number(x.AuthorId)),
  );

  return {
    ...head,
    attachments: files.recordset.map((x: Record<string, unknown>) => ({
      id: x.Id as number,
      fileName: x.FileName as string,
      fileSize: (x.FileSize as number) ?? null,
      contentType: (x.ContentType as string) ?? null,
      uploadedAt: iso(x.UploadedAt) ?? "",
    })),
    approvals: approvals.recordset.map((x: Record<string, unknown>) => ({
      stepCode: x.StepCode as string,
      stepOrder: (x.StepOrder as number) ?? 0,
      status: x.Status as string,
      assignedTo: (x.AssignedTo as number) ?? null,
      assignedEmail: (x.AssignedEmail as string) ?? null,
      actionedByStaffId: (x.ActionedByStaffId as number) ?? null,
      actionedAt: iso(x.ActionedAt),
      comment: (x.Comment as string) ?? null,
    })),
    timeline: log.recordset.map((x: Record<string, unknown>) => {
      const member = authorNames.get(Number(x.AuthorId));
      return {
        id: x.Id as number,
        action: x.Action as string,
        note: (x.Note as string) ?? null,
        // Nickname first, like every other "who did this" line in the app; the
        // service trims nulls to "", so a blank falls through.
        authorName: member ? member.nickname || member.fullName || null : null,
        createdAt: iso(x.CreatedAt) ?? "",
      };
    }),
  };
}

const LIST_SELECT = `
  SELECT r.Id, r.RequestNo, r.Status, r.BrandCode, r.RequesterFullName,
         r.RequesterDepartmentName, r.StaffId, r.SubmittedAt, r.UpdatedAt,
         d.RewardCode, d.RewardName, d.Qty, d.UnitActualValue, d.ReadyAt, d.ReceivedAt
    FROM [dbo].[AccRequest] r
    LEFT JOIN [dbo].[AccRewardRequest] d ON d.RequestId = r.Id
`;

function mapListRow(x: Record<string, unknown>): RewardListRow {
  const qty = (x.Qty as number) ?? 0;
  const unitActual = num(x.UnitActualValue);
  return {
    id: x.Id as number,
    requestNo: (x.RequestNo as string) ?? null,
    status: x.Status as RewardListRow["status"],
    brandCode: (x.BrandCode as string) ?? null,
    requesterFullName: (x.RequesterFullName as string) ?? null,
    requesterDepartmentName: (x.RequesterDepartmentName as string) ?? null,
    staffId: (x.StaffId as number) ?? null,
    rewardCode: (x.RewardCode as string) ?? null,
    rewardName: (x.RewardName as string) ?? null,
    qty,
    totalActualValue: unitActual == null ? null : Math.round(unitActual * qty * 100) / 100,
    submittedAt: iso(x.SubmittedAt),
    readyAt: iso(x.ReadyAt),
    receivedAt: iso(x.ReceivedAt),
    updatedAt: iso(x.UpdatedAt),
  };
}

/** Everything this person submitted — feeds `/my-request` through `query-both`. */
export async function listMyRewardRequests(userId: number): Promise<RewardListRow[]> {
  const pool = await getAccPool();
  const r = await pool
    .request()
    .input("uid", sql.Int, userId)
    .input("form", sql.NVarChar, AP11_FORM_CODE)
    .query(
      `${LIST_SELECT} WHERE r.FormCode=@form AND (r.CreatedBy=@uid OR r.SubmittedBy=@uid)
                        AND r.Status <> 'Draft'
        ORDER BY r.Id DESC`,
    );
  return r.recordset.map((x: Record<string, unknown>) => mapListRow(x));
}

/** Resumable work — drafts and returned requests, for Home's "continue where you left off". */
export async function listMyRewardDrafts(userId: number): Promise<RewardListRow[]> {
  const pool = await getAccPool();
  const r = await pool
    .request()
    .input("uid", sql.Int, userId)
    .input("form", sql.NVarChar, AP11_FORM_CODE)
    .query(
      `${LIST_SELECT} WHERE r.FormCode=@form AND r.CreatedBy=@uid
                        AND r.Status IN ('Draft','Returned')
        ORDER BY r.UpdatedAt DESC`,
    );
  return r.recordset.map((x: Record<string, unknown>) => mapListRow(x));
}

/* ── Draft write ── */

export interface RewardDraftInput {
  /** Absent for a new draft. */
  id?: number | null;
  brandCode: string;
  rewardId: number | null;
  qty: number;
  note?: string | null;
  /** On-behalf submission — the colleague this is filed for. */
  requesterStaffId?: number | null;
}

/**
 * Create or update a draft.
 *
 * The quantity is validated against live stock here as well as at submit, so a
 * requester finds out while they are still typing rather than at the end. That
 * check is advisory — nothing is reserved until submit — which is why the submit
 * path repeats it as a conditional UPDATE rather than trusting this one.
 */
export async function saveRewardDraft(
  input: RewardDraftInput,
  userId: number,
  loginEmail: string,
): Promise<number> {
  await assertFormWritable();

  if (!input.brandCode?.trim()) throw new Error("กรุณาเลือกบริษัท (Brand)");

  const emp = await resolveEmployeeForActor(loginEmail, input.requesterStaffId ?? null, {
    forWrite: true,
  });

  if (input.rewardId) {
    const reward = await getReward(input.rewardId);
    if (!reward) throw new Error("ไม่พบของรางวัลที่เลือก");
    if (reward.brandCode !== input.brandCode.trim()) {
      throw new Error("ของรางวัลนี้ไม่ได้อยู่ในบริษัทที่เลือก");
    }
    const problem = validateRequestedQty(reward, input.qty);
    if (problem) throw new Error(problem);
  }

  const pool = await getAccPool();
  const fullName =
    [emp.firstName, emp.lastName].filter(Boolean).join(" ") || emp.fullName || null;

  if (input.id) {
    // Ownership and editability in the predicate, not in a prior read — a read
    // cannot bind the write.
    const upd = await pool
      .request()
      .input("id", sql.Int, input.id)
      .input("uid", sql.Int, userId)
      .input("brand", sql.NVarChar(20), input.brandCode.trim())
      .query(
        `UPDATE [dbo].[AccRequest]
            SET BrandCode=@brand, UpdatedAt=SYSDATETIME()
          WHERE Id=@id AND CreatedBy=@uid AND Status IN ('Draft','Returned');
         SELECT @@ROWCOUNT AS n`,
      );
    if ((upd.recordset[0].n as number) === 0) {
      throw new AccConflictError("แก้ไขได้เฉพาะฉบับร่างของคุณเท่านั้น");
    }
    await writeDetail(pool, input.id, input);
    return input.id;
  }

  const ins = await pool
    .request()
    .input("form", sql.NVarChar(20), AP11_FORM_CODE)
    .input("brand", sql.NVarChar(20), input.brandCode.trim())
    .input("empId", sql.UniqueIdentifier, emp.id)
    .input("staff", sql.Int, emp.staffId)
    .input("first", sql.NVarChar(200), emp.firstName ?? null)
    .input("last", sql.NVarChar(200), emp.lastName ?? null)
    .input("full", sql.NVarChar(200), fullName)
    .input("email", sql.NVarChar(200), emp.email ?? emp.emailCompBr ?? null)
    .input("pos", sql.NVarChar(200), emp.position ?? null)
    .input("deptId", sql.Int, emp.departmentId ?? null)
    .input("deptName", sql.NVarChar(200), emp.departmentName ?? null)
    .input("deptCode", sql.NVarChar(50), emp.departmentCode ?? null)
    .input("company", sql.NVarChar(200), emp.brand?.companyName ?? null)
    .input("uid", sql.Int, userId)
    .query(
      `INSERT INTO [dbo].[AccRequest]
         (FormCode, BrandCode, Status, EmployeeId, StaffId,
          RequesterFirstName, RequesterLastName, RequesterFullName, RequesterEmail,
          RequesterPosition, RequesterDepartmentId, RequesterDepartmentName,
          RequesterDepartmentCode, CompanyName, CreatedBy)
       OUTPUT inserted.Id AS Id
       VALUES (@form, @brand, 'Draft', @empId, @staff,
               @first, @last, @full, @email,
               @pos, @deptId, @deptName, @deptCode, @company, @uid)`,
    );
  const requestId = ins.recordset[0].Id as number;
  await writeDetail(pool, requestId, input);
  return requestId;
}

/**
 * Upsert the single detail row.
 *
 * The snapshot columns stay empty until submit: a draft still points at a live
 * reward, and copying its name and value early would freeze figures the
 * requester has not committed to yet.
 */
async function writeDetail(
  pool: Awaited<ReturnType<typeof getAccPool>>,
  requestId: number,
  input: RewardDraftInput,
): Promise<void> {
  await pool
    .request()
    .input("rid", sql.Int, requestId)
    .input("reward", sql.Int, input.rewardId ?? null)
    .input("qty", sql.Int, Math.max(0, Math.trunc(Number(input.qty) || 0)))
    .input("note", sql.NVarChar(1000), input.note?.trim() || null)
    .query(
      `MERGE [dbo].[AccRewardRequest] WITH (HOLDLOCK) AS t
       USING (SELECT @rid AS RequestId) AS s ON t.RequestId = s.RequestId
       WHEN MATCHED THEN UPDATE SET
         RewardId=@reward, Qty=@qty, Note=@note, UpdatedAt=SYSDATETIME()
       WHEN NOT MATCHED THEN
         INSERT (RequestId, RewardId, Qty, Note) VALUES (@rid, @reward, @qty, @note);`,
    );
}

/** Delete a draft the caller owns. Nothing is held yet, so no stock to release. */
export async function deleteRewardDraft(id: number, userId: number): Promise<void> {
  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const guard = await tx
      .request()
      .input("id", sql.Int, id)
      .input("uid", sql.Int, userId)
      .input("form", sql.NVarChar, AP11_FORM_CODE)
      .query(
        `SELECT Id FROM [dbo].[AccRequest]
          WHERE Id=@id AND CreatedBy=@uid AND FormCode=@form AND Status='Draft'`,
      );
    if (!guard.recordset.length) {
      await tx.rollback();
      throw new AccConflictError("ลบได้เฉพาะฉบับร่างของคุณเท่านั้น");
    }
    for (const table of ["AccRewardRequest", "AccRequestFile", "AccApproval", "AccActivityLog"]) {
      await tx.request().input("id", sql.Int, id).query(`DELETE FROM [dbo].[${table}] WHERE RequestId=@id`);
    }
    await tx.request().input("id", sql.Int, id).query(`DELETE FROM [dbo].[AccRequest] WHERE Id=@id`);
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}

/* ── Submit ── */

/**
 * Submit a draft: claim the row, take the stock, then number it.
 *
 * **That order is the whole design.** Reversed or loosened, each step fails in a
 * way that costs something real:
 *
 * 1. *Claim the request* with `Status IN ('Draft','Returned')` and
 *    `CreatedBy=@uid` in the predicate. Two clicks on the same draft: one
 *    updates a row, the other updates none and is told to reload.
 * 2. *Take the stock* with `takeStock`, whose predicate re-tests availability
 *    and cannot oversell. The card list the requester saw was a read, not a
 *    reservation; this is the reservation. A `Returned` request already holds
 *    its quantity — the owner's rule is that only a Reject returns stock — so a
 *    resubmit adjusts by the delta instead of taking the whole amount again.
 * 3. *Only then allocate the running number*, inside the transaction. A number
 *    issued before a failed claim leaves a hole in a sequence people read as a
 *    ledger.
 *
 * Everything before the transaction is validation that can fail cheaply;
 * everything inside it either all happens or none of it does.
 */
export async function submitRewardRequest(
  id: number,
  userId: number,
  loginEmail: string,
): Promise<RewardRequest> {
  await assertFormWritable();
  const pool = await getAccPool();

  const head = await pool
    .request()
    .input("id", sql.Int, id)
    .input("form", sql.NVarChar, AP11_FORM_CODE)
    .query(
      `SELECT r.Id, r.CreatedBy, r.Status, r.StaffId, r.BrandCode,
              d.RewardId, d.Qty, d.LockedRewardId, d.LockedQty
         FROM [dbo].[AccRequest] r
         LEFT JOIN [dbo].[AccRewardRequest] d ON d.RequestId = r.Id
        WHERE r.Id=@id AND r.FormCode=@form`,
    );
  if (!head.recordset.length) throw new Error("ไม่พบคำขอนี้");

  const row = head.recordset[0] as Record<string, unknown>;
  if ((row.CreatedBy as number) !== userId) throw new Error("ไม่มีสิทธิ์ส่งคำขอนี้");
  const status = row.Status as string;
  if (EDITABLE_STATUSES.indexOf(status) === -1) throw new AccConflictError("คำขอนี้ถูกส่งไปแล้ว");

  const rewardId = (row.RewardId as number) ?? null;
  const qty = (row.Qty as number) ?? 0;
  if (!rewardId) throw new Error("กรุณาเลือกของรางวัล");

  const reward = await getReward(rewardId);
  if (!reward) throw new Error("ไม่พบของรางวัลที่เลือก");

  /**
   * What this request already holds, if anything.
   *
   * `LockedQty`/`LockedRewardId`, not `Qty`/`RewardId`: a Returned request keeps
   * its hold while the requester edits, and they may change either. Reading the
   * hold out of the intent columns would make the two always equal, so a
   * resubmit that changed 5 to 8 would adjust the lock by zero and leave the
   * reward under-locked by 3 — which `CK_AccReward_Stock` cannot catch, because
   * the counters stay internally consistent while no longer matching the
   * requests they came from.
   */
  const heldRewardId = (row.LockedRewardId as number) ?? null;
  const heldQty = STOCK_HOLDING_STATUSES.indexOf(status) !== -1
    ? (row.LockedQty as number) ?? 0
    : 0;
  const alreadyHolding = heldQty > 0 && heldRewardId != null;

  // Discount this request's own hold, but only when it is against the *same*
  // reward — a hold on a different reward frees nothing here, and counting it
  // would let a resubmit claim availability it does not have.
  const ownHoldOnThisReward = alreadyHolding && heldRewardId === rewardId ? heldQty : 0;
  const problem = validateRequestedQty(
    {
      qty: reward.qty,
      lockedQty: reward.lockedQty - ownHoldOnThisReward,
      issuedQty: reward.issuedQty,
      startDate: reward.startDate,
      expireDate: reward.expireDate,
      isActive: reward.isActive,
    },
    qty,
  );
  if (problem) throw new AccConflictError(problem);

  // Evidence is what the whole claim rests on (brief §5) — a request with no
  // screenshot cannot be assessed, so it is refused before anything is claimed.
  const fileCount = await pool
    .request()
    .input("id", sql.Int, id)
    .input("ref", sql.NVarChar, REWARD_FILE_REFTYPE)
    .query(`SELECT COUNT(*) AS n FROM [dbo].[AccRequestFile] WHERE RequestId=@id AND RefType=@ref`);
  if ((fileCount.recordset[0].n as number) === 0) {
    throw new Error("กรุณาแนบเอกสารประกอบการเบิกอย่างน้อย 1 ไฟล์");
  }

  const emp = await resolveEmployeeForActor(loginEmail, (row.StaffId as number) ?? null, {
    forWrite: true,
  });
  const uat = await isUatRequest();
  if (!emp.managerStaffId) {
    throw new Error(
      uat ? UAT_MANAGER_MISSING_ERROR : "ยังไม่ได้กำหนดผู้จัดการ (ManagerStaffId) ในระบบ HR",
    );
  }
  const managerEmail = await resolveManagerEmail(emp.managerStaffId);
  if (!managerEmail) {
    throw new Error(
      uat ? UAT_MANAGER_MISSING_ERROR : "ไม่พบอีเมลผู้จัดการในระบบ HR — ไม่สามารถส่งอนุมัติได้",
    );
  }

  const totalAmount =
    reward.unitActualValue == null ? null : Math.round(reward.unitActualValue * qty * 100) / 100;

  const tx = pool.transaction();
  await tx.begin();
  try {
    // 1. Claim.
    const claim = await tx
      .request()
      .input("id", sql.Int, id)
      .input("uid", sql.Int, userId)
      .input("mgrStaff", sql.Int, emp.managerStaffId)
      .input("mgrEmail", sql.NVarChar, managerEmail)
      .input("total", sql.Decimal(18, 2), totalAmount)
      .query(
        `UPDATE [dbo].[AccRequest] SET
            Status='Submitted', CurrentStepCode='MANAGER',
            ManagerStaffId=@mgrStaff, ManagerEmail=@mgrEmail, TotalAmount=@total,
            SubmittedBy=@uid, SubmittedAt=SYSDATETIME(), UpdatedAt=SYSDATETIME()
          WHERE Id=@id AND CreatedBy=@uid AND Status IN ('Draft','Returned');
         SELECT @@ROWCOUNT AS n`,
      );
    if ((claim.recordset[0].n as number) === 0) {
      throw new AccConflictError(SUBMIT_ALREADY_CLAIMED);
    }

    // 2. Take the stock. This is the only place a new hold is created.
    //    `moveHold` covers the resubmit cases — same reward with a different
    //    quantity, or a different reward entirely — and `takeStock` the first
    //    submit. Either way the request's own record of its hold is rewritten
    //    below, in the same transaction as the counter it describes.
    const held = alreadyHolding
      ? await moveHold(tx, { rewardId: heldRewardId, qty: heldQty }, rewardId, qty)
      : await takeStock(tx, rewardId, qty);
    if (!held) {
      throw new AccConflictError(
        `ของรางวัลคงเหลือไม่พอ — มีผู้ขอเบิกไปก่อนหน้านี้ กรุณาโหลดหน้านี้ใหม่`,
      );
    }
    await writeHold(tx, id, rewardId, qty);

    // 3. Number it, now that the row and the stock are both ours.
    const requestNo = await allocateRequestNo(RUNNING_PREFIX, new Date(), tx);
    await tx
      .request()
      .input("id", sql.Int, id)
      .input("no", sql.NVarChar, requestNo)
      .query(`UPDATE [dbo].[AccRequest] SET RequestNo=@no WHERE Id=@id`);

    // Freeze the reward's identity and value onto the request. A settings edit
    // six months from now must not rewrite what somebody was issued.
    await tx
      .request()
      .input("rid", sql.Int, id)
      .input("code", sql.NVarChar(50), reward.code)
      .input("name", sql.NVarChar(200), reward.name)
      .input("ua", sql.Decimal(18, 2), reward.unitActualValue)
      .input("ub", sql.Decimal(18, 2), reward.unitBookValue)
      .query(
        `UPDATE [dbo].[AccRewardRequest]
            SET RewardCode=@code, RewardName=@name,
                UnitActualValue=@ua, UnitBookValue=@ub, UpdatedAt=SYSDATETIME()
          WHERE RequestId=@rid`,
      );

    // Resubmit after a Return runs the chain again from scratch.
    await tx.request().input("id", sql.Int, id).query(`DELETE FROM [dbo].[AccApproval] WHERE RequestId=@id`);
    await tx
      .request()
      .input("id", sql.Int, id)
      .input("mgrStaff", sql.Int, emp.managerStaffId)
      .input("mgrEmail", sql.NVarChar, managerEmail)
      .query(
        `INSERT INTO [dbo].[AccApproval] (RequestId, StepCode, StepOrder, AssignedTo, AssignedEmail, Status)
         VALUES (@id, 'MANAGER', 1, @mgrStaff, @mgrEmail, 'Pending')`,
      );
    await tx
      .request()
      .input("id", sql.Int, id)
      .input("by", sql.Int, userId)
      .input("no", sql.NVarChar, requestNo)
      .query(
        `INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note)
         VALUES (@id, @by, 'submitted', @no)`,
      );

    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }

  const saved = await getRewardRequest(id);
  if (saved) {
    const mail = buildRewardEmail("Submitted", saved);
    await queueEmail({
      requestId: id,
      toEmail: managerEmail,
      subject: mail.subject,
      bodyHtml: mail.html,
      triggerType: "Submitted",
    });
    void processQueue().catch(() => {});
  }
  if (!saved) throw new Error("ส่งคำขอไม่สำเร็จ");
  return saved;
}

/** The quantity a request currently holds — used by the approval engine. */
export { readHeldStock };
