import { getAccPool, sql } from "@/lib/adv/pool";
import { hrEmployeeTable } from "@/lib/hr/constants";
import { allocateAdvanceRequestNo } from "@/lib/adv/adv-config";
import { listApproverEmailsByRole, isAdvanceApprover } from "@/lib/adv/advance-approver-service";
import { findTierForAmount, buildApprovalChain } from "@/lib/adv/advance-tier-service";
import { stepApproverRole, STEP_LABEL, type StepType } from "@/lib/adv/approval-steps";
import {
  resolveManagerEmail,
  resolveRequesterForActor,
  type RequesterSnapshot,
} from "@/lib/acc/employee-context";
import { queueEmail } from "@/lib/acc/email-queue";
import { buildAdvanceEmail } from "@/lib/adv/advance-email-templates";
import {
  AP2_FORM_CODE,
  AP2_SEQUENCE_PREFIX,
  AP2_DEFAULT_CURRENCY,
  AP2_MAX_CLEAR_DAYS,
  AP2_PRPO_THRESHOLD,
} from "@/features/advance/constants";
import type {
  AdvanceDetail,
  AdvanceDraftSummary,
  AdvanceRequest,
  AdvanceSaveInput,
} from "@/features/advance/types";

/* ─────────────────────────── helpers ─────────────────────────── */

function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

/** Date column → YYYY-MM-DD using local getters (server is Thai time). */
function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function mapRequestRow(r: Record<string, unknown>): AdvanceRequest {
  return {
    id: r.Id as number,
    requestNo: (r.RequestNo as string) ?? null,
    formCode: r.FormCode as string,
    brandCode: (r.BrandCode as string) ?? null,
    status: r.Status as AdvanceRequest["status"],
    currentStepCode: (r.CurrentStepCode as AdvanceRequest["currentStepCode"]) ?? null,
    staffId: (r.StaffId as number) ?? null,
    requesterFullName: (r.RequesterFullName as string) ?? null,
    requesterEmail: (r.RequesterEmail as string) ?? null,
    requesterPosition: (r.RequesterPosition as string) ?? null,
    requesterDepartmentName: (r.RequesterDepartmentName as string) ?? null,
    requesterDepartmentCode: (r.RequesterDepartmentCode as string) ?? null,
    managerStaffId: (r.ManagerStaffId as number) ?? null,
    managerEmail: (r.ManagerEmail as string) ?? null,
    companyName: (r.CompanyName as string) ?? null,
    totalAmount: num(r.TotalAmount),
    paymentDate: r.PaymentDate ? toYmd(r.PaymentDate as Date) : null,
    submittedBy: (r.SubmittedBy as number) ?? null,
    submittedAt: r.SubmittedAt ? (r.SubmittedAt as Date).toISOString() : null,
    createdAt: r.CreatedAt ? (r.CreatedAt as Date).toISOString() : "",
    updatedAt: r.UpdatedAt ? (r.UpdatedAt as Date).toISOString() : "",
  };
}

function mapAdvanceRow(r: Record<string, unknown>): AdvanceDetail {
  return {
    id: r.Id as number,
    payeeType: (r.PayeeType as AdvanceDetail["payeeType"]) ?? null,
    payeeName: (r.PayeeName as string) ?? null,
    payeeBankAccount: (r.PayeeBankAccount as string) ?? null,
    payeeBankCode: (r.PayeeBankCode as string) ?? null,
    matchedVendorNo: (r.MatchedVendorNo as string) ?? null,
    matchedVendorName: (r.MatchedVendorName as string) ?? null,
    vendorMatchStatus: (r.VendorMatchStatus as AdvanceDetail["vendorMatchStatus"]) ?? null,
    vendorMatchConfidence: (r.VendorMatchConfidence as AdvanceDetail["vendorMatchConfidence"]) ?? null,
    vendorMatchReason: (r.VendorMatchReason as string) ?? null,
    needByDate: r.NeedByDate ? toYmd(r.NeedByDate as Date) : null,
    expectedClearDate: r.ExpectedClearDate ? toYmd(r.ExpectedClearDate as Date) : null,
    purpose: (r.Purpose as string) ?? null,
    currency: (r.Currency as string) ?? AP2_DEFAULT_CURRENCY,
    amount: num(r.Amount),
    exchangeRate: num(r.ExchangeRate),
    baseAmount: num(r.BaseAmount),
    whtNote: (r.WhtNote as string) ?? null,
    overThresholdReason: (r.OverThresholdReason as string) ?? null,
  };
}

