import { getAccPool, sql } from "@/lib/acc/pool";
import { writeBothPools } from "@/lib/acc/dual-write";
import { AP1_FORM_CODE } from "@/features/accounting/constants";
import { getAllowedBrands } from "@/lib/acc/brand-options";
import { deleteAccCachedByPrefix } from "@/lib/acc/acc-cache";
import {
  erpDimensionHasCode,
  listErpDimensionOptions,
  HR_DEPARTMENT_DIMENSION_CODE,
} from "@/lib/erp/dimension-sync";
import {
  defaultsOnly,
  perFormOrderBy,
  perFormPredicate,
  perFormWriteMatch,
  pickAllForForm,
} from "@/lib/acc/per-form-config";

async function assertClaimBrandAllowed(brandCode: string): Promise<void> {
  const allowed = await getAllowedBrands(AP1_FORM_CODE);
  const ok = allowed.some(
    (b) => b.brandCode.toUpperCase() === brandCode.toUpperCase(),
  );
  if (!ok) throw new Error("แบรนด์นี้ไม่ได้เปิดใช้ใน AP-1");
}

/**
 * A second read of `AccBrandErpInterface`, living here rather than in the
 * interface-map service. It validates the Fix Dept an editor is saving, so it
 * resolves the default — the same row the editor's own target dropdown shows.
 * Reduced by `TOP 1`; bounded, so an override cannot answer for the default.
 */
async function resolveInterfaceBrandForClaim(
  brandCode: string,
): Promise<string | null> {
  const pool = await getAccPool();
  const r = await pool
    .request()
    .input("brand", sql.NVarChar, brandCode.trim().toUpperCase()).query(`
      SELECT TOP 1 InterfaceBrandCode
      FROM [dbo].[AccBrandErpInterface]
      WHERE BrandCode = @brand AND ${perFormWriteMatch(null)}
      ORDER BY ${perFormOrderBy()}
    `);
  const row = r.recordset[0] as { InterfaceBrandCode: string } | undefined;
  return row?.InterfaceBrandCode?.trim().toUpperCase() ?? null;
}

export interface BrandBranchRow {
  id: number;
  brandCode: string;
  branchCode: string;
  displayName: string | null;
  deptAsBranch: boolean;
  fixedErpDeptCode: string | null;
  isActive: boolean;
  sortOrder: number;
  /** `null` is the default, which answers every form. */
  formCode: string | null;
}

function mapRow(x: Record<string, unknown>): BrandBranchRow {
  return {
    id: x.Id as number,
    brandCode: x.BrandCode as string,
    branchCode: x.BranchCode as string,
    displayName: (x.DisplayName as string) ?? null,
    deptAsBranch: !!x.DeptAsBranch,
    fixedErpDeptCode: (x.FixedErpDeptCode as string) ?? null,
    isActive: !!x.IsActive,
    sortOrder: x.SortOrder as number,
    // Never absent — see the note in brand-erp-interface-map-service.
    formCode: (x.FormCode as string | null) ?? null,
  };
}

/**
 * With `formCode`, this form's branch codes; without, the defaults alone.
 * Picked per `(BrandCode, BranchCode)` — the unique index minus `FormCode`.
 */
export async function listBrandBranches(
  brandCode?: string | null,
  formCode?: string,
): Promise<BrandBranchRow[]> {
  const pool = await getAccPool();
  const req = pool.request();
  const conditions: string[] = [];
  if (brandCode) {
    req.input("brand", sql.NVarChar, brandCode);
    conditions.push("BrandCode = @brand");
  }
  if (formCode) {
    req.input("formCode", sql.NVarChar(20), formCode);
    conditions.push(perFormPredicate());
  } else {
    conditions.push("FormCode IS NULL");
  }
  const r = await req.query(`
    SELECT Id, BrandCode, BranchCode, DisplayName, DeptAsBranch, FixedErpDeptCode, IsActive, SortOrder, FormCode
    FROM [dbo].[AccBrandBranchCode]
    WHERE ${conditions.join(" AND ")}
    ORDER BY BrandCode, SortOrder, BranchCode, ${perFormOrderBy()}
  `);
  const rows = r.recordset.map(mapRow);
  return formCode
    ? pickAllForForm(
        rows,
        formCode,
        // See brand-account-service for why the key is JSON.
        (row) => JSON.stringify([row.brandCode.toUpperCase(), row.branchCode]),
      )
    : defaultsOnly(rows);
}

