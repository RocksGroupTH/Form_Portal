/**
 * AP-4 — Staff Reimbursement. Draft / resume / submit, modeled on
 * `src/lib/acc/request-service.ts` (AP-1). Three pieces are copied from there
 * verbatim rather than reinvented — see the comments at each: the submit
 * claim (a returned request keeps its running number), allocating the number
 * inside the claim's transaction, and the manager snapshot going through
 * `resolveRequesterForActor`'s `withUatManager` path.
 *
 * Two differences from AP-1 worth flagging up front:
 *
 * 1. `saveReimburseDraft`/`submitReimburseRequest` take only `userId`, not a
 *    login email or a pre-resolved requester — this module resolves everything
 *    itself from `userId` via `TeamMember.Id -> Email -> HR`. AP-4 does now
 *    have on-behalf submission (added 2026-08-24; the spec's §5.2 fields 1–2
 *    predate it), but it arrives as `SaveInput.requesterStaffId` rather than as
 *    a second function argument, so the shape here did not change.
 *
 *    The asymmetry that follows is the thing to hold on to: the **save** takes
 *    the requester from the payload, and the **submit** takes it from the row
 *    it already read (`current.staffId`), because the submit accepts no payload
 *    at all. Passing null in either place quietly re-points the claim at the
 *    actor and at the actor's manager.
 *
 * 2. Item money is validated in two layers, not one, and both of them live in
 *    `./item-money.ts` — a module with no runtime imports, so the rules that
 *    decide what reaches a payout figure are unit-testable without a database.
 *    See that file's header.
 */
import { getAccPool, sql } from "@/lib/acc/pool";
import { hrEmployeeTable } from "@/lib/hr/constants";
import { findById } from "@/lib/team-member/service";
import { allocateRequestNo } from "@/lib/acc/sequence";
import { resolveManagerEmail, resolveRequesterForActor } from "@/lib/acc/employee-context";
import {
  assertFormWritable,
  isUatRequest,
  UAT_MANAGER_MISSING_ERROR,
} from "@/lib/uat-tester/guards";
import { queueEmail } from "@/lib/acc/email-queue";
import { esc } from "@/lib/acc/email-templates";
import { AccConflictError, SUBMIT_ALREADY_CLAIMED } from "@/lib/acc/request-errors";
import { env } from "@/env";
import { sumReimburseItems } from "./calc";
import { prepareReimburseItemsForSave, validateItemMoney } from "./item-money";
import { listActiveRules } from "./settings-service";
import {
  AP4_FORM_CODE,
  AP4_RUNNING_PREFIX,
  REIMBURSE_FILE_REFTYPES,
  isPurposeGiven,
  PURPOSE_REQUIRED,
} from "@/features/reimburse/constants";
import type {
  ReimburseApproval,
  ReimburseDetail,
  ReimburseFileMeta,
  ReimburseItem,
  SaveInput,
} from "@/features/reimburse/types";

/* ─────────────────────────── helpers ─────────────────────────── */

function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

/** Date column → YYYY-MM-DD using local getters (server is Thai time). */
function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type AccPool = Awaited<ReturnType<typeof getAccPool>>;
type AccTx = { request: () => ReturnType<AccPool["request"]> };

/**
 * `userId` is `TeamMember.Id` (what the session carries and `CreatedBy`
 * stores), not an email — resolve the login email it maps to so
 * `resolveRequesterForActor` (which needs an email, and is what AP-1's
 * `withUatManager` path hangs off) can run.
 */
async function requireLoginEmail(userId: number): Promise<string> {
  const member = await findById(userId);
  if (!member?.email) throw new Error("ไม่พบข้อมูลผู้ใช้งาน — กรุณาเข้าสู่ระบบใหม่อีกครั้ง");
  return member.email;
}

/* ─────────────────────────── row mapping ─────────────────────────── */

