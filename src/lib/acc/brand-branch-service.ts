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

async function assertClaimBrandAllowed(brandCode: string): Promise<void> {
  const allowed = await getAllowedBrands(AP1_FORM_CODE);
  const ok = allowed.some(
    (b) => b.brandCode.toUpperCase() === brandCode.toUpperCase(),
  );
  if (!ok) throw new Error("แบรนด์นี้ไม่ได้เปิดใช้ใน AP-1");
}

async function resolveInterfaceBrandForClaim(
  brandCode: string,
): Promise<string | null> {
  const pool = await getAccPool();
  const r = await pool
    .request()
    .input("brand", sql.NVarChar, brandCode.trim().toUpperCase()).query(`
      SELECT InterfaceBrandCode
      FROM [dbo].[AccBrandErpInterface]
      WHERE BrandCode = @brand
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
  };
}

export async function listBrandBranches(
  brandCode?: string | null,
): Promise<BrandBranchRow[]> {
  const pool = await getAccPool();
  const req = pool.request();
  let where = "";
  if (brandCode) {
    req.input("brand", sql.NVarChar, brandCode);
    where = "WHERE BrandCode = @brand";
  }
  const r = await req.query(`
    SELECT Id, BrandCode, BranchCode, DisplayName, DeptAsBranch, FixedErpDeptCode, IsActive, SortOrder
    FROM [dbo].[AccBrandBranchCode]
    ${where}
    ORDER BY BrandCode, SortOrder, BranchCode
  `);
  return r.recordset.map(mapRow);
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
  let rowId = input.id;
  if (rowId == null) {
    const existing = await pool
      .request()
      .input("brand", sql.NVarChar, brandCode).query(`
        SELECT TOP 1 Id FROM [dbo].[AccBrandBranchCode]
        WHERE BrandCode = @brand
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
      WHERE Id = @id
    `);
    } else {
      await req.query(`
      INSERT INTO [dbo].[AccBrandBranchCode]
        (BrandCode, BranchCode, DisplayName, DeptAsBranch, FixedErpDeptCode, IsActive, SortOrder, CreatedBy)
      VALUES (@brand, @branchCode, @displayName, @deptAsBranch, @fixedErpDept, @active, @sort, @user)
    `);
    }
  });

  deleteAccCachedByPrefix("acc:journal-ctx:");
}