async function assertFixedErpDeptInErp(
  interfaceBrandCode: string,
  erpDeptCode: string,
): Promise<void> {
  const departments = await listErpDimensionOptions(
    interfaceBrandCode,
    HR_DEPARTMENT_DIMENSION_CODE,
  );
  if (!erpDimensionHasCode(departments, erpDeptCode)) {
    throw new Error(
      `ไม่พบ Department "${erpDeptCode.trim()}" ใน ERP — กรุณา Sync ERP หรือเลือกรหัสอื่น`,
    );
  }
}

export async function upsertBrandBranch(
  input: {
    id?: number;
    brandCode: string;
    branchCode: string;
    displayName?: string | null;
    deptAsBranch?: boolean;
    fixedErpDeptCode?: string | null;
    isActive?: boolean;
    sortOrder?: number;
  },
  userId: number,
): Promise<void> {
  const branchCode = input.branchCode.trim();
  const brandCode = input.brandCode.trim().toUpperCase();
  const deptAsBranch = !!input.deptAsBranch;
  const fixedErpDeptCode = input.fixedErpDeptCode?.trim() || null;
  if (!brandCode) throw new Error("กรุณาเลือกแบรนด์");
  await assertClaimBrandAllowed(brandCode);
  if (!branchCode) throw new Error("กรุณาเลือก Branch Code");

  if (deptAsBranch) {
    if (!fixedErpDeptCode) {
      throw new Error("กรุณาเลือก Fix Dept");
    }
    const interfaceBrand = await resolveInterfaceBrandForClaim(brandCode);
    if (!interfaceBrand) {
      throw new Error("กรุณาเลือกแบรนด์ปลายทางก่อนกำหนด Dept จาก ERP");
    }
    await assertFixedErpDeptInErp(interfaceBrand, fixedErpDeptCode);
  }

  const pool = await getAccPool();
  // Bounded to the default — the editor has no form selector, and an unbounded
  // probe could land on an override and rewrite another form's branch code.
  let rowId = input.id;
  if (rowId == null) {
    const existing = await pool
      .request()
      .input("brand", sql.NVarChar, brandCode).query(`
        SELECT TOP 1 Id FROM [dbo].[AccBrandBranchCode]
        WHERE BrandCode = @brand AND ${perFormWriteMatch(null)}
        ORDER BY SortOrder, Id
      `);
    rowId = (existing.recordset[0] as { Id: number } | undefined)?.Id;
  }

  await writeBothPools(async (tx) => {
    const req = tx
      .request()
      .input("brand", sql.NVarChar, brandCode)
      .input("branchCode", sql.NVarChar, branchCode)
      .input("displayName", sql.NVarChar, input.displayName?.trim() || null)
      .input("deptAsBranch", sql.Bit, deptAsBranch ? 1 : 0)
      .input(
        "fixedErpDept",
        sql.NVarChar,
        deptAsBranch ? fixedErpDeptCode : null,
      )
      .input("active", sql.Bit, input.isActive === false ? 0 : 1)
      .input("sort", sql.Int, input.sortOrder ?? 0)
      .input("user", sql.Int, userId || null);

    if (rowId) {
      req.input("id", sql.Int, rowId);
      await req.query(`
      UPDATE [dbo].[AccBrandBranchCode]
      SET BrandCode = @brand,
          BranchCode = @branchCode,
          DisplayName = @displayName,
          DeptAsBranch = @deptAsBranch,
          FixedErpDeptCode = @fixedErpDept,
          IsActive = @active,
          SortOrder = @sort,
          UpdatedAt = SYSDATETIME()
      -- Bounded to the default as well as the id. The row id arrives from the
      -- request body, and this editor only ever edits the default, so an id
      -- naming an override must not be updatable through it.
      WHERE Id = @id AND ${perFormWriteMatch(null)}
    `);
    } else {
      await req.query(`
      INSERT INTO [dbo].[AccBrandBranchCode]
        (BrandCode, BranchCode, DisplayName, DeptAsBranch, FixedErpDeptCode, IsActive, SortOrder, FormCode, CreatedBy)
      VALUES (@brand, @branchCode, @displayName, @deptAsBranch, @fixedErpDept, @active, @sort, NULL, @user)
    `);
    }
  });

  deleteAccCachedByPrefix("acc:journal-ctx:");
}