function mapItemRow(x: Record<string, unknown>): ReimburseItem {
  return {
    id: x.Id as number,
    sortOrder: (x.SortOrder as number) ?? 0,
    expenseDate: x.ExpenseDate ? toYmd(x.ExpenseDate as Date) : null,
    documentNo: (x.DocumentNo as string) ?? null,
    category: (x.Category as string) ?? null,
    branchName: (x.BranchName as string) ?? null,
    vendorTaxId: (x.VendorTaxId as string) ?? null,
    vendorName: (x.VendorName as string) ?? null,
    vendorAddress: (x.VendorAddress as string) ?? null,
    description: (x.Description as string) ?? "",
    amount: Number(x.Amount) || 0,
    vatAmount: num(x.VatAmount),
    whtAmount: num(x.WhtAmount),
  };
}

function mapFileRow(x: Record<string, unknown>): ReimburseFileMeta {
  return {
    id: x.Id as number,
    fileName: x.FileName as string,
    fileSize: (x.FileSize as number) ?? null,
    contentType: (x.ContentType as string) ?? null,
    // AccRequestFile is a shared table, but the URL is not: `ROUTE_RULES`
    // classifies by path prefix, so `/api/request/accounting/**` resolves
    // **AP-1's** environment. With AP-4 piloted in UAT and AP-1 in Production
    // that opens the wrong database and the attachment is not there. AP-4's own
    // route authorizes on the file's parent request, pinned to AP-4.
    url: `/api/request/reimburse/files/${x.Id as number}`,
  };
}

function mapReimburseRow(
  row: Record<string, unknown>,
  items: ReimburseItem[],
  ackedRuleIds: number[],
  excelFile: ReimburseFileMeta | null,
  receiptFiles: ReimburseFileMeta[],
): ReimburseDetail {
  return {
    id: row.Id as number,
    requestNo: (row.RequestNo as string) ?? null,
    formCode: row.FormCode as string,
    brandCode: (row.BrandCode as string) ?? null,
    status: row.Status as ReimburseDetail["status"],
    currentStepCode: (row.CurrentStepCode as ReimburseDetail["currentStepCode"]) ?? null,
    staffId: (row.StaffId as number) ?? null,
    requesterFullName: (row.RequesterFullName as string) ?? null,
    requesterEmail: (row.RequesterEmail as string) ?? null,
    requesterPosition: (row.RequesterPosition as string) ?? null,
    requesterDepartmentName: (row.RequesterDepartmentName as string) ?? null,
    managerStaffId: (row.ManagerStaffId as number) ?? null,
    managerEmail: (row.ManagerEmail as string) ?? null,
    companyName: (row.CompanyName as string) ?? null,
    purpose: (row.Purpose as string) ?? null,
    totalAmount: num(row.TotalAmount),
    paymentDate: row.PaymentDate ? toYmd(row.PaymentDate as Date) : null,
    submittedBy: (row.SubmittedBy as number) ?? null,
    submittedAt: row.SubmittedAt ? (row.SubmittedAt as Date).toISOString() : null,
    createdAt: row.CreatedAt ? (row.CreatedAt as Date).toISOString() : "",
    updatedAt: row.UpdatedAt ? (row.UpdatedAt as Date).toISOString() : "",
    items,
    ackedRuleIds,
    excelFile,
    receiptFiles,
  };
}

async function loadItems(pool: AccPool, requestId: number): Promise<ReimburseItem[]> {
  const r = await pool
    .request()
    .input("rid", sql.Int, requestId)
    .query(
      `SELECT Id, SortOrder, ExpenseDate, DocumentNo, Category, BranchName, VendorTaxId, VendorName, VendorAddress,
              Description, Amount, VatAmount, WhtAmount
       FROM [dbo].[AccReimburseItem] WHERE RequestId=@rid ORDER BY SortOrder, Id`,
    );
  return (r.recordset as Record<string, unknown>[]).map(mapItemRow);
}

async function loadAckedRuleIds(pool: AccPool, requestId: number): Promise<number[]> {
  const r = await pool
    .request()
    .input("rid", sql.Int, requestId)
    .query(`SELECT RuleId FROM [dbo].[AccReimburseRuleAck] WHERE RequestId=@rid ORDER BY RuleId`);
  return (r.recordset as { RuleId: number }[]).map((x) => x.RuleId);
}

