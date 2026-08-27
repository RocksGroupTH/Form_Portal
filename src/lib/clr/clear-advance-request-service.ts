import { getAccPool, sql } from "@/lib/acc/pool";
import { hrEmployeeTable } from "@/lib/hr/constants";
import { allocateRequestNo } from "@/lib/acc/sequence";
import { listClrErpBranchOptions } from "@/lib/clr/clear-advance-admin-service";
import {
  resolveManagerEmail,
  resolveRequesterForActor,
  type RequesterSnapshot,
} from "@/lib/acc/employee-context";
import { queueEmail } from "@/lib/acc/email-queue";
import {
  AP3_FORM_CODE,
  AP3_SEQUENCE_PREFIX,
  AP3_DEFAULT_CURRENCY,
  CLR_STEP_LABEL_TH,
  isRocksPcBrand,
  FORCE_GL_NON_ROCKS_PC,
  type ClrStepCode,
} from "@/features/clear-advance/constants";
import type {
  BranchOption,
  ClearAdvanceDetail,
  ClearAdvanceDraftSummary,
  ClearAdvanceItem,
  ClearAdvanceRequest,
  ClearAdvanceSaveInput,
  ClearAdvanceWhtItem,
  ClrApproval,
  GlAccountOption,
  PendingAdvanceOption,
} from "@/features/clear-advance/types";

/* ─────────────────────────── helpers ─────────────────────────── */

