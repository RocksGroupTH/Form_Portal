import { getAccPool, sql } from "@/lib/acc/pool";
import { fixThaiDate } from "@/lib/db/mssql";
import { hrEmployeeTable } from "@/lib/hr/constants";
import { AP3_FORM_CODE } from "@/features/clear-advance/constants";

function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}
function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface ClrReportFilters {
  brandCode?: string | null;
  status?: string | null;       // AccRequest.Status
  staffId?: number | null;
  advanceNo?: string | null;    // linked AP-2 RequestNo
  requestNo?: string | null;    // AP-3 RequestNo
  from?: string | null;         // submitted date range
  to?: string | null;
}

/* ─────────────── AP-3-Control: one row per AP-3, linked to AP-2 ─────────────── */

export interface ClrControlRow {
  id: number;
  submittedAt: string | null;
  requestNo: string | null;         // ADC no
  staffId: number | null;
  advanceRequestNo: string | null;  // linked AP-2 ADV no
  requesterFullName: string | null;
  requesterPosition: string | null;
  requesterDepartmentName: string | null;
  advanceAmount: number | null;
  expenseOf: string | null;
  actualTotal: number | null;
  refundToCompany: number | null;   // >0 return to company
  extraToEmployee: number | null;   // >0 company pays extra
  refundTransferDate: string | null;
  pvDocNo: string | null;
  paymentDate: string | null;
  managerApprovedName: string | null;
  managerApprovedAt: string | null;
  accountActionedName: string | null;
  accountActionedAt: string | null;
  headApprovedName: string | null;
  headApprovedAt: string | null;
  pendingOn: string | null;         // current step label, or null
  overallStatus: string;            // AccRequest.Status
}

function whereClause(f: ClrReportFilters, r: ReturnType<Awaited<ReturnType<typeof getAccPool>>["request"]>): string {
  const parts = [`req.FormCode = @form`];
  r.input("form", sql.NVarChar, AP3_FORM_CODE);
  if (f.brandCode) { parts.push(`req.BrandCode = @brand`); r.input("brand", sql.NVarChar, f.brandCode); }
  if (f.status) { parts.push(`req.Status = @status`); r.input("status", sql.NVarChar, f.status); }
  if (f.staffId != null) { parts.push(`req.StaffId = @staffId`); r.input("staffId", sql.Int, f.staffId); }
  if (f.requestNo) { parts.push(`req.RequestNo LIKE @reqNo`); r.input("reqNo", sql.NVarChar, `%${f.requestNo}%`); }
  if (f.advanceNo) { parts.push(`c.AdvanceRequestNo LIKE @advNo`); r.input("advNo", sql.NVarChar, `%${f.advanceNo}%`); }
  if (f.from) { parts.push(`req.SubmittedAt >= @from`); r.input("from", sql.Date, f.from); }
  if (f.to) { parts.push(`req.SubmittedAt < DATEADD(DAY, 1, @to)`); r.input("to", sql.Date, f.to); }
  return parts.join(" AND ");
}

/** AP-3-Control — links each AP-3 clearing to its AP-2 advance + approval stamps. */
export async function listControlRows(f: ClrReportFilters): Promise<ClrControlRow[]> {
  const pool = await getAccPool();
  const r = pool.request();
  const where = whereClause(f, r);

  // Per-step actioned info via correlated subqueries on the AP-3 approval table.
  const stepSql = (step: string, col: "name" | "at") => {
    if (col === "name") {
      return `(SELECT TOP 1 COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(e.FirstName,N' ',e.LastName))),N''), e.FullName)
               FROM [dbo].[AccClearAdvanceApproval] a
               LEFT JOIN ${hrEmployeeTable()} e ON e.StaffId = a.ActionedByStaffId AND e.Status = N'Active'
               WHERE a.RequestId = req.Id AND a.StepCode = '${step}' AND a.Status = 'Approved')`;
    }
    return `(SELECT TOP 1 a.ActionedAt FROM [dbo].[AccClearAdvanceApproval] a
             WHERE a.RequestId = req.Id AND a.StepCode = '${step}' AND a.Status = 'Approved')`;
  };

  const res = await r.query(`
    SELECT req.Id, req.SubmittedAt, req.RequestNo, req.StaffId, req.Status, req.CurrentStepCode,
           req.RequesterFullName, req.RequesterPosition, req.RequesterDepartmentName,
           c.AdvanceRequestNo, c.AdvanceAmount, c.ExpenseOf, c.ActualTotal, c.RefundToCompany,
           c.RefundTransferDate, c.PvDocNo, c.PaymentDate,
           ${stepSql("MANAGER", "name")} AS MgrName, ${stepSql("MANAGER", "at")} AS MgrAt,
           ${stepSql("ACCOUNT", "name")} AS AccName, ${stepSql("ACCOUNT", "at")} AS AccAt,
           ${stepSql("HEAD", "name")}    AS HeadName, ${stepSql("HEAD", "at")}    AS HeadAt
    FROM [dbo].[AccRequest] req
    LEFT JOIN [dbo].[AccClearAdvance] c ON c.RequestId = req.Id
    WHERE ${where}
    ORDER BY req.SubmittedAt DESC, req.Id DESC
  `);

  const stepLabel: Record<string, string> = { MANAGER: "ผู้จัดการ", ACCOUNT: "บัญชี", HEAD: "หัวหน้าบัญชี" };
  return (res.recordset as Record<string, unknown>[]).map((x) => {
    const refund = num(x.RefundToCompany) ?? 0;
    const step = (x.CurrentStepCode as string) ?? null;
    return {
      id: x.Id as number,
      submittedAt: x.SubmittedAt ? fixThaiDate(x.SubmittedAt as Date)!.toISOString() : null,
      requestNo: (x.RequestNo as string) ?? null,
      staffId: (x.StaffId as number) ?? null,
      advanceRequestNo: (x.AdvanceRequestNo as string) ?? null,
      requesterFullName: (x.RequesterFullName as string) ?? null,
      requesterPosition: (x.RequesterPosition as string) ?? null,
      requesterDepartmentName: (x.RequesterDepartmentName as string) ?? null,
      advanceAmount: num(x.AdvanceAmount),
      expenseOf: (x.ExpenseOf as string) ?? null,
      actualTotal: num(x.ActualTotal),
      refundToCompany: refund > 0 ? refund : 0,
      extraToEmployee: refund < 0 ? Math.abs(refund) : 0,
      refundTransferDate: x.RefundTransferDate ? toYmd(x.RefundTransferDate as Date) : null,
      pvDocNo: (x.PvDocNo as string) ?? null,
      paymentDate: x.PaymentDate ? toYmd(x.PaymentDate as Date) : null,
      managerApprovedName: (x.MgrName as string) ?? null,
      managerApprovedAt: x.MgrAt ? fixThaiDate(x.MgrAt as Date)!.toISOString() : null,
      accountActionedName: (x.AccName as string) ?? null,
      accountActionedAt: x.AccAt ? fixThaiDate(x.AccAt as Date)!.toISOString() : null,
      headApprovedName: (x.HeadName as string) ?? null,
      headApprovedAt: x.HeadAt ? fixThaiDate(x.HeadAt as Date)!.toISOString() : null,
      pendingOn: step ? (stepLabel[step] ?? step) : null,
      overallStatus: x.Status as string,
    };
  });
}