async function loadAttachments(
  pool: AccPool,
  requestId: number,
  excelFileId: number | null,
): Promise<{ excelFile: ReimburseFileMeta | null; receiptFiles: ReimburseFileMeta[] }> {
  const r = await pool
    .request()
    .input("rid", sql.Int, requestId)
    .input("t", sql.NVarChar, REIMBURSE_FILE_REFTYPES.RECEIPT)
    .query(
      `SELECT Id, FileName, FileSize, ContentType
       FROM [dbo].[AccRequestFile] WHERE RequestId=@rid AND RefType=@t ORDER BY Id`,
    );
  const receiptFiles = (r.recordset as Record<string, unknown>[]).map(mapFileRow);

  let excelFile: ReimburseFileMeta | null = null;
  if (excelFileId) {
    // Scoped to this request, not just to the file id. `AccReimburse.ExcelFileId`
    // is a plain int with no guarantee it still points at a file belonging here:
    // a stale or foreign id would otherwise render another request's filename
    // and — worse — satisfy the `!current.excelFile` submit gate, letting a
    // request with no workbook of its own pass the check that exists to demand one.
    const er = await pool
      .request()
      .input("id", sql.Int, excelFileId)
      .input("rid", sql.Int, requestId)
      .query(
        `SELECT Id, FileName, FileSize, ContentType
         FROM [dbo].[AccRequestFile] WHERE Id=@id AND RequestId=@rid`,
      );
    const row = er.recordset[0] as Record<string, unknown> | undefined;
    if (row) excelFile = mapFileRow(row);
  }
  return { excelFile, receiptFiles };
}

async function loadApprovals(pool: AccPool, requestId: number): Promise<ReimburseApproval[]> {
  const r = await pool.request().input("id", sql.Int, requestId).query(`
    SELECT a.*,
      COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(e_action.FirstName, N' ', e_action.LastName))), N''), e_action.FullName) AS ActionedByHrName,
      COALESCE(e_action.Email, e_action.EmailCompBr) AS ActionedByHrEmail,
      COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(e_assign.FirstName, N' ', e_assign.LastName))), N''), e_assign.FullName) AS AssignedToHrName,
      COALESCE(e_assign.Email, e_assign.EmailCompBr) AS AssignedToHrEmail
    FROM [dbo].[AccApproval] a
    LEFT JOIN ${hrEmployeeTable()} e_action ON e_action.StaffId = a.ActionedByStaffId AND e_action.Status = N'Active'
    LEFT JOIN ${hrEmployeeTable()} e_assign ON e_assign.StaffId = a.AssignedTo AND e_assign.Status = N'Active'
    WHERE a.RequestId = @id
    ORDER BY a.StepOrder, a.Id`);
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    id: x.Id as number,
    requestId: x.RequestId as number,
    stepCode: x.StepCode as ReimburseApproval["stepCode"],
    stepOrder: x.StepOrder as number,
    assignedTo: (x.AssignedTo as number) ?? null,
    assignedEmail: (x.AssignedEmail as string) ?? null,
    status: x.Status as ReimburseApproval["status"],
    comment: (x.Comment as string) ?? null,
    isChecked: x.IsChecked === null || x.IsChecked === undefined ? null : !!x.IsChecked,
    actionedByStaffId: (x.ActionedByStaffId as number) ?? null,
    actionedAt: x.ActionedAt ? (x.ActionedAt as Date).toISOString() : null,
    createdAt: x.CreatedAt ? (x.CreatedAt as Date).toISOString() : "",
    actionedByHrName: (x.ActionedByHrName as string) ?? null,
    actionedByHrEmail: (x.ActionedByHrEmail as string) ?? null,
    assignedToHrName: (x.AssignedToHrName as string) ?? null,
    assignedToHrEmail: (x.AssignedToHrEmail as string) ?? null,
  }));
}

/* ─────────────────────────── reads ─────────────────────────── */

/** Full request: header + items (ordered by SortOrder) + acked rule ids + attachments + approvals. */
export async function getReimburseRequest(id: number): Promise<ReimburseDetail | null> {
  const pool = await getAccPool();
  const headRes = await pool
    .request()
    .input("id", sql.Int, id)
    .input("form", sql.NVarChar, AP4_FORM_CODE)
    .query(
      `SELECT r.*, x.Purpose, x.ExcelFileId, x.RulesAcceptedAt
       FROM [dbo].[AccRequest] r
       INNER JOIN [dbo].[AccReimburse] x ON x.RequestId = r.Id
       WHERE r.Id = @id AND r.FormCode = @form`,
    );
  if (headRes.recordset.length === 0) return null;
  const row = headRes.recordset[0] as Record<string, unknown>;

  const [items, ackedRuleIds, attachments, approvals] = await Promise.all([
    loadItems(pool, id),
    loadAckedRuleIds(pool, id),
    loadAttachments(pool, id, (row.ExcelFileId as number) ?? null),
    loadApprovals(pool, id),
  ]);

  const detail = mapReimburseRow(row, items, ackedRuleIds, attachments.excelFile, attachments.receiptFiles);
  detail.approvals = approvals;
  return detail;
}