function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}
function n0(v: unknown): number {
  return v === null || v === undefined ? 0 : Number(v);
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
/** Date column → YYYY-MM-DD using local getters (server is Thai time). */
function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Per-line derived amounts: total = before + VAT, net = total − WHT. */
export function lineTotals(it: ClearAdvanceItem): { total: number; net: number } {
  const total = round2(n0(it.amountBeforeVat) + n0(it.vatAmount));
  const net = round2(total - n0(it.whtAmount));
  return { total, net };
}
/** Actual total = Σ net; refund = advance received − actual (positive = return to company). */
export function computeActualTotal(items: ClearAdvanceItem[]): number {
  return round2(items.reduce((s, it) => s + lineTotals(it).net, 0));
}
export function computeRefund(advanceAmount: number | null, actualTotal: number): number {
  return round2((advanceAmount ?? 0) - actualTotal);
}

/* ─────────────────────────── mappers ─────────────────────────── */

function mapRequestRow(r: Record<string, unknown>): ClearAdvanceRequest {
  return {
    id: r.Id as number,
    requestNo: (r.RequestNo as string) ?? null,
    formCode: r.FormCode as string,
    brandCode: (r.BrandCode as string) ?? null,
    status: r.Status as ClearAdvanceRequest["status"],
    currentStepCode: (r.CurrentStepCode as ClrStepCode) ?? null,
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
    submittedBy: (r.SubmittedBy as number) ?? null,
    submittedAt: r.SubmittedAt ? (r.SubmittedAt as Date).toISOString() : null,
    createdAt: r.CreatedAt ? (r.CreatedAt as Date).toISOString() : "",
    updatedAt: r.UpdatedAt ? (r.UpdatedAt as Date).toISOString() : "",
  };
}

function mapClearRow(r: Record<string, unknown>): ClearAdvanceDetail {
  return {
    id: r.Id as number,
    advanceRequestId: (r.AdvanceRequestId as number) ?? null,
    advanceRequestNo: (r.AdvanceRequestNo as string) ?? null,
    advanceAmount: num(r.AdvanceAmount),
    expenseOf: (r.ExpenseOf as string) ?? null,
    actualTotal: num(r.ActualTotal),
    refundToCompany: num(r.RefundToCompany),
    currency: (r.Currency as string) ?? AP3_DEFAULT_CURRENCY,
    whtNote: (r.WhtNote as string) ?? null,
    refundTransferDate: r.RefundTransferDate ? toYmd(r.RefundTransferDate as Date) : null,
    refundTransferAmount: num(r.RefundTransferAmount),
    pvDocNo: (r.PvDocNo as string) ?? null,
    paymentDate: r.PaymentDate ? toYmd(r.PaymentDate as Date) : null,
    items: [],
    whtItems: [],
  };
}

function mapItemRow(x: Record<string, unknown>): ClearAdvanceItem {
  return {
    id: x.Id as number,
    lineNo: (x.LineNo as number) ?? 0,
    expenseDate: x.ExpenseDate ? toYmd(x.ExpenseDate as Date) : null,
    docNo: (x.DocNo as string) ?? null,
    glAccountNo: (x.GlAccountNo as string) ?? null,
    glAccountName: (x.GlAccountName as string) ?? null,
    description: (x.Description as string) ?? null,
    branchCode: (x.BranchCode as string) ?? null,
    amountBeforeVat: num(x.AmountBeforeVat),
    vatAmount: num(x.VatAmount),
    totalInclVat: num(x.TotalInclVat),
    whtAmount: num(x.WhtAmount),
    netAmount: num(x.NetAmount),
    sortOrder: (x.SortOrder as number) ?? 0,
    sourceFileId: (x.SourceFileId as number) ?? null,
  };
}

function mapWhtRow(x: Record<string, unknown>): ClearAdvanceWhtItem {
  return {
    id: x.Id as number,
    lineNo: (x.LineNo as number) ?? 0,
    expenseDate: x.ExpenseDate ? toYmd(x.ExpenseDate as Date) : null,
    docNo: (x.DocNo as string) ?? null,
    description: (x.Description as string) ?? null,
    taxId: (x.TaxId as string) ?? null,
    payeeName: (x.PayeeName as string) ?? null,
    payeeAddress: (x.PayeeAddress as string) ?? null,
    amount: num(x.Amount),
    whtAmount: num(x.WhtAmount),
    netAmount: num(x.NetAmount),
    sortOrder: (x.SortOrder as number) ?? 0,
  };
}

async function loadClear(
  pool: Awaited<ReturnType<typeof getAccPool>>,
  requestId: number,
): Promise<ClearAdvanceDetail | null> {
  const head = await pool.request().input("rid", sql.Int, requestId)
    .query(`SELECT TOP 1 * FROM [dbo].[AccClearAdvance] WHERE RequestId = @rid`);
  if (head.recordset.length === 0) return null;
  const clear = mapClearRow(head.recordset[0] as Record<string, unknown>);
  const clearId = clear.id!;

  const items = await pool.request().input("cid", sql.Int, clearId)
    .query(`SELECT * FROM [dbo].[AccClearAdvanceItem] WHERE ClearAdvanceId = @cid ORDER BY SortOrder, Id`);
  clear.items = (items.recordset as Record<string, unknown>[]).map(mapItemRow);

  const wht = await pool.request().input("cid", sql.Int, clearId)
    .query(`SELECT * FROM [dbo].[AccClearAdvanceWht] WHERE ClearAdvanceId = @cid ORDER BY SortOrder, Id`);
  clear.whtItems = (wht.recordset as Record<string, unknown>[]).map(mapWhtRow);

  const files = await pool.request().input("rid", sql.Int, requestId)
    .query(`SELECT Id, FileName, FileSize, ContentType, RefType
            FROM [dbo].[AccRequestFile] WHERE RequestId = @rid AND RefType IN ('clear_doc','refund_proof')
            ORDER BY Id`);
  const toMeta = (f: Record<string, unknown>) => ({
    id: f.Id as number,
    fileName: (f.FileName as string) ?? "",
    fileSize: (f.FileSize as number) ?? null,
    contentType: (f.ContentType as string) ?? null,
    url: `/api/request/clear-advance/files/${f.Id as number}`,
  });
  const rows = files.recordset as Record<string, unknown>[];
  clear.files = rows.filter((f) => f.RefType === "clear_doc").map(toMeta);
  clear.refundProofFiles = rows.filter((f) => f.RefType === "refund_proof").map(toMeta);

  return clear;
}

/* ─────────────────────────── reads ─────────────────────────── */

export async function getRequest(id: number): Promise<ClearAdvanceRequest | null> {
  const pool = await getAccPool();
  // Scope strictly to AP-3 — an id from another form (e.g. an AP-2 advance) must
  // read as "not found" here, not load as if it were a clear-advance request.
  const head = await pool.request().input("id", sql.Int, id).input("form", sql.NVarChar, AP3_FORM_CODE)
    .query(`SELECT * FROM [dbo].[AccRequest] WHERE Id = @id AND FormCode = @form`);
  if (head.recordset.length === 0) return null;
  const req = mapRequestRow(head.recordset[0] as Record<string, unknown>);

  const clear = await loadClear(pool, id);
  if (clear) req.clear = clear;

  const aRes = await pool.request().input("id", sql.Int, id)
    .query(`SELECT a.*,
              COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(e_action.FirstName, N' ', e_action.LastName))), N''), e_action.FullName) AS ActionedByHrName,
              COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(e_assign.FirstName, N' ', e_assign.LastName))), N''), e_assign.FullName) AS AssignedHrName
            FROM [dbo].[AccClearAdvanceApproval] a
            LEFT JOIN ${hrEmployeeTable()} e_action ON e_action.StaffId = a.ActionedByStaffId AND e_action.Status = N'Active'
            LEFT JOIN ${hrEmployeeTable()} e_assign ON e_assign.StaffId = a.AssignedStaffId AND e_assign.Status = N'Active'
            WHERE a.RequestId = @id
            ORDER BY a.StepOrder, a.Id`);
  req.approvals = (aRes.recordset as Record<string, unknown>[]).map((x): ClrApproval => {
    const stepCode = x.StepCode as ClrStepCode;
    return {
      id: x.Id as number,
      stepCode,
      stepOrder: x.StepOrder as number,
      stepLabel: CLR_STEP_LABEL_TH[stepCode] ?? String(x.StepCode),
      assignedStaffId: (x.AssignedStaffId as number) ?? null,
      assignedEmail: (x.AssignedEmail as string) ?? null,
      status: x.Status as string,
      comment: (x.Comment as string) ?? null,
      isChecked: x.IsChecked === null || x.IsChecked === undefined ? null : !!x.IsChecked,
      actionedByStaffId: (x.ActionedByStaffId as number) ?? null,
      actionedByName: (x.ActionedByHrName as string) ?? null,
      assignedName: (x.AssignedHrName as string) ?? null,
      actionedAt: x.ActionedAt ? (x.ActionedAt as Date).toISOString() : null,
      createdAt: x.CreatedAt ? (x.CreatedAt as Date).toISOString() : "",
    };
  });

  return req;
}

/** Editable AP-3 drafts for the current user (by creator). */
export async function listMyDrafts(userId: number): Promise<ClearAdvanceDraftSummary[]> {
  const pool = await getAccPool();
  const res = await pool.request()
    .input("uid", sql.Int, userId)
    .input("form", sql.NVarChar, AP3_FORM_CODE)
    .query(`
      SELECT r.Id, r.BrandCode, r.Status, r.UpdatedAt,
             c.AdvanceRequestNo, c.AdvanceAmount, c.ActualTotal, c.RefundToCompany
      FROM [dbo].[AccRequest] r
      LEFT JOIN [dbo].[AccClearAdvance] c ON c.RequestId = r.Id
      WHERE r.FormCode = @form
        AND r.Status IN ('Draft', 'Returned')
        AND (r.CreatedBy = @uid OR r.SubmittedBy = @uid)
      ORDER BY r.UpdatedAt DESC
    `);
  return (res.recordset as Record<string, unknown>[]).map((row) => ({
    id: row.Id as number,
    brandCode: (row.BrandCode as string) ?? null,
    status: row.Status as ClearAdvanceDraftSummary["status"],
    advanceRequestNo: (row.AdvanceRequestNo as string) ?? null,
    advanceAmount: num(row.AdvanceAmount),
    actualTotal: num(row.ActualTotal),
    refundToCompany: num(row.RefundToCompany),
    updatedAt: row.UpdatedAt ? (row.UpdatedAt as Date).toISOString() : "",
  }));
}

/**
 * Pending AP-2 advances the current user may still clear.
 * = approved AP-2 advances owned by this staff, not already referenced by a
 *   non-rejected/non-cancelled AP-3 (derivation — no write-back to AP-2 tables).
 */
export async function listPendingAdvances(
  loginEmail: string,
  excludeRequestId?: number | null,
  brandCode?: string | null,
): Promise<PendingAdvanceOption[]> {
  const requester = await resolveRequesterForActor(loginEmail, null);
  const staffId = requester.staffId;
  if (staffId == null) return [];

  const pool = await getAccPool();
  const res = await pool.request()
    .input("staffId", sql.Int, staffId)
    .input("exclude", sql.Int, excludeRequestId ?? null)
    .input("brand", sql.NVarChar, brandCode ?? null)
    .query(`
      SELECT r.Id AS AdvanceRequestId, r.RequestNo AS AdvanceRequestNo,
             -- Clear against the THB-converted amount; a foreign-currency advance
             -- must never be treated as if its face value were baht.
             COALESCE(a.BaseAmount, a.Amount) AS AdvanceAmount,
             a.Currency, a.Amount AS OrigAmount, a.ExchangeRate,
             a.NeedByDate, a.Purpose
      FROM [dbo].[AccRequest] r
      JOIN [dbo].[AccAdvance] a ON a.RequestId = r.Id
      WHERE r.FormCode = 'AP-2' AND r.Status = 'Approved' AND r.StaffId = @staffId
        AND (@brand IS NULL OR r.BrandCode = @brand)
        AND NOT EXISTS (
          SELECT 1 FROM [dbo].[AccClearAdvance] c
          JOIN [dbo].[AccRequest] cr ON cr.Id = c.RequestId
          WHERE c.AdvanceRequestId = r.Id
            AND cr.Status NOT IN ('Rejected','Cancelled')
            AND (@exclude IS NULL OR cr.Id <> @exclude)
        )
      ORDER BY r.Id DESC
    `);
  return (res.recordset as Record<string, unknown>[]).map((x) => ({
    advanceRequestId: x.AdvanceRequestId as number,
    advanceRequestNo: (x.AdvanceRequestNo as string) ?? null,
    advanceAmount: num(x.AdvanceAmount),
    needByDate: x.NeedByDate ? toYmd(x.NeedByDate as Date) : null,
    purpose: (x.Purpose as string) ?? null,
    currency: (x.Currency as string) ?? null,
    origAmount: x.OrigAmount != null ? num(x.OrigAmount) : null,
    exchangeRate: x.ExchangeRate != null ? num(x.ExchangeRate) : null,
  }));
}

/** AP-3.2 G/L expense-category master (active). */
export async function listGlAccounts(): Promise<GlAccountOption[]> {
  const pool = await getAccPool();
  const res = await pool.request()
    .query(`SELECT GlAccountNo, NameTh, NameEn, DimensionType
            FROM [dbo].[AccClearAdvanceGl] WHERE IsActive = 1 ORDER BY SortOrder, GlAccountNo`);
  return (res.recordset as Record<string, unknown>[]).map((x) => ({
    glAccountNo: x.GlAccountNo as string,
    nameTh: (x.NameTh as string) ?? null,
    nameEn: (x.NameEn as string) ?? null,
    dimensionType: (x.DimensionType as GlAccountOption["dimensionType"]) ?? "Employee",
  }));
}

/** Branch/BU dimension options for a brand (reuses AP-1's brand-branch master). */
export async function listBranches(brandCode: string | null): Promise<BranchOption[]> {
  if (!brandCode) return [];
  // สาขา pulled from Rocks_ERP_Data.ErpDimensionValue (DimensionCode='BRANCH'),
  // resolved brand → Company, active + not blocked only.
  const rows = await listClrErpBranchOptions(brandCode);
  return rows.map((r) => ({ code: r.code, name: r.displayName }));
}

/* ─────────────────────────── validation ─────────────────────────── */

/** Strict checks run at submit time. Returns Thai error messages (empty = valid). */
export function validateForSubmit(
  input: ClearAdvanceSaveInput,
  requester: Pick<RequesterSnapshot, "managerStaffId">,
): string[] {
  const errs: string[] = [];
  const c = input.clear;
  if (!requester.managerStaffId) errs.push("ยังไม่ได้กำหนดผู้จัดการใน HR");
  if (!input.brandCode) errs.push("กรุณาเลือกแบรนด์");
  if (!c.advanceRequestId) errs.push("กรุณาเลือกเลขที่ Advance ที่ต้องการเคลียร์");
  // "เป็นค่าใช้จ่ายของ" is derived from the brand — no separate check needed.

  const lines = (c.items ?? []).filter(
    (it) => it.glAccountNo || it.description?.trim() || n0(it.amountBeforeVat) > 0,
  );
  if (lines.length === 0) errs.push("กรุณาระบุรายละเอียดค่าใช้จ่ายจริงอย่างน้อย 1 รายการ");
  for (const it of lines) {
    if (!it.expenseDate) errs.push("มีรายการค่าใช้จ่ายที่ยังไม่ได้ระบุวันที่");
    if (!it.glAccountNo) errs.push("มีรายการค่าใช้จ่ายที่ยังไม่ได้เลือกหมวด (รายการ)");
    if (!(n0(it.amountBeforeVat) > 0)) errs.push("มีรายการค่าใช้จ่ายที่จำนวนเงินก่อน VAT ไม่ถูกต้อง");
  }

  // WHT: the certificate section total must equal the line WHT total (AP-3.1 rule).
  const lineWht = round2(lines.reduce((s, it) => s + n0(it.whtAmount), 0));
  const certWht = round2((c.whtItems ?? []).reduce((s, w) => s + n0(w.whtAmount), 0));
  if (lineWht > 0) {
    for (const w of c.whtItems ?? []) {
      if (n0(w.whtAmount) > 0 && (!w.taxId?.trim() || !w.payeeName?.trim())) {
        errs.push("รายการหัก ณ ที่จ่าย ต้องกรอกเลขผู้เสียภาษีและชื่อผู้รับให้ครบ");
        break;
      }
    }
    if (Math.abs(lineWht - certWht) > 0.01) {
      errs.push("ยอดหัก ณ ที่จ่ายในตารางใบรับรอง ไม่ตรงกับยอดในรายการค่าใช้จ่าย");
    }
  }

  // Refund back to company requires the transfer date (+ proof attachment, checked in the route/UI).
  const actual = computeActualTotal(lines);
  const refund = computeRefund(c.advanceAmount, actual);
  if (refund > 0) {
    if (!(n0(c.refundTransferAmount) > 0)) errs.push("กรณีต้องโอนเงินคืนบริษัท กรุณาระบุจำนวนเงินที่โอนคืน");
    if (!c.refundTransferDate) errs.push("กรณีต้องโอนเงินคืนบริษัท กรุณาระบุวันที่โอนเงินคืน");
  }
  return errs;
}

/* ─────────────────────────── writes ─────────────────────────── */

/**
 * Persist the AccClearAdvance header + AccClearAdvanceItem + AccClearAdvanceWht rows
 * for a given request, recomputing actualTotal and refundToCompany.
 * This is the pure data-layer write; it does NOT touch AccRequest.Status or approvals.
 * Called by both saveDraft and saveAccountEdit.
 */
async function persistClearOnly(input: ClearAdvanceSaveInput): Promise<void> {
  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    await persistClear(tx, input.id!, input.clear, input.brandCode ?? null);
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

async function persistClear(
  tx: Awaited<ReturnType<Awaited<ReturnType<typeof getAccPool>>["transaction"]>>,
  requestId: number,
  c: ClearAdvanceDetail,
  brandCode: string | null,
): Promise<void> {
  // "เป็นค่าใช้จ่ายของ" = the selected brand; home brands book their own G/L,
  // every other brand forces 110723001 (จ่ายแทนบ.อื่น).
  const isRocksPc = isRocksPcBrand(brandCode);
  const expenseOf = brandCode ?? c.expenseOf ?? null;
  const items = (c.items ?? []).filter(
    (it) => it.glAccountNo || it.description?.trim() || n0(it.amountBeforeVat) > 0,
  );
  const actualTotal = computeActualTotal(items);
  const refund = computeRefund(c.advanceAmount, actualTotal);

  const bind = () =>
    tx.request()
      .input("rid", sql.Int, requestId)
      .input("advId", sql.Int, c.advanceRequestId ?? null)
      .input("advNo", sql.NVarChar, c.advanceRequestNo ?? null)
      .input("advAmt", sql.Decimal(18, 2), c.advanceAmount ?? null)
      .input("expOf", sql.NVarChar, expenseOf)
      .input("actual", sql.Decimal(18, 2), actualTotal)
      .input("refund", sql.Decimal(18, 2), refund)
      .input("currency", sql.NVarChar, c.currency || AP3_DEFAULT_CURRENCY)
      .input("wht", sql.NVarChar, c.whtNote ?? null)
      .input("refundDate", sql.Date, c.refundTransferDate || null)
      .input("refundAmt", sql.Decimal(18, 2), c.refundTransferAmount ?? null);

  const exists = await tx.request().input("rid", sql.Int, requestId)
    .query(`SELECT TOP 1 Id FROM [dbo].[AccClearAdvance] WHERE RequestId = @rid`);

  let clearId: number;
  if (exists.recordset.length > 0) {
    clearId = exists.recordset[0].Id as number;
    await bind().query(`
      UPDATE [dbo].[AccClearAdvance] SET
        AdvanceRequestId=@advId, AdvanceRequestNo=@advNo, AdvanceAmount=@advAmt,
        ExpenseOf=@expOf, ActualTotal=@actual, RefundToCompany=@refund,
        Currency=@currency, WhtNote=@wht, RefundTransferDate=@refundDate,
        RefundTransferAmount=@refundAmt, UpdatedAt=SYSDATETIME()
      WHERE RequestId=@rid`);
  } else {
    const ins = await bind().query(`
      INSERT INTO [dbo].[AccClearAdvance]
        (RequestId, AdvanceRequestId, AdvanceRequestNo, AdvanceAmount, ExpenseOf,
         ActualTotal, RefundToCompany, Currency, WhtNote, RefundTransferDate, RefundTransferAmount)
      OUTPUT inserted.Id AS Id
      VALUES (@rid, @advId, @advNo, @advAmt, @expOf, @actual, @refund, @currency, @wht, @refundDate, @refundAmt)`);
    clearId = ins.recordset[0].Id as number;
  }

  // Replace expense lines. Apply the force-GL rule when the expense is not Rocks PC.
  await tx.request().input("cid", sql.Int, clearId)
    .query(`DELETE FROM [dbo].[AccClearAdvanceItem] WHERE ClearAdvanceId = @cid`);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const glNo = isRocksPc ? (it.glAccountNo ?? null) : FORCE_GL_NON_ROCKS_PC;
    const glName = isRocksPc ? (it.glAccountName ?? null) : null; // resolved for display on load
    const { total, net } = lineTotals(it);
    await tx.request()
      .input("cid", sql.Int, clearId)
      .input("lineNo", sql.Int, it.lineNo || i + 1)
      .input("date", sql.Date, it.expenseDate || null)
      .input("docNo", sql.NVarChar, it.docNo ?? null)
      .input("glNo", sql.NVarChar, glNo)
      .input("glName", sql.NVarChar, glName)
      .input("desc", sql.NVarChar, it.description ?? null)
      .input("branch", sql.NVarChar, it.branchCode ?? null)
      .input("before", sql.Decimal(18, 2), n0(it.amountBeforeVat))
      .input("vat", sql.Decimal(18, 2), n0(it.vatAmount))
      .input("total", sql.Decimal(18, 2), total)
      .input("whtAmt", sql.Decimal(18, 2), n0(it.whtAmount))
      .input("net", sql.Decimal(18, 2), net)
      .input("sort", sql.Int, i)
      .input("srcFile", sql.Int, it.sourceFileId ?? null)
      .query(`INSERT INTO [dbo].[AccClearAdvanceItem]
                (ClearAdvanceId, [LineNo], ExpenseDate, DocNo, GlAccountNo, GlAccountName, Description,
                 BranchCode, AmountBeforeVat, VatAmount, TotalInclVat, WhtAmount, NetAmount, SortOrder, SourceFileId)
              VALUES (@cid, @lineNo, @date, @docNo, @glNo, @glName, @desc, @branch,
                      @before, @vat, @total, @whtAmt, @net, @sort, @srcFile)`);
  }

  // Replace WHT certificate lines.
  const whts = (c.whtItems ?? []).filter(
    (w) => n0(w.whtAmount) > 0 || w.taxId?.trim() || w.payeeName?.trim(),
  );
  await tx.request().input("cid", sql.Int, clearId)
    .query(`DELETE FROM [dbo].[AccClearAdvanceWht] WHERE ClearAdvanceId = @cid`);
  for (let i = 0; i < whts.length; i++) {
    const w = whts[i];
    await tx.request()
      .input("cid", sql.Int, clearId)
      .input("lineNo", sql.Int, w.lineNo || i + 1)
      .input("date", sql.Date, w.expenseDate || null)
      .input("docNo", sql.NVarChar, w.docNo ?? null)
      .input("desc", sql.NVarChar, w.description ?? null)
      .input("taxId", sql.NVarChar, w.taxId ?? null)
      .input("name", sql.NVarChar, w.payeeName ?? null)
      .input("addr", sql.NVarChar, w.payeeAddress ?? null)
      .input("amt", sql.Decimal(18, 2), n0(w.amount))
      .input("whtAmt", sql.Decimal(18, 2), n0(w.whtAmount))
      .input("net", sql.Decimal(18, 2), round2(n0(w.amount) - n0(w.whtAmount)))
      .input("sort", sql.Int, i)
      .query(`INSERT INTO [dbo].[AccClearAdvanceWht]
                (ClearAdvanceId, [LineNo], ExpenseDate, DocNo, Description, TaxId, PayeeName, PayeeAddress,
                 Amount, WhtAmount, NetAmount, SortOrder)
              VALUES (@cid, @lineNo, @date, @docNo, @desc, @taxId, @name, @addr, @amt, @whtAmt, @net, @sort)`);
  }

  await tx.request()
    .input("rid", sql.Int, requestId)
    .input("total", sql.Decimal(18, 2), actualTotal)
    .query(`UPDATE [dbo].[AccRequest] SET TotalAmount=@total, UpdatedAt=SYSDATETIME() WHERE Id=@rid`);
}

/** Snapshot the linked AP-2 advance's no. + amount (server-trusted, not client). */
async function snapshotAdvance(
  pool: Awaited<ReturnType<typeof getAccPool>>,
  advanceRequestId: number | null,
): Promise<{ requestNo: string | null; amount: number | null }> {
  if (!advanceRequestId) return { requestNo: null, amount: null };
  const r = await pool.request().input("id", sql.Int, advanceRequestId)
    .query(`SELECT r.RequestNo, a.Amount
            FROM [dbo].[AccRequest] r
            LEFT JOIN [dbo].[AccAdvance] a ON a.RequestId = r.Id
            WHERE r.Id = @id AND r.FormCode = 'AP-2'`);
  if (r.recordset.length === 0) return { requestNo: null, amount: null };
  return {
    requestNo: (r.recordset[0].RequestNo as string) ?? null,
    amount: num(r.recordset[0].Amount),
  };
}

/** Create or update a draft (lenient — no strict validation). Returns the request id. */
export async function saveDraft(
  input: ClearAdvanceSaveInput,
  userId: number,
  loginEmail: string,
): Promise<number> {
  const pool = await getAccPool();
  const requester = await resolveRequesterForActor(loginEmail, null);

  const snap = await snapshotAdvance(pool, input.clear.advanceRequestId ?? null);
  input.clear.advanceRequestNo = snap.requestNo;
  input.clear.advanceAmount = snap.amount;

  const tx = pool.transaction();
  await tx.begin();
  try {
    let requestId = input.id ?? 0;

    if (!requestId) {
      const ins = await tx.request()
        .input("brand", sql.NVarChar, input.brandCode ?? null)
        .input("user", sql.Int, userId || null)
        .input("form", sql.NVarChar, AP3_FORM_CODE)
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
        .query(`SELECT CreatedBy, Status FROM [dbo].[AccRequest] WHERE Id=@id AND FormCode='${AP3_FORM_CODE}'`);
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

    await persistClear(tx, requestId, input.clear, input.brandCode ?? null);

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
      .query(`SELECT CreatedBy, Status FROM [dbo].[AccRequest] WHERE Id=@id AND FormCode='${AP3_FORM_CODE}'`);
    if (own.recordset.length === 0) throw new Error("ไม่พบคำขอ");
    const row = own.recordset[0] as { CreatedBy: number | null; Status: string };
    if (row.CreatedBy !== userId) throw new Error("ไม่มีสิทธิ์ลบคำขอนี้");
    if (row.Status !== "Draft" && row.Status !== "Returned") {
      throw new Error("คำขอนี้ไม่สามารถลบได้ในสถานะปัจจุบัน");
    }
    const clr = await tx.request().input("id", sql.Int, id)
      .query(`SELECT Id FROM [dbo].[AccClearAdvance] WHERE RequestId=@id`);
    for (const row2 of clr.recordset as { Id: number }[]) {
      await tx.request().input("cid", sql.Int, row2.Id)
        .query(`DELETE FROM [dbo].[AccClearAdvanceItem] WHERE ClearAdvanceId=@cid`);
      await tx.request().input("cid", sql.Int, row2.Id)
        .query(`DELETE FROM [dbo].[AccClearAdvanceWht] WHERE ClearAdvanceId=@cid`);
    }
    await tx.request().input("id", sql.Int, id).query(`DELETE FROM [dbo].[AccClearAdvanceApproval] WHERE RequestId=@id`);
    await tx.request().input("id", sql.Int, id).query(`DELETE FROM [dbo].[AccActivityLog] WHERE RequestId=@id`);
    await tx.request().input("id", sql.Int, id).query(`DELETE FROM [dbo].[AccClearAdvance] WHERE RequestId=@id`);
    await tx.request().input("id", sql.Int, id).query(`DELETE FROM [dbo].[AccRequestFile] WHERE RequestId=@id`);
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
): Promise<ClearAdvanceRequest> {
  const current = await getRequest(id);
  if (!current) throw new Error("ไม่พบคำขอ");
  if (current.status !== "Draft" && current.status !== "Returned") {
    throw new Error("คำขอนี้ถูกส่งไปแล้ว");
  }

  const clear = current.clear;
  if (!clear) throw new Error("ยังไม่มีข้อมูลการเคลียร์เงินทดรองจ่าย");

  // Receipts required (AP-3: หลักฐานประกอบการเบิกค่าใช้จ่ายจริง — Required).
  if (!clear.files || clear.files.length === 0) {
    throw new Error("กรุณาแนบหลักฐาน (ใบเสร็จ/ใบกำกับภาษี) อย่างน้อย 1 ไฟล์");
  }
  // Refund proof required when money must be returned to the company.
  if ((clear.refundToCompany ?? 0) > 0 && (!clear.refundProofFiles || clear.refundProofFiles.length === 0)) {
    throw new Error("กรณีต้องโอนเงินคืนบริษัท กรุณาแนบหลักฐานการโอนเงินคืน");
  }

  const errors = validateForSubmit(
    { id, brandCode: current.brandCode, staffId: current.staffId, clear },
    { managerStaffId: requester.managerStaffId ?? null },
  );
  if (errors.length) throw new Error(errors.join("\n"));

  const managerEmail = await resolveManagerEmail(requester.managerStaffId);
  if (!managerEmail) throw new Error("ไม่พบอีเมลผู้จัดการ (ManagerStaffId) — ไม่สามารถส่งอนุมัติได้");

  const totalAmount = clear.actualTotal ?? 0;

  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  let requestNo = "";
  try {
    // ── P0: revalidate + claim the AP-2 advance under a serializable lock ──
    // The dropdown filters out already-cleared advances at UI time, but that is
    // no guarantee: a stale draft or crafted request could reference an AP-2 that
    // isn't Approved, belongs to another staff/brand, or is already being cleared
    // by another AP-3. UPDLOCK+HOLDLOCK holds the key range so two concurrent
    // submits claiming the same advance serialize — the first commits its claim,
    // the second sees it and is rejected.
    const advId = clear.advanceRequestId ?? null;
    if (!advId) throw new Error("กรุณาเลือกเลขที่ Advance ที่ต้องการเคลียร์");
    const adv = await tx.request().input("advId", sql.Int, advId)
      .query(`SELECT r.StaffId, r.BrandCode
              FROM [dbo].[AccRequest] r WITH (UPDLOCK, HOLDLOCK)
              JOIN [dbo].[AccAdvance] a ON a.RequestId = r.Id
              WHERE r.Id = @advId AND r.FormCode = 'AP-2' AND r.Status = 'Approved'`);
    if (adv.recordset.length === 0) {
      throw new Error("เงินทดรองจ่าย (AP-2) ที่เลือกไม่ถูกต้องหรือยังไม่ได้รับอนุมัติ");
    }
    const advRow = adv.recordset[0] as { StaffId: number | null; BrandCode: string | null };
    if ((advRow.StaffId ?? null) !== (requester.staffId ?? null)) {
      throw new Error("เงินทดรองจ่ายที่เลือกไม่ใช่ของผู้ขอรายนี้");
    }
    if ((advRow.BrandCode ?? null) !== (current.brandCode ?? null)) {
      throw new Error("แบรนด์ของคำขอไม่ตรงกับแบรนด์ของเงินทดรองจ่ายที่เลือก");
    }
    const dup = await tx.request().input("advId", sql.Int, advId).input("self", sql.Int, id)
      .query(`SELECT TOP 1 cr.RequestNo
              FROM [dbo].[AccClearAdvance] c WITH (UPDLOCK, HOLDLOCK)
              JOIN [dbo].[AccRequest] cr ON cr.Id = c.RequestId
              WHERE c.AdvanceRequestId = @advId AND cr.Id <> @self
                AND cr.Status NOT IN ('Rejected','Cancelled')`);
    if (dup.recordset.length > 0) {
      const other = (dup.recordset[0] as { RequestNo: string | null }).RequestNo;
      throw new Error(`เงินทดรองจ่ายนี้ถูกเคลียร์ไปแล้วในคำขอ ${other ?? "อื่น"}`);
    }

    // Allocate the running no. only once the claim is secured — a rejected
    // revalidation above must not burn an ADC number (avoid sequence gaps).
    requestNo = await allocateRequestNo(AP3_SEQUENCE_PREFIX);

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
      .input("by", sql.Int, userId || null)
      .query(`UPDATE [dbo].[AccRequest] SET
        RequestNo=@no, Status='Submitted', CurrentStepCode='MANAGER',
        EmployeeId=@empId, StaffId=@staffId, RequesterFirstName=@fname, RequesterLastName=@lname,
        RequesterFullName=@full, RequesterEmail=@email, RequesterPosition=@pos,
        RequesterDepartmentId=@deptId, RequesterDepartmentName=@deptName, RequesterDepartmentCode=@deptCode,
        ManagerStaffId=@mgrStaff, ManagerEmail=@mgrEmail, CompanyName=@company,
        TotalAmount=@total, SubmittedBy=@by, SubmittedAt=SYSDATETIME(), UpdatedAt=SYSDATETIME()
        WHERE Id=@id`);

    await tx.request().input("id", sql.Int, id)
      .query(`DELETE FROM [dbo].[AccClearAdvanceApproval] WHERE RequestId=@id`);
    await tx.request()
      .input("id", sql.Int, id)
      .input("mgrStaff", sql.Int, requester.managerStaffId ?? null)
      .input("mgrEmail", sql.NVarChar, managerEmail)
      .query(`INSERT INTO [dbo].[AccClearAdvanceApproval]
                (RequestId, StepCode, StepOrder, AssignedStaffId, AssignedEmail, Status)
              VALUES (@id, 'MANAGER', 1, @mgrStaff, @mgrEmail, 'Pending')`);

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
    const subject = `เคลียร์เงินทดรองจ่าย ${requestNo} รออนุมัติ (${CLR_STEP_LABEL_TH.MANAGER})`;
    const bodyHtml =
      `<p>มีคำขอเคลียร์คืนเงินทดรองจ่ายเลขที่ <b>${requestNo}</b> รอการอนุมัติของท่าน</p>` +
      `<p>ผู้ขอ: ${updated.requesterFullName ?? "-"} · ค่าใช้จ่ายจริง: ${(updated.clear?.actualTotal ?? 0).toLocaleString()} บาท` +
      ` · ต้องโอนคืนบริษัท: ${(updated.clear?.refundToCompany ?? 0).toLocaleString()} บาท</p>` +
      `<p><a href="/request/clear-advance/${id}">เปิดคำขอ</a></p>`;
    await queueEmail({
      requestId: id, toEmail: managerEmail,
      subject, bodyHtml, triggerType: "Submitted",
    });
  }
  return updated!;
}

/**
 * ACCOUNT-step edit: allow the ACCOUNT approver (or admin) to update the clearing
 * data of a Submitted request while it is still at the ACCOUNT step.
 * Role/permission enforcement is the caller's responsibility (the route layer);
 * this function only enforces the status+step guard.
 *
 * The advance amount is frozen from the DB — the accountant edits expense lines,
 * not the advance received, so a crafted PUT cannot change AdvanceAmount and
 * mis-state the ERP journal.
 */
export async function saveAccountEdit(
  input: ClearAdvanceSaveInput,
  _actorUserId: number,
  _actorEmail: string,
): Promise<void> {
  const id = input.id;
  if (!id) throw new Error("ไม่พบคำขอ");

  const pool = await getAccPool();
  const check = await pool.request()
    .input("id", sql.Int, id)
    .input("form", sql.NVarChar, AP3_FORM_CODE)
    .query(`SELECT TOP 1 Status, CurrentStepCode FROM [dbo].[AccRequest] WHERE Id = @id AND FormCode = @form`);
  if (check.recordset.length === 0) throw new Error("ไม่พบคำขอ");

  const row = check.recordset[0] as { Status: string; CurrentStepCode: string | null };
  if (row.Status !== "Submitted" || row.CurrentStepCode !== "ACCOUNT") {
    throw new Error("แก้ไขได้เฉพาะตอนอยู่ขั้นบัญชี (ACCOUNT) เท่านั้น");
  }

  // Freeze advance amount: read the current DB value and overwrite the client-supplied
  // value so a crafted PUT cannot change AdvanceAmount and mis-state the ERP journal.
  const advRes = await pool.request()
    .input("id", sql.Int, id)
    .query(`SELECT TOP 1 AdvanceAmount FROM [dbo].[AccClearAdvance] WHERE RequestId = @id`);
  if (advRes.recordset.length === 0) throw new Error("ไม่พบข้อมูลเคลียร์");
  input.clear.advanceAmount = num((advRes.recordset[0] as Record<string, unknown>).AdvanceAmount);

  await persistClearOnly(input);
}

/** Account step records the PV/PPEX doc no. + (optional) payment date on the header. */
export async function setAccountAction(
  requestId: number,
  pvDocNo: string | null,
  paymentDate: string | null,
): Promise<void> {
  const pool = await getAccPool();
  await pool.request()
    .input("rid", sql.Int, requestId)
    .input("pv", sql.NVarChar, pvDocNo ?? null)
    .input("pd", sql.Date, paymentDate || null)
    .query(`UPDATE [dbo].[AccClearAdvance] SET PvDocNo=@pv, PaymentDate=@pd, UpdatedAt=SYSDATETIME()
            WHERE RequestId=@rid`);
}