/* ─────────────── AP-3-Detail: one row per expense line (Complete only) ─────────────── */

export interface ClrDetailRow {
  requestNo: string | null;
  requestDate: string | null;
  lineNo: number;
  staffId: number | null;
  requesterFullName: string | null;
  expenseOf: string | null;
  branchCode: string | null;
  expenseDate: string | null;
  docNo: string | null;
  glAccountNo: string | null;
  glAccountName: string | null;
  description: string | null;
  amountBeforeVat: number | null;
  vatAmount: number | null;
  totalInclVat: number | null;
  whtAmount: number | null;
  netAmount: number | null;
  taxId: string | null;
  payeeName: string | null;
  payeeAddress: string | null;
  advanceRequestNo: string | null;
}

/** AP-3-Detail — line-level report for Complete (Approved) clearings only. */
export async function listDetailRows(f: ClrReportFilters): Promise<ClrDetailRow[]> {
  const pool = await getAccPool();
  const r = pool.request();
  const forced = { ...f, status: "Approved" as string };
  const where = whereClause(forced, r);

  const res = await r.query(`
    SELECT req.RequestNo, req.SubmittedAt, req.StaffId, req.RequesterFullName,
           c.ExpenseOf, c.AdvanceRequestNo,
           i.[LineNo], i.ExpenseDate, i.DocNo, i.GlAccountNo, i.GlAccountName, i.Description, i.BranchCode,
           i.AmountBeforeVat, i.VatAmount, i.TotalInclVat, i.WhtAmount, i.NetAmount,
           w.TaxId, w.PayeeName, w.PayeeAddress
    FROM [dbo].[AccRequest] req
    JOIN [dbo].[AccClearAdvance] c ON c.RequestId = req.Id
    JOIN [dbo].[AccClearAdvanceItem] i ON i.ClearAdvanceId = c.Id
    OUTER APPLY (
      SELECT TOP 1 TaxId, PayeeName, PayeeAddress
      FROM [dbo].[AccClearAdvanceWht] w2
      WHERE w2.ClearAdvanceId = c.Id
        AND (w2.DocNo = i.DocNo OR w2.[LineNo] = i.[LineNo])
    ) w
    WHERE ${where}
    ORDER BY req.RequestNo, i.SortOrder, i.Id
  `);

  return (res.recordset as Record<string, unknown>[]).map((x) => ({
    requestNo: (x.RequestNo as string) ?? null,
    requestDate: x.SubmittedAt ? toYmd(x.SubmittedAt as Date) : null,
    lineNo: (x.LineNo as number) ?? 0,
    staffId: (x.StaffId as number) ?? null,
    requesterFullName: (x.RequesterFullName as string) ?? null,
    expenseOf: (x.ExpenseOf as string) ?? null,
    branchCode: (x.BranchCode as string) ?? null,
    expenseDate: x.ExpenseDate ? toYmd(x.ExpenseDate as Date) : null,
    docNo: (x.DocNo as string) ?? null,
    glAccountNo: (x.GlAccountNo as string) ?? null,
    glAccountName: (x.GlAccountName as string) ?? null,
    description: (x.Description as string) ?? null,
    amountBeforeVat: num(x.AmountBeforeVat),
    vatAmount: num(x.VatAmount),
    totalInclVat: num(x.TotalInclVat),
    whtAmount: num(x.WhtAmount),
    netAmount: num(x.NetAmount),
    taxId: (x.TaxId as string) ?? null,
    payeeName: (x.PayeeName as string) ?? null,
    payeeAddress: (x.PayeeAddress as string) ?? null,
    advanceRequestNo: (x.AdvanceRequestNo as string) ?? null,
  }));
}