/* ─────────────────────── writes: the workbook pointer ─────────────────────── */

/**
 * Point `AccReimburse.ExcelFileId` at `fileId`, or clear it with `null`.
 *
 * This column is AP-4's unconditional submit gate: `validateReimburseForSubmit`
 * refuses without a workbook, and `loadAttachments` re-checks that the id still
 * names a file belonging to this request. It is deliberately **not** a foreign
 * key (migration 088) — swapping the workbook deletes the old `AccRequestFile`
 * row, which a FK would either block or cascade into the request.
 *
 * That makes it a rule every future writer of `AccRequestFile` has to know, so
 * it lives here rather than as two `UPDATE`s inside the route handlers that
 * happened to need it (upload and delete).
 *
 * `onlyIfCurrentFileId` makes the write conditional. The delete route clears the
 * pointer only while it still names the file being removed, so deleting a
 * superseded workbook cannot un-point the one that replaced it.
 */
export async function setReimburseWorkbook(
  requestId: number,
  fileId: number | null,
  opts?: { onlyIfCurrentFileId?: number },
): Promise<void> {
  const pool = await getAccPool();
  const req = pool.request().input("rid", sql.Int, requestId).input("fid", sql.Int, fileId);
  let guard = "";
  if (opts?.onlyIfCurrentFileId !== undefined) {
    req.input("cur", sql.Int, opts.onlyIfCurrentFileId);
    guard = " AND ExcelFileId = @cur";
  }
  await req.query(`UPDATE [dbo].[AccReimburse] SET ExcelFileId = @fid WHERE RequestId = @rid${guard}`);
}

/* ─────────────────────────── writes: draft / resume ─────────────────────────── */

/** Wholesale replace: delete then insert. The grid has no stable client-side row identity, so a diff would be more code with more ways to be wrong. Callers must pass already-`prepareReimburseItemsForSave`d items. */
async function persistReimburseItems(tx: AccTx, requestId: number, items: ReimburseItem[]): Promise<void> {
  await tx.request().input("rid", sql.Int, requestId).query(`DELETE FROM [dbo].[AccReimburseItem] WHERE RequestId=@rid`);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    await tx
      .request()
      .input("rid", sql.Int, requestId)
      .input("sort", sql.Int, it.sortOrder ?? i)
      .input("date", sql.Date, it.expenseDate)
      .input("docNo", sql.NVarChar(100), it.documentNo ?? null)
      .input("category", sql.NVarChar(50), it.category ?? null)
      .input("branch", sql.NVarChar(200), it.branchName ?? null)
      .input("taxId", sql.NVarChar(20), it.vendorTaxId ?? null)
      .input("vendorName", sql.NVarChar(300), it.vendorName ?? null)
      .input("vendorAddr", sql.NVarChar(500), it.vendorAddress ?? null)
      .input("desc", sql.NVarChar(500), it.description ?? "")
      .input("amount", sql.Decimal(18, 2), it.amount)
      .input("vat", sql.Decimal(18, 2), it.vatAmount ?? null)
      .input("wht", sql.Decimal(18, 2), it.whtAmount ?? null)
      .query(
        `INSERT INTO [dbo].[AccReimburseItem]
           (RequestId, SortOrder, ExpenseDate, DocumentNo, Category, BranchName,
            VendorTaxId, VendorName, VendorAddress, Description, Amount, VatAmount, WhtAmount)
         VALUES (@rid, @sort, @date, @docNo, @category, @branch,
                 @taxId, @vendorName, @vendorAddr, @desc, @amount, @vat, @wht)`,
      );
  }
}

