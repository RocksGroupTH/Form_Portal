import { getAccPool, sql } from "@/lib/adv/pool";
import { hrEmployeeTable } from "@/lib/hr/constants";
import { AP2_FORM_CODE } from "@/features/advance/constants";
import { STEP_LABEL, type StepType } from "@/lib/adv/approval-steps";

/** One row of the AP-2 control report (columns per sheet "AP-2-Control"). */
export interface AdvanceReportRow {
  id: number;
  submittedAt: string | null;
  requestNo: string | null;
  staffId: number | null;
  requesterName: string | null;
  position: string | null;
  department: string | null;
  payeeType: string | null;       // โอนให้ (พนักงาน/คู่ค้า)
  payeeName: string | null;
  bankAccount: string | null;
  bankName: string | null;
  needByDate: string | null;
  expectedClearDate: string | null;
  purpose: string | null;
  currency: string | null;
  amount: number | null;
  exchangeRate: number | null;
  baseAmount: number | null;       // จำนวนเงินที่เบิก Advance (THB)
  approvedName: string | null;
  approvedDate: string | null;
  approvedRemark: string | null;
  actionedByName: string | null;
  actionedDate: string | null;
  actionedRemark: string | null;
  paymentDate: string | null;
  clearAdvanceNo: string | null;   // AP-3 clearing document no. (ADC…) linked back
  advanceStatus: string | null;    // AP-3 clearing status label
  pendingOn: string | null;
  overallStatus: string;
  /** BC interface state — null or 'Failed' means it still has to be sent. */
  erpInterfaceStatus: string | null;
}

/**
 * A DATE column as YYYY-MM-DD, read with **local** getters.
 *
 * `toISOString()` converts to UTC, and the server runs Thai time (UTC+7), so a
 * date-only column came back a day early: 2026-08-31 arrives as midnight local,
 * becomes 2026-08-30T17:00Z, and sliced to a day that is simply wrong. Every
 * date in this report was off by one. `advance-request-service.toYmd` has always
 * done it this way; this matches it.
 */
const ymd = (d: unknown) => {
  if (!d) return null;
  const dt = new Date(d as string);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};
const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : null);
const num = (v: unknown) => (v == null ? null : Number(v));

function overall(status: string): string {
  switch (status) {
    case "Submitted": return "Inprocess (อยู่ระหว่างอนุมัติ)";
    case "Approved": return "อนุมัติแล้ว (Completed)";
    case "Rejected": return "ไม่อนุมัติ (Rejected)";
    case "Cancelled": return "ยกเลิก (Canceled)";
    case "Returned": return "ส่งกลับแก้ไข (Returned)";
    default: return status;
  }
}

/** Status of the AP-3 clearing document that settled this advance. */
function clearLabel(status: string): string {
  if (status === "Approved") return "เคลียร์แล้ว (Cleared)";
  if (status === "Submitted" || status === "ManagerApproved") return "กำลังเคลียร์";
  if (status === "Returned") return "ส่งกลับแก้ไข";
  return overall(status);
}

