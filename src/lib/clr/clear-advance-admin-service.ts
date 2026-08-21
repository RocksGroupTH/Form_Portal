import { getAccPool, sql } from "@/lib/acc/pool";
import { fixThaiDate, getAppPool } from "@/lib/db/mssql";
import { loadErpJournalBuildContext } from "@/lib/acc/erp-journal-context";
import { AP3_FORM_CODE } from "@/features/clear-advance/constants";

/** DB holding the synced BC chart of accounts (per Brand/Company). */
const ERP_DATA_DB = process.env.MSSQL_ERP_DATA_DATABASE || "Rocks_ERP_Data";

export interface ErpGlOption { accountNo: string; displayName: string | null }

/**
 * Active GL accounts for a claim brand, read from Rocks_ERP_Data.dbo.ErpAccounts.
 * The brand resolves to its target Company via AP-1's interfaceByClaim map
 * (e.g. ROCKS → PCTH), since ErpAccounts is keyed by Company.
 */
export async function listClrErpGlOptions(brandCode: string): Promise<ErpGlOption[]> {
  const brand = brandCode.trim().toUpperCase();
  if (!brand) return [];
  const ctx = await loadErpJournalBuildContext();
  const company = (ctx.interfaceByClaim[brand] ?? brand).toUpperCase();
  const pool = await getAppPool(ERP_DATA_DB);
  const r = await pool.request()
    .input("brand", sql.NVarChar, company)
    .query(`
      SELECT AccountNo, DisplayName FROM [dbo].[ErpAccounts]
      WHERE AccountCategory = 'GL' AND BrandCode = @brand
        AND IsActive = 1 AND (IsBlocked = 0 OR IsBlocked IS NULL)
      ORDER BY AccountNo
    `);
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    accountNo: x.AccountNo as string,
    displayName: (x.DisplayName as string) ?? null,
  }));
}

export interface ErpJournalBatchOption { batchName: string; displayName: string | null; templateName: string | null }

/**
 * Active General Journal Batches for a claim brand, read from
 * Rocks_ERP_Data.dbo.ErpGeneralJournalBatch (keyed by Company). Brand resolves to
 * its target Company via interfaceByClaim (e.g. ROCKS → PCTH).
 */
/**
 * Journal Batches for an already-resolved target Company (e.g. PCTH), read
 * directly from Rocks_ERP_Data — no brand→Company resolution. AP-3's settings
 * card passes the Company it inherits from AP-2 (interfaceTarget) so the batch
 * list always matches the Company shown on the card.
 */
export async function listClrErpJournalBatchesForCompany(company: string): Promise<ErpJournalBatchOption[]> {
  const c = company.trim().toUpperCase();
  if (!c) return [];
  const pool = await getAppPool(ERP_DATA_DB);
  const r = await pool.request()
    .input("company", sql.NVarChar, c)
    .query(`
      SELECT BatchName, DisplayName, TemplateName FROM [dbo].[ErpGeneralJournalBatch]
      WHERE BrandCode = @company AND IsActive = 1 AND (IsBlocked = 0 OR IsBlocked IS NULL)
      ORDER BY BatchName
    `);
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    batchName: x.BatchName as string,
    displayName: (x.DisplayName as string) ?? null,
    templateName: (x.TemplateName as string) ?? null,
  }));
}

export async function listClrErpJournalBatches(brandCode: string): Promise<ErpJournalBatchOption[]> {
  const brand = brandCode.trim().toUpperCase();
  if (!brand) return [];
  const ctx = await loadErpJournalBuildContext();
  const company = (ctx.interfaceByClaim[brand] ?? brand).toUpperCase();
  return listClrErpJournalBatchesForCompany(company);
}

export interface ErpBranchOption { code: string; displayName: string | null }