/** Wholesale replace of which rules this request has ticked, and the "when ticked" timestamp that goes with it. */
async function persistRuleAcks(tx: AccTx, requestId: number, ruleIds: number[]): Promise<void> {
  await tx.request().input("rid", sql.Int, requestId).query(`DELETE FROM [dbo].[AccReimburseRuleAck] WHERE RequestId=@rid`);
  const unique = Array.from(new Set(ruleIds.filter((n) => Number.isFinite(n) && n > 0)));
  for (const ruleId of unique) {
    await tx
      .request()
      .input("rid", sql.Int, requestId)
      .input("ruleId", sql.Int, ruleId)
      .query(`INSERT INTO [dbo].[AccReimburseRuleAck] (RequestId, RuleId) VALUES (@rid, @ruleId)`);
  }
  // RulesAcceptedAt reflects the current tick state truthfully: set when at
  // least one rule is ticked, cleared back to null if the save leaves none
  // ticked (e.g. the requester unticked everything before saving again).
  await tx
    .request()
    .input("rid", sql.Int, requestId)
    .input("acceptedAt", sql.DateTime2, unique.length > 0 ? new Date() : null)
    .query(`UPDATE [dbo].[AccReimburse] SET RulesAcceptedAt=@acceptedAt WHERE RequestId=@rid`);
}

/**
 * Create or update a draft. Lenient about completeness — a missing brand,
 * missing files and an unticked rule are all fine here and caught only at
 * submit — but not about an item row, which `prepareReimburseItemsForSave`
 * either drops (only when entirely empty) or refuses by name: a row the
 * requester filled in must carry a date and a well-formed amount, or the save
 * fails rather than persisting less money than was entered. See
 * `./item-money.ts` for why neither can wait for submit. Upserts `AccRequest`
 * (FormCode `AP-4`) and `AccReimburse`, and replaces `AccReimburseItem` /
 * `AccReimburseRuleAck` wholesale, inside one transaction. Returns the request id.
 */
