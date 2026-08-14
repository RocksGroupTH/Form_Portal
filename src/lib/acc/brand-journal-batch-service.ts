import { getAccPool, sql } from "@/lib/acc/pool";
import { writeBothPools } from "@/lib/acc/dual-write";
import { AP1_FORM_CODE } from "@/features/accounting/constants";
import { getAllowedBrands } from "@/lib/acc/brand-options";
import { isErpInterfaceBrandCode } from "@/lib/acc/erp-interface-brands";

async function assertJournalBrandAllowed(brandCode: string): Promise<void> {
  const code = brandCode.trim().toUpperCase();
  if (isErpInterfaceBrandCode(code)) return;
  const allowed = await getAllowedBrands(AP1_FORM_CODE);
  const ok = allowed.some((b) => b.brandCode.toUpperCase() === code);
  if (!ok) throw new Error("แบรนด์นี้ไม่ได้เปิดใช้ใน AP-1");
}

export interface BrandJournalBatchRow {
  id: number;
  brandCode: string;
  batchName: string;
  displayName: string | null;
  isActive: boolean;
  sortOrder: number;
}

function mapRow(x: Record<string, unknown>): BrandJournalBatchRow {
  return {
    id: x.Id as number,
    brandCode: x.BrandCode as string,
    batchName: x.BatchName as string,
    displayName: (x.DisplayName as string) ?? null,
    isActive: !!x.IsActive,
    sortOrder: x.SortOrder as number,
  };
}

export async function listBrandJournalBatches(
  brandCode?: string | null,
): Promise<BrandJournalBatchRow[]> {
  const pool = await getAccPool();
  const req = pool.request();
  let where = "";
  if (brandCode) {
    req.input("brand", sql.NVarChar, brandCode);
    where = "WHERE BrandCode = @brand";
  }
  const r = await req.query(`
    SELECT Id, BrandCode, BatchName, DisplayName, IsActive, SortOrder
    FROM [dbo].[AccBrandJournalBatch]
    ${where}
    ORDER BY BrandCode, SortOrder, BatchName
  `);
  return r.recordset.map(mapRow);
}

export async function upsertBrandJournalBatch(
  input: {
    id?: number;
    brandCode: string;
    batchName: string;
    displayName?: string | null;
    isActive?: boolean;
    sortOrder?: number;
  },
  userId: number,
): Promise<void> {
  const batchName = input.batchName.trim();
  const brandCode = input.brandCode.trim().toUpperCase();
  if (!brandCode) throw new Error("กรุณาเลือกแบรนด์");
  await assertJournalBrandAllowed(brandCode);
  if (!batchName) throw new Error("กรุณาเลือก Journal Batch");

  const pool = await getAccPool();
  let rowId = input.id;
  if (rowId == null) {
    const existing = await pool
      .request()
      .input("brand", sql.NVarChar, brandCode).query(`
        SELECT TOP 1 Id FROM [dbo].[AccBrandJournalBatch]
        WHERE BrandCode = @brand
        ORDER BY SortOrder, Id
      `);
    rowId = (existing.recordset[0] as { Id: number } | undefined)?.Id;
  }

  await writeBothPools(async (tx) => {
    const req = tx
      .request()
      .input("brand", sql.NVarChar, brandCode)
      .input("batchName", sql.NVarChar, batchName)
      .input("displayName", sql.NVarChar, input.displayName?.trim() || null)
      .input("active", sql.Bit, input.isActive === false ? 0 : 1)
      .input("sort", sql.Int, input.sortOrder ?? 0)
      .input("user", sql.Int, userId || null);

    if (rowId) {
      req.input("id", sql.Int, rowId);
      await req.query(`
      UPDATE [dbo].[AccBrandJournalBatch]
      SET BrandCode = @brand,
          BatchName = @batchName,
          DisplayName = @displayName,
          IsActive = @active,
          SortOrder = @sort,
          UpdatedAt = SYSDATETIME()
      WHERE Id = @id
    `);
    } else {
      await req.query(`
      INSERT INTO [dbo].[AccBrandJournalBatch]
        (BrandCode, BatchName, DisplayName, IsActive, SortOrder, CreatedBy)
      VALUES (@brand, @batchName, @displayName, @active, @sort, @user)
    `);
    }
  });
}