/** Active, non-blocked BRANCH dimension values for a Company, from Rocks_ERP_Data. */
export async function listClrErpBranchesForCompany(company: string): Promise<ErpBranchOption[]> {
  const c = company.trim().toUpperCase();
  if (!c) return [];
  const pool = await getAppPool(ERP_DATA_DB);
  const r = await pool.request()
    .input("company", sql.NVarChar, c)
    .query(`
      SELECT Code, DisplayName FROM [dbo].[ErpDimensionValue]
      WHERE BrandCode = @company AND DimensionCode = 'BRANCH'
        AND IsActive = 1 AND (IsBlocked = 0 OR IsBlocked IS NULL)
      ORDER BY Code
    `);
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    code: x.Code as string,
    displayName: (x.DisplayName as string) ?? null,
  }));
}

/**
 * BRANCH options for a claim brand — resolves brand → target Company via
 * interfaceByClaim (e.g. ROCKS → PCTH), then reads Rocks_ERP_Data.ErpDimensionValue.
 */
export async function listClrErpBranchOptions(brandCode: string): Promise<ErpBranchOption[]> {
  const brand = brandCode.trim().toUpperCase();
  if (!brand) return [];
  const ctx = await loadErpJournalBuildContext();
  const company = (ctx.interfaceByClaim[brand] ?? brand).toUpperCase();
  return listClrErpBranchesForCompany(company);
}