export async function saveReimburseDraft(input: SaveInput, userId: number): Promise<number> {
  await assertFormWritable();

  const loginEmail = await requireLoginEmail(userId);
  // On-behalf: the requester columns and `ManagerStaffId` below are stamped
  // from the chosen colleague, while `CreatedBy` stays the actor — which is
  // what keeps the draft in the actor's own list and readable by both.
  const requester = await resolveRequesterForActor(loginEmail, input.requesterStaffId ?? null);

  const items = prepareReimburseItemsForSave(input.items ?? []);
  const totalAmount = sumReimburseItems(items);

  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    let requestId = input.id ?? 0;

    if (!requestId) {
      const ins = await tx
        .request()
        .input("form", sql.NVarChar, AP4_FORM_CODE)
        .input("brand", sql.NVarChar, input.brandCode ?? null)
        .input("user", sql.Int, userId || null)
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
        // TotalAmount is written on the insert as well as the update: every
        // list surface reads AccRequest.TotalAmount, and omitting it here left
        // a brand-new draft showing a null total until it happened to be saved
        // a second time.
        .input("total", sql.Decimal(18, 2), totalAmount)
        .query(
          `INSERT INTO [dbo].[AccRequest]
             (FormCode, BrandCode, Status, CreatedBy,
              EmployeeId, StaffId, RequesterFirstName, RequesterLastName, RequesterFullName,
              RequesterEmail, RequesterPosition, RequesterDepartmentId, RequesterDepartmentName,
              RequesterDepartmentCode, ManagerStaffId, TotalAmount)
           OUTPUT inserted.Id AS Id
           VALUES (@form, @brand, 'Draft', @user,
              @empId, @staffId, @rFirst, @rLast, @rFull,
              @rEmail, @rPos, @rDeptId, @rDeptName, @rDeptCode, @mgrStaff, @total)`,
        );
      requestId = ins.recordset[0].Id as number;

      await tx
        .request()
        .input("rid", sql.Int, requestId)
        .input("purpose", sql.NVarChar(500), input.purpose ?? null)
        .input("total", sql.Decimal(18, 2), totalAmount)
        .query(`INSERT INTO [dbo].[AccReimburse] (RequestId, Purpose, TotalAmount) VALUES (@rid, @purpose, @total)`);
    } else {
      const own = await tx
        .request()
        .input("id", sql.Int, requestId)
        .query(`SELECT CreatedBy, Status, FormCode FROM [dbo].[AccRequest] WHERE Id=@id`);
      if (own.recordset.length === 0) throw new Error("ไม่พบคำขอ");
      const ownerRow = own.recordset[0] as { CreatedBy: number | null; Status: string; FormCode: string };
      // FormCode is checked here (AP-1's equivalent read does not need to —
      // it has no sibling child table keyed 1:1 off RequestId the way
      // AccReimburse is). Without this, an id belonging to a different form
      // that this user happens to own would have its requester/brand/manager
      // snapshot silently overwritten with AP-4 data.
      if (ownerRow.FormCode !== AP4_FORM_CODE) throw new Error("ไม่พบคำขอ");
      if (ownerRow.CreatedBy !== userId) throw new Error("ไม่มีสิทธิ์แก้ไขคำขอนี้");
      if (ownerRow.Status !== "Draft" && ownerRow.Status !== "Returned") {
        throw new Error("คำขอนี้ไม่สามารถแก้ไขได้ในสถานะปัจจุบัน");
      }

      await tx
        .request()
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
        .input("total", sql.Decimal(18, 2), totalAmount)
        .query(
          `UPDATE [dbo].[AccRequest] SET BrandCode=@brand,
             EmployeeId=@empId, StaffId=@staffId,
             RequesterFirstName=@rFirst, RequesterLastName=@rLast, RequesterFullName=@rFull,
             RequesterEmail=@rEmail, RequesterPosition=@rPos,
             RequesterDepartmentId=@rDeptId, RequesterDepartmentName=@rDeptName,
             RequesterDepartmentCode=@rDeptCode, ManagerStaffId=@mgrStaff,
             TotalAmount=@total, UpdatedAt=SYSDATETIME() WHERE Id=@id`,
        );

      await tx
        .request()
        .input("rid", sql.Int, requestId)
        .input("purpose", sql.NVarChar(500), input.purpose ?? null)
        .input("total", sql.Decimal(18, 2), totalAmount)
        .query(`UPDATE [dbo].[AccReimburse] SET Purpose=@purpose, TotalAmount=@total WHERE RequestId=@rid`);
    }

    await persistReimburseItems(tx, requestId, items);
    await persistRuleAcks(tx, requestId, input.ackedRuleIds ?? []);

    await tx.commit();
    return requestId;
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}

/* ─────────────────────────── writes: submit ─────────────────────────── */

const ERR_NO_BRAND = "กรุณาเลือกแบรนด์ที่ต้องการเบิก";
const ERR_NO_ITEMS = "กรุณาเพิ่มรายการค่าใช้จ่ายอย่างน้อย 1 รายการ";
/**
 * One attachment rule, where there were two.
 *
 * AP-4 used to demand the AP-4.1 workbook *and* at least one receipt, in two
 * separate slots with different accepted types. It now asks for at least one
 * file of any accepted kind — image, PDF or spreadsheet — in a single slot.
 * `AccReimburse.ExcelFileId` is left in place and still read, so a request
 * filed under the old rule keeps showing its workbook and can still satisfy
 * this check with it; nothing writes that column any more.
 */
const ERR_NO_ATTACHMENT =
  "กรุณาแนบหลักฐานประกอบการเบิกค่าใช้จ่ายจริงอย่างน้อย 1 ไฟล์";
const ERR_RULES_NOT_ACKED = "กรุณายืนยันระเบียบการจ่าย Reimburse ให้ครบทุกข้อ";

/**
 * Submit-time validation (spec §5.2: fields 3, 4, 4b, 5 and every rule in 6
 * must be satisfied). Accumulates every failing rule, like AP-1's
 * `validateForSubmit`, rather than stopping at the first — the requester sees
 * everything wrong with one submit attempt. `managerStaffId` is checked here
 * (mirroring AP-1: the *email* lookup is a separate, later throw in the
 * caller, exactly as in AP-1's `submitRequest`).
 */