/** THB base = amount × rate (THB → rate 1). Used for the journal + header total. */
function computeBaseAmount(a: AdvanceDetail): number | null {
  if (a.amount == null) return null;
  const isThb = !a.currency || a.currency.toUpperCase() === AP2_DEFAULT_CURRENCY;
  const rate = isThb ? 1 : a.exchangeRate ?? 0;
  return Math.round(a.amount * rate * 100) / 100;
}

async function loadAdvance(
  pool: Awaited<ReturnType<typeof getAccPool>>,
  requestId: number,
): Promise<AdvanceDetail | null> {
  const r = await pool.request().input("rid", sql.Int, requestId)
    .query(`SELECT TOP 1 * FROM [dbo].[AccAdvance] WHERE RequestId = @rid`);
  if (r.recordset.length === 0) return null;
  return mapAdvanceRow(r.recordset[0] as Record<string, unknown>);
}

/* ─────────────────────────── reads ─────────────────────────── */

export async function getRequest(id: number): Promise<AdvanceRequest | null> {
  const pool = await getAccPool();
  const head = await pool.request().input("id", sql.Int, id)
    .query(`SELECT * FROM [dbo].[AccRequest] WHERE Id = @id`);
  if (head.recordset.length === 0) return null;
  const req = mapRequestRow(head.recordset[0] as Record<string, unknown>);

  const advance = await loadAdvance(pool, id);
  if (advance) req.advance = advance;

  const aRes = await pool.request().input("id", sql.Int, id)
    .query(`SELECT a.*,
              COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(e_action.FirstName, N' ', e_action.LastName))), N''), e_action.FullName) AS ActionedByHrName,
              COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(e_assign.FirstName, N' ', e_assign.LastName))), N''), e_assign.FullName) AS AssignedHrName
            FROM [dbo].[AccAdvanceApproval] a
            LEFT JOIN ${hrEmployeeTable()} e_action ON e_action.StaffId = a.ActionedByStaffId AND e_action.Status = N'Active'
            LEFT JOIN ${hrEmployeeTable()} e_assign ON e_assign.StaffId = a.AssignedStaffId AND e_assign.Status = N'Active'
            WHERE a.RequestId = @id
            ORDER BY a.StepOrder, a.Id`);
  req.approvals = (aRes.recordset as Record<string, unknown>[]).map((x) => {
    const stepType = x.StepType as StepType;
    return {
      id: x.Id as number,
      stepOrder: x.StepOrder as number,
      stepType,
      stepLabel: STEP_LABEL[stepType] ?? String(x.StepType),
      status: x.Status as string,
      comment: (x.Comment as string) ?? null,
      isChecked: x.IsChecked === null || x.IsChecked === undefined ? null : !!x.IsChecked,
      paymentDate: x.PaymentDate ? toYmd(x.PaymentDate as Date) : null,
      actionedByStaffId: (x.ActionedByStaffId as number) ?? null,
      actionedByName: (x.ActionedByHrName as string) ?? null,
      assignedName: (x.AssignedHrName as string) ?? null,
      actionedAt: x.ActionedAt ? (x.ActionedAt as Date).toISOString() : null,
    };
  });

  return req;
}