/** All AP-2 requests (excluding drafts) with the control-report columns. */
export async function listAdvanceReport(): Promise<AdvanceReportRow[]> {
  const pool = await getAccPool();

  const head = await pool.request().input("form", sql.NVarChar, AP2_FORM_CODE).query(`
    SELECT r.Id, r.RequestNo, r.SubmittedAt, r.StaffId, r.RequesterFullName, r.RequesterPosition,
           r.RequesterDepartmentName, r.Status, r.CurrentStepCode, r.PaymentDate,
           r.ErpInterfaceStatus,
           a.PayeeType, a.PayeeName, a.PayeeBankAccount, a.PayeeBankCode, bm.BankName,
           hr.BankAccountNo AS HrBankAccount,
           a.NeedByDate, a.ExpectedClearDate, a.Purpose, a.Currency, a.Amount, a.ExchangeRate, a.BaseAmount
    FROM [dbo].[AccRequest] r
    LEFT JOIN [dbo].[AccAdvance] a ON a.RequestId = r.Id
    LEFT JOIN [dbo].[AccBankMaster] bm ON bm.BankCode = a.PayeeBankCode
    LEFT JOIN ${hrEmployeeTable()} hr ON hr.StaffId = r.StaffId AND hr.Status = N'Active'
    WHERE r.FormCode = @form AND r.Status <> 'Draft'
    ORDER BY r.SubmittedAt DESC, r.Id DESC`);

  const rows = head.recordset as Record<string, unknown>[];
  if (rows.length === 0) return [];

  // Approval chain for all listed requests, with the actioner's HR name.
  const ids = rows.map((r) => r.Id as number);
  const aRes = await pool.request().query(`
    SELECT ap.RequestId, ap.StepType, ap.StepOrder, ap.Status, ap.Comment, ap.ActionedAt,
           COALESCE(NULLIF(LTRIM(RTRIM(CONCAT(e.FirstName, N' ', e.LastName))), N''), e.FullName) AS ActionedByName
    FROM [dbo].[AccAdvanceApproval] ap
    LEFT JOIN ${hrEmployeeTable()} e ON e.StaffId = ap.ActionedByStaffId AND e.Status = N'Active'
    WHERE ap.RequestId IN (${ids.join(",")})
    ORDER BY ap.RequestId, ap.StepOrder`);

  const byReq = new Map<number, Record<string, unknown>[]>();
  for (const a of aRes.recordset as Record<string, unknown>[]) {
    const rid = a.RequestId as number;
    (byReq.get(rid) ?? byReq.set(rid, []).get(rid)!).push(a);
  }

  // AP-3 clearing (ADC no. + status) linked back per advance. Wrapped so a
  // Production DB without the AccClearAdvance table (AP-3 not deployed there)
  // leaves the clearing columns blank instead of breaking the whole report.
  const clearByAdvance = new Map<number, { no: string | null; status: string | null }>();
  try {
    const cRes = await pool.request().query(`
      SELECT c.AdvanceRequestId, cr.RequestNo AS ClearNo, cr.Status AS ClearStatus
      FROM [dbo].[AccClearAdvance] c
      JOIN [dbo].[AccRequest] cr ON cr.Id = c.RequestId
      WHERE c.AdvanceRequestId IN (${ids.join(",")})
        AND cr.FormCode = 'AP-3' AND cr.Status NOT IN ('Cancelled','Draft')
      ORDER BY cr.Id DESC`);
    for (const c of cRes.recordset as Record<string, unknown>[]) {
      const advId = c.AdvanceRequestId as number;
      if (!clearByAdvance.has(advId)) {
        clearByAdvance.set(advId, { no: (c.ClearNo as string) ?? null, status: (c.ClearStatus as string) ?? null });
      }
    }
  } catch { /* AccClearAdvance absent (Production before AP-3) — clearing stays blank */ }

  return rows.map((r) => {
    const id = r.Id as number;
    const clr = clearByAdvance.get(id);
    const steps = byReq.get(id) ?? [];
    const approvedSteps = steps.filter((s) => s.Status === "Approved");
    const lastApproved = approvedSteps[approvedSteps.length - 1] ?? null;
    // Most recent action of any kind (approved / rejected / returned).
    const actioned = steps
      .filter((s) => s.ActionedAt)
      .sort((a, b) => new Date(b.ActionedAt as string).getTime() - new Date(a.ActionedAt as string).getTime())[0] ?? null;
    const pending = steps.find((s) => s.Status === "Pending") ?? null;
    const pendingType = (pending?.StepType as StepType) ?? (r.CurrentStepCode as StepType) ?? null;

    return {
      id,
      submittedAt: iso(r.SubmittedAt),
      requestNo: (r.RequestNo as string) ?? null,
      staffId: (r.StaffId as number) ?? null,
      requesterName: (r.RequesterFullName as string) ?? null,
      position: (r.RequesterPosition as string) ?? null,
      department: (r.RequesterDepartmentName as string) ?? null,
      payeeType: r.PayeeType === "vendor" ? "คู่ค้า" : r.PayeeType === "employee" ? "พนักงาน" : null,
      payeeName: (r.PayeeName as string) ?? null,
      // Vendor: บัญชี/ธนาคารจากที่กรอก · พนักงาน: เลขบัญชีดึงจาก HR Master (ธนาคารไม่มีใน HR)
      bankAccount: r.PayeeType === "vendor"
        ? ((r.PayeeBankAccount as string) ?? null)
        : ((r.HrBankAccount as string) ?? null),
      bankName: r.PayeeType === "vendor"
        ? ((r.BankName as string) ?? (r.PayeeBankCode as string) ?? null)
        : null,
      needByDate: ymd(r.NeedByDate),
      expectedClearDate: ymd(r.ExpectedClearDate),
      purpose: (r.Purpose as string) ?? null,
      currency: (r.Currency as string) ?? null,
      amount: num(r.Amount),
      exchangeRate: num(r.ExchangeRate),
      baseAmount: num(r.BaseAmount),
      approvedName: (lastApproved?.ActionedByName as string) ?? null,
      approvedDate: lastApproved ? iso(lastApproved.ActionedAt) : null,
      approvedRemark: (lastApproved?.Comment as string) ?? null,
      actionedByName: (actioned?.ActionedByName as string) ?? null,
      actionedDate: actioned ? iso(actioned.ActionedAt) : null,
      actionedRemark: (actioned?.Comment as string) ?? null,
      paymentDate: ymd(r.PaymentDate),
      clearAdvanceNo: clr?.no ?? null,
      advanceStatus: clr?.status ? clearLabel(clr.status) : null,
      pendingOn: r.Status === "Submitted" && pendingType ? (STEP_LABEL[pendingType] ?? pendingType) : null,
      overallStatus: overall(r.Status as string),
      // "Approved but not yet in BC" cannot be derived from the two status
      // fields above: such a request reads as อนุมัติแล้ว with nothing pending,
      // which is indistinguishable from one already sent.
      erpInterfaceStatus: (r.ErpInterfaceStatus as string) ?? null,
    };
  });
}