async function validateReimburseForSubmit(
  current: ReimburseDetail,
  managerStaffId: number | null,
): Promise<string[]> {
  const errs: string[] = [];

  const uat = await isUatRequest();
  if (!managerStaffId) {
    errs.push(uat ? UAT_MANAGER_MISSING_ERROR : "ยังไม่ได้กำหนดผู้จัดการ (ManagerStaffId) ในระบบ HR");
  }

  if (!current.brandCode) errs.push(ERR_NO_BRAND);

  // Spec §5.2 field 2. Client-side required marks are not a control: a draft
  // written before this rule existed still holds a null purpose, and the save
  // path accepts one, so the check has to be here as well as on the form.
  if (!isPurposeGiven(current.purpose)) errs.push(PURPOSE_REQUIRED);

  if (current.items.length === 0) {
    errs.push(ERR_NO_ITEMS);
  } else {
    errs.push(...validateItemMoney(current.items));
  }

  // The workbook counts as an attachment rather than as its own requirement —
  // an older request whose only file is the AP-4.1 sheet still passes.
  if (!current.excelFile && current.receiptFiles.length === 0) errs.push(ERR_NO_ATTACHMENT);

  const activeRules = await listActiveRules();
  const ackedSet = new Set(current.ackedRuleIds);
  if (activeRules.some((r) => !ackedSet.has(r.id))) errs.push(ERR_RULES_NOT_ACKED);

  return errs;
}

function row(k: string, v: unknown): string {
  return `<tr><td style="padding:4px 8px;color:#666">${esc(k)}</td><td style="padding:4px 8px">${esc(v)}</td></tr>`;
}

/**
 * Own small email template rather than reusing `@/lib/acc/email-templates`'s
 * `buildEmail` — that function is typed against AP-1's `AccRequest` shape
 * (it reads `req.travel?.travelDate`), which `ReimburseDetail` does not have.
 * Its `esc()` helper is exported and reused here for the same XSS-safety.
 */