/** Editable advance drafts for the current user (by creator). */
export async function listMyAdvanceDrafts(userId: number): Promise<AdvanceDraftSummary[]> {
  const pool = await getAccPool();
  const res = await pool.request()
    .input("uid", sql.Int, userId)
    .input("form", sql.NVarChar, AP2_FORM_CODE)
    .query(`
      SELECT r.Id, r.BrandCode, r.Status, r.UpdatedAt,
             a.NeedByDate, a.ExpectedClearDate, a.Purpose, a.Amount
      FROM [dbo].[AccRequest] r
      LEFT JOIN [dbo].[AccAdvance] a ON a.RequestId = r.Id
      WHERE r.FormCode = @form
        AND r.Status IN ('Draft', 'Returned')
        AND (r.CreatedBy = @uid OR r.SubmittedBy = @uid)
      ORDER BY r.UpdatedAt DESC
    `);
  return (res.recordset as Record<string, unknown>[]).map((row) => ({
    id: row.Id as number,
    brandCode: (row.BrandCode as string) ?? null,
    status: row.Status as AdvanceDraftSummary["status"],
    needByDate: row.NeedByDate ? toYmd(row.NeedByDate as Date) : null,
    expectedClearDate: row.ExpectedClearDate ? toYmd(row.ExpectedClearDate as Date) : null,
    purpose: (row.Purpose as string) ?? null,
    amount: num(row.Amount),
    updatedAt: row.UpdatedAt ? (row.UpdatedAt as Date).toISOString() : "",
  }));
}

export interface AdvanceInboxRow {
  id: number;
  requestNo: string | null;
  brandCode: string | null;
  requesterFullName: string | null;
  totalAmount: number | null;
  status: string;
  currentStepCode: string | null;
  stepLabel: string;
  updatedAt: string;
}

/**
 * AP-2 requests (Submitted) whose CURRENT step this viewer can act on:
 *  - a role step (HEAD_ACC / DIRECTOR / ACC_OFFICER) they are an active approver of, or
 *  - the HEAD_DEPT step when they are the requester's manager.
 * Empty when neither applies.
 */
export async function listAdvanceApprovalInbox(
  email: string | null,
  staffId: number | null,
): Promise<AdvanceInboxRow[]> {
  const [isHead, isOfficer, isDirector] = await Promise.all([
    isAdvanceApprover(email, "HEAD_ACC"),
    isAdvanceApprover(email, "ACC_OFFICER"),
    isAdvanceApprover(email, "DIRECTOR"),
  ]);
  const roleSteps: string[] = [];
  if (isHead) roleSteps.push("HEAD_ACC");
  if (isOfficer) roleSteps.push("ACC_OFFICER");
  if (isDirector) roleSteps.push("DIRECTOR");
  if (roleSteps.length === 0 && staffId == null) return [];

  const conds: string[] = [];
  // roleSteps values are fixed constants (never user input) — safe to inline.
  if (roleSteps.length) conds.push(`r.CurrentStepCode IN ('${roleSteps.join("','")}')`);
  if (staffId != null) conds.push("(r.CurrentStepCode = 'HEAD_DEPT' AND r.ManagerStaffId = @staff)");

  const pool = await getAccPool();
  const res = await pool.request()
    .input("form", sql.NVarChar, AP2_FORM_CODE)
    .input("staff", sql.Int, staffId)
    .query(`
      SELECT r.Id, r.RequestNo, r.BrandCode, r.RequesterFullName, r.TotalAmount,
             r.Status, r.CurrentStepCode, r.UpdatedAt
      FROM [dbo].[AccRequest] r
      WHERE r.FormCode = @form AND r.Status = 'Submitted' AND (${conds.join(" OR ")})
      ORDER BY r.UpdatedAt DESC
    `);
  return (res.recordset as Record<string, unknown>[]).map((row) => {
    const step = (row.CurrentStepCode as StepType) ?? null;
    return {
      id: row.Id as number,
      requestNo: (row.RequestNo as string) ?? null,
      brandCode: (row.BrandCode as string) ?? null,
      requesterFullName: (row.RequesterFullName as string) ?? null,
      totalAmount: num(row.TotalAmount),
      status: row.Status as string,
      currentStepCode: (row.CurrentStepCode as string) ?? null,
      stepLabel: step ? STEP_LABEL[step] ?? String(step) : "",
      updatedAt: row.UpdatedAt ? (row.UpdatedAt as Date).toISOString() : "",
    };
  });
}