function num(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

/* ─────────────────────────── AP-3.2 G/L master ─────────────────────────── */

export interface GlAccountRow {
  id: number;
  glAccountNo: string;
  nameTh: string | null;
  nameEn: string | null;
  dimensionType: "Employee" | "Branch" | "Both";
  isActive: boolean;
  sortOrder: number;
}

/** All G/L accounts (incl. inactive) for the settings page. */
export async function listGlAccountsAll(): Promise<GlAccountRow[]> {
  const pool = await getAccPool();
  const res = await pool.request()
    .query(`SELECT Id, GlAccountNo, NameTh, NameEn, DimensionType, IsActive, SortOrder
            FROM [dbo].[AccClearAdvanceGl] ORDER BY SortOrder, GlAccountNo`);
  return (res.recordset as Record<string, unknown>[]).map((r) => ({
    id: r.Id as number,
    glAccountNo: r.GlAccountNo as string,
    nameTh: (r.NameTh as string) ?? null,
    nameEn: (r.NameEn as string) ?? null,
    dimensionType: (r.DimensionType as GlAccountRow["dimensionType"]) ?? "Employee",
    isActive: !!r.IsActive,
    sortOrder: (r.SortOrder as number) ?? 0,
  }));
}

/** Create or update an AP-3.2 G/L account. */
export async function upsertGlAccount(
  input: {
    id?: number;
    glAccountNo: string;
    nameTh?: string | null;
    nameEn?: string | null;
    dimensionType: "Employee" | "Branch" | "Both";
    isActive?: boolean;
    sortOrder?: number;
  },
): Promise<void> {
  const glNo = input.glAccountNo.trim();
  if (!glNo) throw new Error("กรุณากรอกเลขที่บัญชี G/L");
  if (!["Employee", "Branch", "Both"].includes(input.dimensionType)) {
    throw new Error("ประเภท Dimension ไม่ถูกต้อง");
  }
  const pool = await getAccPool();
  const active = input.isActive === false ? 0 : 1;

  if (input.id) {
    await pool.request()
      .input("id", sql.Int, input.id)
      .input("no", sql.NVarChar, glNo)
      .input("th", sql.NVarChar, input.nameTh ?? null)
      .input("en", sql.NVarChar, input.nameEn ?? null)
      .input("dim", sql.NVarChar, input.dimensionType)
      .input("active", sql.Bit, active)
      .input("sort", sql.Int, input.sortOrder ?? 0)
      .query(`UPDATE [dbo].[AccClearAdvanceGl]
              SET GlAccountNo=@no, NameTh=@th, NameEn=@en, DimensionType=@dim,
                  IsActive=@active, SortOrder=@sort, UpdatedAt=SYSDATETIME()
              WHERE Id=@id`);
  } else {
    const dupe = await pool.request().input("no", sql.NVarChar, glNo)
      .query(`SELECT TOP 1 Id FROM [dbo].[AccClearAdvanceGl] WHERE GlAccountNo=@no`);
    if (dupe.recordset.length > 0) throw new Error("เลขที่บัญชีนี้มีอยู่แล้ว");
    await pool.request()
      .input("no", sql.NVarChar, glNo)
      .input("th", sql.NVarChar, input.nameTh ?? null)
      .input("en", sql.NVarChar, input.nameEn ?? null)
      .input("dim", sql.NVarChar, input.dimensionType)
      .input("active", sql.Bit, active)
      .input("sort", sql.Int, input.sortOrder ?? 0)
      .query(`INSERT INTO [dbo].[AccClearAdvanceGl] (GlAccountNo, NameTh, NameEn, DimensionType, IsActive, SortOrder)
              VALUES (@no, @th, @en, @dim, @active, @sort)`);
  }
}

/* ─────────────────────────── approvals queue ─────────────────────────── */

export interface ClrQueueRow {
  id: number;
  requestNo: string | null;
  submittedAt: string | null;
  currentStepCode: string | null;
  stepLabel: string;
  requesterFullName: string | null;
  requesterDepartmentName: string | null;
  brandCode: string | null;
  advanceRequestNo: string | null;
  actualTotal: number | null;
  refundToCompany: number | null;
}

const STEP_LABEL: Record<string, string> = {
  MANAGER: "ผู้จัดการ", ACCOUNT: "บัญชี", HEAD: "หัวหน้าบัญชี",
};

/**
 * AP-3 requests currently in the approval flow (Status='Submitted').
 * `step` optionally narrows to one step (ACCOUNT / HEAD) for a role's queue.
 */
export async function listApprovalQueue(step?: string | null): Promise<ClrQueueRow[]> {
  const pool = await getAccPool();
  const r = pool.request().input("form", sql.NVarChar, AP3_FORM_CODE);
  let stepClause = "";
  if (step === "ACCOUNT" || step === "HEAD" || step === "MANAGER") {
    r.input("step", sql.NVarChar, step);
    stepClause = "AND req.CurrentStepCode = @step";
  }
  const res = await r.query(`
    SELECT req.Id, req.RequestNo, req.SubmittedAt, req.CurrentStepCode, req.BrandCode,
           req.RequesterFullName, req.RequesterDepartmentName,
           c.AdvanceRequestNo, c.ActualTotal, c.RefundToCompany
    FROM [dbo].[AccRequest] req
    LEFT JOIN [dbo].[AccClearAdvance] c ON c.RequestId = req.Id
    WHERE req.FormCode = @form AND req.Status = 'Submitted' ${stepClause}
    ORDER BY req.SubmittedAt ASC, req.Id ASC
  `);
  return (res.recordset as Record<string, unknown>[]).map((x) => {
    const stepCode = (x.CurrentStepCode as string) ?? null;
    return {
      id: x.Id as number,
      requestNo: (x.RequestNo as string) ?? null,
      submittedAt: x.SubmittedAt ? fixThaiDate(x.SubmittedAt as Date)!.toISOString() : null,
      currentStepCode: stepCode,
      stepLabel: stepCode ? (STEP_LABEL[stepCode] ?? stepCode) : "-",
      requesterFullName: (x.RequesterFullName as string) ?? null,
      requesterDepartmentName: (x.RequesterDepartmentName as string) ?? null,
      brandCode: (x.BrandCode as string) ?? null,
      advanceRequestNo: (x.AdvanceRequestNo as string) ?? null,
      actualTotal: num(x.ActualTotal),
      refundToCompany: num(x.RefundToCompany),
    };
  });
}