function buildReimburseSubmittedEmail(req: ReimburseDetail): { subject: string; html: string } {
  const url = `${env.NEXT_PUBLIC_APP_URL ?? ""}/request/reimburse/${req.id}`;
  const subject = `ขออนุมัติเบิกเงินคืนพนักงาน ${req.requestNo ?? ""}`;
  const rows = [
    row("เลขที่", req.requestNo ?? "-"),
    row("ผู้ขอ", req.requesterFullName ?? "-"),
    row("แบรนด์", req.brandCode ?? "-"),
    row("ยอดรวม (บาท)", req.totalAmount ?? "-"),
  ].join("");
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto">
    <h2 style="color:#A3121B">${esc(subject)}</h2>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
    <p style="margin-top:16px"><a href="${esc(url)}"
      style="background:#A3121B;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">เปิดเอกสาร</a></p>
  </div>`;
  return { subject, html };
}

/**
 * Submit a request: validate, allocate RequestNo, snapshot requester +
 * manager, recompute totals, create the MANAGER approval, queue the manager
 * email. One transaction. Operates entirely on what is already persisted
 * (this function takes no item payload) — the caller is expected to have
 * called `saveReimburseDraft` with the latest edits first, exactly as AP-1's
 * `submitRequest` re-reads via `getRequest` rather than trusting a payload.
 */
export async function submitReimburseRequest(id: number, userId: number): Promise<void> {
  await assertFormWritable();

  const current = await getReimburseRequest(id);
  if (!current) throw new Error("ไม่พบคำขอ");
  if (current.status !== "Draft" && current.status !== "Returned") {
    throw new Error("คำขอนี้ถูกส่งไปแล้ว");
  }

  const loginEmail = await requireLoginEmail(userId);
  // The persisted requester, not the actor: this function takes no payload, so
  // the saved row is the only thing that can say whose claim this is. Passing
  // null here would re-stamp an on-behalf draft with the actor's own HR record
  // and send it to the actor's manager. AP-1's submit route reads `StaffId` off
  // the row for the same reason; here `current` already carries it.
  const requester = await resolveRequesterForActor(loginEmail, current.staffId ?? null);

  const errors = await validateReimburseForSubmit(current, requester.managerStaffId);
  if (errors.length) throw new Error(errors.join("\n"));

  const managerEmail = await resolveManagerEmail(requester.managerStaffId);
  if (!managerEmail) {
    throw new Error(
      (await isUatRequest())
        ? UAT_MANAGER_MISSING_ERROR
        : "ไม่พบอีเมลผู้จัดการ (ManagerStaffId) — ไม่สามารถส่งอนุมัติได้",
    );
  }

  // Recomputed from the items just validated — never the client's figure, and
  // never a stale AccReimburse.TotalAmount a prior draft save may have left
  // behind. Every item here has already passed validateItemMoney, so this
  // never sums a malformed contribution.
  const totalAmount = sumReimburseItems(current.items);

  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    // Same claim AP-1 uses: only the row that flips Draft/Returned ->
    // Submitted here proceeds (asserted by the UPDATE itself, not by the
    // `getReimburseRequest` read above), so two tabs / a double submit / a
    // retry cannot both allocate a number and both write a full submit.
    const claim = await tx
      .request()
      .input("id", sql.Int, id)
      .input("uid", sql.Int, userId || null)
      .query(
        `UPDATE [dbo].[AccRequest]
         SET Status='Submitted', CurrentStepCode='MANAGER', UpdatedAt=SYSDATETIME()
         OUTPUT INSERTED.RequestNo AS RequestNo
         WHERE Id=@id AND CreatedBy=@uid AND Status IN ('Draft','Returned')`,
      );
    if (claim.rowsAffected[0] !== 1) {
      throw new AccConflictError(SUBMIT_ALREADY_CLAIMED);
    }

    // A returned request keeps the number it was already given — only a
    // first submit allocates, and it still allocates inside the claim's
    // transaction so a tab that lost the race never consumes one. See
    // src/lib/acc/request-service.ts submitRequest for the full rationale;
    // AP-1 was renumbering resubmissions until that was fixed, and this must
    // not reintroduce the same bug in a new form.
    const existingNo = ((claim.recordset?.[0]?.RequestNo as string | null) ?? "").trim();
    const requestNo = existingNo || (await allocateRequestNo(AP4_RUNNING_PREFIX, new Date(), tx));

    await tx
      .request()
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
      .input("by", sql.Int, userId || null)
      .query(
        `UPDATE [dbo].[AccRequest] SET
           RequestNo=@no,
           EmployeeId=@empId, StaffId=@staffId, RequesterFirstName=@fname, RequesterLastName=@lname,
           RequesterFullName=@full, RequesterEmail=@email, RequesterPosition=@pos,
           RequesterDepartmentId=@deptId, RequesterDepartmentName=@deptName, RequesterDepartmentCode=@deptCode,
           ManagerStaffId=@mgrStaff, ManagerEmail=@mgrEmail, CompanyName=@company,
           TotalAmount=@total, SubmittedBy=@by, SubmittedAt=SYSDATETIME(), UpdatedAt=SYSDATETIME()
         WHERE Id=@id`,
      );

    await tx
      .request()
      .input("rid", sql.Int, id)
      .input("total", sql.Decimal(18, 2), totalAmount)
      .query(`UPDATE [dbo].[AccReimburse] SET TotalAmount=@total WHERE RequestId=@rid`);

    // Reset any prior approvals (e.g. resubmit after Return), then create the MANAGER step.
    await tx.request().input("id", sql.Int, id).query(`DELETE FROM [dbo].[AccApproval] WHERE RequestId=@id`);
    await tx
      .request()
      .input("id", sql.Int, id)
      .input("mgrStaff", sql.Int, requester.managerStaffId ?? null)
      .input("mgrEmail", sql.NVarChar, managerEmail)
      .query(
        `INSERT INTO [dbo].[AccApproval] (RequestId, StepCode, StepOrder, AssignedTo, AssignedEmail, Status)
         VALUES (@id, 'MANAGER', 1, @mgrStaff, @mgrEmail, 'Pending')`,
      );

    await tx
      .request()
      .input("id", sql.Int, id)
      .input("by", sql.Int, userId || null)
      .input("no", sql.NVarChar, requestNo)
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note) VALUES (@id, @by, 'submitted', @no)`);

    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }

  const updated = await getReimburseRequest(id);
  if (updated) {
    const mail = buildReimburseSubmittedEmail(updated);
    await queueEmail({
      requestId: id,
      toEmail: managerEmail,
      subject: mail.subject,
      bodyHtml: mail.html,
      triggerType: "Submitted",
    });
  }
}