/* ─────────────────────────── validation ─────────────────────────── */

/** Strict checks run at submit time. Returns Thai error messages (empty = valid). */
export function validateAdvanceForSubmit(
  input: AdvanceSaveInput,
  requester: Pick<RequesterSnapshot, "managerStaffId">,
): string[] {
  const errs: string[] = [];
  const a = input.advance;
  // AP-2 has no line-manager step (approval is Head Accounting → Accounting
  // Officer), so an HR manager is not required to submit.
  if (!input.brandCode) errs.push("กรุณาเลือกแบรนด์");
  if (!a.needByDate) errs.push("กรุณาระบุวันที่ต้องการเริ่มใช้เงิน");
  if (!a.expectedClearDate) errs.push("กรุณาระบุวันที่คาดว่าจะเคลียร์");
  if (a.needByDate && a.expectedClearDate) {
    const need = new Date(a.needByDate);
    const clear = new Date(a.expectedClearDate);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (need < today) errs.push("วันที่ต้องการเริ่มใช้เงินต้องไม่เป็นอดีต");
    if (clear < need) errs.push("วันเคลียร์ต้องไม่ก่อนวันที่ต้องการใช้เงิน");
    const diffDays = (clear.getTime() - need.getTime()) / 86_400_000;
    if (diffDays > AP2_MAX_CLEAR_DAYS)
      errs.push(`วันเคลียร์ต้องไม่เกิน ${AP2_MAX_CLEAR_DAYS} วันจากวันที่ต้องการใช้เงิน`);
  }
  if (!a.purpose?.trim()) errs.push("กรุณากรอกรายละเอียดค่าใช้จ่าย");
  if (!a.amount || a.amount <= 0) errs.push("กรุณาระบุจำนวนเงินที่ถูกต้อง");

  // Payee (โอนให้)
  if (!a.payeeType) errs.push("กรุณาเลือกผู้รับโอน (โอนให้)");
  if (a.payeeType === "vendor") {
    if (!a.payeeName?.trim()) errs.push("กรุณากรอกชื่อคู่ค้า");
    if (!a.payeeBankAccount?.trim()) errs.push("กรุณากรอกเลขที่บัญชีคู่ค้า");
    if (!a.payeeBankCode?.trim()) errs.push("กรุณาเลือกธนาคารของคู่ค้า");
  }

  // Currency / FX — foreign currency needs a rate.
  const isThb = !a.currency || a.currency.toUpperCase() === AP2_DEFAULT_CURRENCY;
  if (!isThb && (!a.exchangeRate || a.exchangeRate <= 0))
    errs.push("กรุณาระบุอัตราแลกเปลี่ยน (สำหรับสกุลเงินต่างประเทศ)");

  // Business rule: over the threshold is allowed but must carry a reason.
  const base = computeBaseAmount(a);
  if (base && base > AP2_PRPO_THRESHOLD && !a.overThresholdReason?.trim())
    errs.push(`ยอดเกิน ${AP2_PRPO_THRESHOLD.toLocaleString()} บาท — กรุณาระบุเหตุผลเพิ่มเติม`);
  return errs;
}

/* ─────────────────────────── writes ─────────────────────────── */

async function persistAdvance(
  tx: Awaited<ReturnType<Awaited<ReturnType<typeof getAccPool>>["transaction"]>>,
  requestId: number,
  a: AdvanceDetail,
): Promise<void> {
  const isThb = !a.currency || a.currency.toUpperCase() === AP2_DEFAULT_CURRENCY;
  const rate = isThb ? 1 : a.exchangeRate ?? null;
  const baseAmount = computeBaseAmount(a);
  // Employee payee name defaults to nothing here; the form/HR supplies it.
  const reqBind = () =>
    tx.request()
      .input("rid", sql.Int, requestId)
      .input("payeeType", sql.NVarChar, a.payeeType ?? null)
      .input("payeeName", sql.NVarChar, a.payeeName ?? null)
      .input("bankAcct", sql.NVarChar, a.payeeBankAccount ?? null)
      .input("bankCode", sql.NVarChar, a.payeeBankCode ?? null)
      .input("needBy", sql.Date, a.needByDate || null)
      .input("clear", sql.Date, a.expectedClearDate || null)
      .input("purpose", sql.NVarChar, a.purpose ?? null)
      .input("currency", sql.NVarChar, a.currency || AP2_DEFAULT_CURRENCY)
      .input("amount", sql.Decimal(18, 2), a.amount ?? null)
      .input("rate", sql.Decimal(18, 6), rate)
      .input("base", sql.Decimal(18, 2), baseAmount)
      .input("wht", sql.NVarChar, a.whtNote ?? null)
      .input("overReason", sql.NVarChar, a.overThresholdReason ?? null);

  const exists = await tx.request().input("rid", sql.Int, requestId)
    .query(`SELECT TOP 1 Id FROM [dbo].[AccAdvance] WHERE RequestId = @rid`);

  if (exists.recordset.length > 0) {
    await reqBind().query(`
      UPDATE [dbo].[AccAdvance] SET
        PayeeType=@payeeType, PayeeName=@payeeName, PayeeBankAccount=@bankAcct, PayeeBankCode=@bankCode,
        NeedByDate=@needBy, ExpectedClearDate=@clear, Purpose=@purpose,
        Currency=@currency, Amount=@amount, ExchangeRate=@rate, BaseAmount=@base,
        WhtNote=@wht, OverThresholdReason=@overReason,
        MatchedVendorNo = CASE WHEN ISNULL(PayeeName,'') <> ISNULL(@payeeName,'') THEN NULL ELSE MatchedVendorNo END,
        MatchedVendorName = CASE WHEN ISNULL(PayeeName,'') <> ISNULL(@payeeName,'') THEN NULL ELSE MatchedVendorName END,
        VendorMatchConfidence = CASE WHEN ISNULL(PayeeName,'') <> ISNULL(@payeeName,'') THEN NULL ELSE VendorMatchConfidence END,
        VendorMatchReason = CASE WHEN ISNULL(PayeeName,'') <> ISNULL(@payeeName,'') THEN NULL ELSE VendorMatchReason END,
        VendorMatchStatus = CASE WHEN ISNULL(PayeeName,'') <> ISNULL(@payeeName,'') THEN 'pending' ELSE VendorMatchStatus END,
        UpdatedAt=SYSDATETIME()
      WHERE RequestId=@rid`);
  } else {
    await reqBind().query(`
      INSERT INTO [dbo].[AccAdvance]
        (RequestId, PayeeType, PayeeName, PayeeBankAccount, PayeeBankCode,
         NeedByDate, ExpectedClearDate, Purpose, Currency, Amount, ExchangeRate, BaseAmount, WhtNote, OverThresholdReason)
      VALUES (@rid, @payeeType, @payeeName, @bankAcct, @bankCode,
         @needBy, @clear, @purpose, @currency, @amount, @rate, @base, @wht, @overReason)`);
  }

  // Header total is the THB base amount (what the journal posts).
  await tx.request()
    .input("rid", sql.Int, requestId)
    .input("total", sql.Decimal(18, 2), baseAmount)
    .query(`UPDATE [dbo].[AccRequest] SET TotalAmount=@total, UpdatedAt=SYSDATETIME() WHERE Id=@rid`);
}

/** Create or update a draft (lenient — no strict validation). Returns the request id. */
export async function saveDraft(
  input: AdvanceSaveInput,
  userId: number,
  loginEmail: string,
): Promise<number> {
  const pool = await getAccPool();
  // The form supplies the employee code (staffId); self by default, a same-department
  // colleague when different (resolveRequesterForActor enforces that authorization).
  const requester = await resolveRequesterForActor(loginEmail, input.staffId ?? null);
  const tx = pool.transaction();
  await tx.begin();
  try {
    let requestId = input.id ?? 0;

    if (!requestId) {
      const ins = await tx.request()
        .input("brand", sql.NVarChar, input.brandCode ?? null)
        .input("user", sql.Int, userId || null)
        .input("form", sql.NVarChar, AP2_FORM_CODE)
        .input("empId", sql.UniqueIdentifier, requester.employeeId)
        .input("staffId", sql.Int, requester.staffId)
        .input("rFirst", sql.NVarChar, requester.firstName)
        .input("rLast", sql.NVarChar, requester.lastName)
        .input("rFull", sql.NVarChar, requester.fullName)
        .input("rEmail", sql.NVarChar, requester.email)
        .input("rPos", sql.NVarChar, requester.position)
        .input("rDeptId", sql.Int, requester.departmentId)
        .input("rDeptName", sql.NVarChar, requester.departmentName)
        .input("rDeptCode", sql.NVarChar, requester.departmentCode)
        .input("mgrStaff", sql.Int, requester.managerStaffId)
        .query(`INSERT INTO [dbo].[AccRequest]
                  (FormCode, BrandCode, Status, CreatedBy,
                   EmployeeId, StaffId, RequesterFirstName, RequesterLastName, RequesterFullName,
                   RequesterEmail, RequesterPosition, RequesterDepartmentId, RequesterDepartmentName,
                   RequesterDepartmentCode, ManagerStaffId)
                OUTPUT inserted.Id AS Id
                VALUES (@form, @brand, 'Draft', @user,
                   @empId, @staffId, @rFirst, @rLast, @rFull,
                   @rEmail, @rPos, @rDeptId, @rDeptName, @rDeptCode, @mgrStaff)`);
      requestId = ins.recordset[0].Id as number;
    } else {
      const own = await tx.request().input("id", sql.Int, requestId)
        .query(`SELECT CreatedBy, Status FROM [dbo].[AccRequest] WHERE Id=@id`);
      if (own.recordset.length === 0) throw new Error("ไม่พบคำขอ");
      const ownerRow = own.recordset[0] as { CreatedBy: number | null; Status: string };
      if (ownerRow.CreatedBy !== userId) throw new Error("ไม่มีสิทธิ์แก้ไขคำขอนี้");
      if (ownerRow.Status !== "Draft" && ownerRow.Status !== "Returned") {
        throw new Error("คำขอนี้ไม่สามารถแก้ไขได้ในสถานะปัจจุบัน");
      }
      await tx.request()
        .input("id", sql.Int, requestId)
        .input("brand", sql.NVarChar, input.brandCode ?? null)
        .input("empId", sql.UniqueIdentifier, requester.employeeId)
        .input("staffId", sql.Int, requester.staffId)
        .input("rFirst", sql.NVarChar, requester.firstName)
        .input("rLast", sql.NVarChar, requester.lastName)
        .input("rFull", sql.NVarChar, requester.fullName)
        .input("rEmail", sql.NVarChar, requester.email)
        .input("rPos", sql.NVarChar, requester.position)
        .input("rDeptId", sql.Int, requester.departmentId)
        .input("rDeptName", sql.NVarChar, requester.departmentName)
        .input("rDeptCode", sql.NVarChar, requester.departmentCode)
        .input("mgrStaff", sql.Int, requester.managerStaffId)
        .query(`UPDATE [dbo].[AccRequest] SET BrandCode=@brand,
                  EmployeeId=@empId, StaffId=@staffId,
                  RequesterFirstName=@rFirst, RequesterLastName=@rLast, RequesterFullName=@rFull,
                  RequesterEmail=@rEmail, RequesterPosition=@rPos,
                  RequesterDepartmentId=@rDeptId, RequesterDepartmentName=@rDeptName,
                  RequesterDepartmentCode=@rDeptCode, ManagerStaffId=@mgrStaff,
                  UpdatedAt=SYSDATETIME() WHERE Id=@id`);
    }

    const advance = input.advance.payeeType === "employee"
      ? { ...input.advance, payeeName: requester.fullName ?? input.advance.payeeName }
      : input.advance;
    await persistAdvance(tx, requestId, advance);

    await tx.commit();
    return requestId;
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

/** Permanently delete an editable draft (Draft/Returned) owned by the user. */
export async function deleteDraft(id: number, userId: number): Promise<void> {
  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const own = await tx.request().input("id", sql.Int, id)
      .query(`SELECT CreatedBy, Status FROM [dbo].[AccRequest] WHERE Id=@id`);
    if (own.recordset.length === 0) throw new Error("ไม่พบคำขอ");
    const row = own.recordset[0] as { CreatedBy: number | null; Status: string };
    if (row.CreatedBy !== userId) throw new Error("ไม่มีสิทธิ์ลบคำขอนี้");
    if (row.Status !== "Draft" && row.Status !== "Returned") {
      throw new Error("คำขอนี้ไม่สามารถลบได้ในสถานะปัจจุบัน");
    }
    // Child rows first (FK order): attachments, AP-2's own approval, activity,
    // detail, then the header. AP-2 uses AccAdvanceApproval (not AccApproval),
    // and AccRequestFile must go before AccRequest or its FK blocks the delete.
    await tx.request().input("id", sql.Int, id).query(`DELETE FROM [dbo].[AccRequestFile] WHERE RequestId=@id`);
    await tx.request().input("id", sql.Int, id).query(`DELETE FROM [dbo].[AccAdvanceApproval] WHERE RequestId=@id`);
    await tx.request().input("id", sql.Int, id).query(`DELETE FROM [dbo].[AccActivityLog] WHERE RequestId=@id`);
    await tx.request().input("id", sql.Int, id).query(`DELETE FROM [dbo].[AccAdvance] WHERE RequestId=@id`);
    await tx.request().input("id", sql.Int, id).query(`DELETE FROM [dbo].[AccRequest] WHERE Id=@id`);
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

/**
 * Validate, allocate the running no., flip the header to Submitted/MANAGER,
 * create the MANAGER approval and queue the manager email. One transaction.
 */
export async function submitRequest(
  id: number,
  requester: RequesterSnapshot,
  userId: number,
): Promise<AdvanceRequest> {
  const current = await getRequest(id);
  if (!current) throw new Error("ไม่พบคำขอ");
  if (current.status !== "Draft" && current.status !== "Returned") {
    throw new Error("คำขอนี้ถูกส่งไปแล้ว");
  }

  const advance = current.advance ?? {
    payeeType: null, payeeName: null, payeeBankAccount: null, payeeBankCode: null,
    matchedVendorNo: null, matchedVendorName: null, vendorMatchStatus: null,
    vendorMatchConfidence: null, vendorMatchReason: null,
    needByDate: null, expectedClearDate: null, purpose: null,
    currency: AP2_DEFAULT_CURRENCY, amount: null, exchangeRate: null, baseAmount: null, whtNote: null,
    overThresholdReason: null,
  };
  const errors = validateAdvanceForSubmit(
    { id, brandCode: current.brandCode, staffId: current.staffId, advance },
    { managerStaffId: requester.managerStaffId ?? null },
  );
  if (errors.length) throw new Error(errors.join("\n"));

  const requestNo = await allocateAdvanceRequestNo(AP2_SEQUENCE_PREFIX);
  const totalAmount = computeBaseAmount(advance) ?? 0;

  // The amount matrix decides the approval chain for this request.
  const tier = await findTierForAmount(totalAmount);
  const steps: StepType[] = tier && tier.steps.length ? tier.steps : ["HEAD_DEPT", "ACC_OFFICER"];
  const firstStep = steps[0];

  // The department-head step routes to the requester's manager.
  const managerEmail = await resolveManagerEmail(requester.managerStaffId);
  if (steps.includes("HEAD_DEPT") && !requester.managerStaffId) {
    throw new Error("ไม่พบหัวหน้าแผนกของผู้ขอ (ManagerStaffId) — ไม่สามารถส่งอนุมัติได้");
  }
  // Every role-based step must have at least one active approver, or it stalls.
  for (const st of steps) {
    const role = stepApproverRole(st);
    if (role && (await listApproverEmailsByRole(role)).length === 0) {
      throw new Error(`ยังไม่ได้กำหนดผู้อนุมัติระดับ ${STEP_LABEL[st]} — ตั้งที่ ตั้งค่า AP-2 › ผู้อนุมัติ`);
    }
  }

  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    await tx.request()
      .input("id", sql.Int, id)
      .input("no", sql.NVarChar, requestNo)
      .input("empId", sql.UniqueIdentifier, requester.employeeId ?? null)
      .input("staffId", sql.Int, requester.staffId ?? null)
      .input("fname", sql.NVarChar, requester.firstName ?? null)
      .input("lname", sql.NVarChar, requester.lastName ?? null)
      .input("full", sql.NVarChar, requester.fullName ?? null)
      .input("email", sql.NVarChar, requester.email ?? null)
      .input("pos", sql.NVarChar, requester.position ?? null)
      .input("deptId", sql.Int, requester.departmentId ?? null)
      .input("deptName", sql.NVarChar, requester.departmentName ?? null)
      .input("deptCode", sql.NVarChar, requester.departmentCode ?? null)
      .input("mgrStaff", sql.Int, requester.managerStaffId ?? null)
      .input("mgrEmail", sql.NVarChar, managerEmail)
      .input("company", sql.NVarChar, requester.companyName ?? null)
      .input("total", sql.Decimal(18, 2), totalAmount)
      .input("step", sql.NVarChar, firstStep)
      .input("by", sql.Int, userId || null)
      .query(`UPDATE [dbo].[AccRequest] SET
        RequestNo=@no, Status='Submitted', CurrentStepCode=@step,
        EmployeeId=@empId, StaffId=@staffId, RequesterFirstName=@fname, RequesterLastName=@lname,
        RequesterFullName=@full, RequesterEmail=@email, RequesterPosition=@pos,
        RequesterDepartmentId=@deptId, RequesterDepartmentName=@deptName, RequesterDepartmentCode=@deptCode,
        ManagerStaffId=@mgrStaff, ManagerEmail=@mgrEmail, CompanyName=@company,
        TotalAmount=@total, SubmittedBy=@by, SubmittedAt=SYSDATETIME(), UpdatedAt=SYSDATETIME()
        WHERE Id=@id`);

    // Pin payeeName to HR fullName for employee-type advances (consistent with saveDraft).
    if (advance.payeeType === "employee" && requester.fullName) {
      await tx.request()
        .input("id", sql.Int, id)
        .input("name", sql.NVarChar, requester.fullName)
        .query(`UPDATE [dbo].[AccAdvance] SET PayeeName=@name WHERE RequestId=@id AND (PayeeType='employee' OR PayeeType IS NULL)`);
    }

    // Rebuild AP-2's own approval chain from the matrix (idempotent on resubmit).
    await tx.request().input("id", sql.Int, id)
      .query(`DELETE FROM [dbo].[AccAdvanceApproval] WHERE RequestId=@id`);
    await buildApprovalChain(tx, id, steps, requester.managerStaffId ?? null, managerEmail);

    await tx.request().input("id", sql.Int, id).input("by", sql.Int, userId || null)
      .input("no", sql.NVarChar, requestNo)
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note)
              VALUES (@id, @by, 'submitted', @no)`);

    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }

  const updated = await getRequest(id);
  if (updated) {
    const firstRole = stepApproverRole(firstStep);
    const notifyEmails = firstRole
      ? await listApproverEmailsByRole(firstRole)
      : managerEmail ? [managerEmail] : [];
    const { subject, html: bodyHtml } = buildAdvanceEmail("Submitted", {
      id,
      requestNo,
      requesterFullName: updated.requesterFullName,
      brandCode: updated.brandCode,
      payeeName: updated.advance?.payeeName,
      totalAmount: updated.totalAmount,
      paymentDate: updated.paymentDate,
      stepLabel: STEP_LABEL[firstStep],
    });
    for (const toEmail of notifyEmails) {
      await queueEmail({ requestId: id, toEmail, subject, bodyHtml, triggerType: "Submitted" });
    }
  }
  return updated!;
}
