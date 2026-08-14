import { getAccPool, sql } from "@/lib/acc/pool";
import { writeBothPools } from "@/lib/acc/dual-write";
import { isErpInterfaceBrandCode } from "@/lib/acc/erp-interface-brands";

export interface BrandErpInterfaceMapRow {
  id: number;
  brandCode: string;
  interfaceBrandCode: string;
}

function mapRow(x: Record<string, unknown>): BrandErpInterfaceMapRow {
  return {
    id: x.Id as number,
    brandCode: x.BrandCode as string,
    interfaceBrandCode: x.InterfaceBrandCode as string,
  };
}

/** All claim-brand → interface-brand mappings. */
export async function listBrandErpInterfaceMaps(): Promise<
  BrandErpInterfaceMapRow[]
> {
  const pool = await getAccPool();
  const r = await pool.request().query(`
    SELECT Id, BrandCode, InterfaceBrandCode
    FROM [dbo].[AccBrandErpInterface]
    ORDER BY BrandCode
  `);
  return r.recordset.map(mapRow);
}

export async function getBrandErpInterfaceMap(
  claimBrandCode: string,
): Promise<BrandErpInterfaceMapRow | null> {
  const pool = await getAccPool();
  const r = await pool
    .request()
    .input("brand", sql.NVarChar, claimBrandCode.trim()).query(`
      SELECT Id, BrandCode, InterfaceBrandCode
      FROM [dbo].[AccBrandErpInterface]
      WHERE BrandCode = @brand
    `);
  const row = r.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

export async function upsertBrandErpInterfaceMap(
  claimBrandCode: string,
  interfaceBrandCode: string,
  userId: number,
): Promise<BrandErpInterfaceMapRow> {
  const claim = claimBrandCode.trim().toUpperCase();
  const target = interfaceBrandCode.trim().toUpperCase();
  if (!claim) throw new Error("กรุณาระบุแบรนด์เบิก");
  if (!target) throw new Error("กรุณาเลือกแบรนด์ปลายทาง");
  if (!isErpInterfaceBrandCode(target)) {
    throw new Error(`แบรนด์ปลายทาง "${target}" ไม่มีใน Brand Config`);
  }

  const pool = await getAccPool();
  const existing = await getBrandErpInterfaceMap(claim);

  if (existing) {
    await writeBothPools(async (tx) => {
      await tx
        .request()
        .input("id", sql.Int, existing.id)
        .input("target", sql.NVarChar, target).query(`
          UPDATE [dbo].[AccBrandErpInterface]
          SET InterfaceBrandCode = @target, UpdatedAt = SYSDATETIME()
          WHERE Id = @id
        `);
    });
    return { ...existing, interfaceBrandCode: target };
  }

  // Production's OUTPUT is the return value; UAT runs the same INSERT and, with
  // both identity counters in lockstep, lands on the same Id.
  const inserted = await writeBothPools(async (tx) => {
    const ins = await tx
      .request()
      .input("brand", sql.NVarChar, claim)
      .input("target", sql.NVarChar, target)
      .input("user", sql.Int, userId || null).query(`
        INSERT INTO [dbo].[AccBrandErpInterface] (BrandCode, InterfaceBrandCode, CreatedBy)
        OUTPUT INSERTED.Id, INSERTED.BrandCode, INSERTED.InterfaceBrandCode
        VALUES (@brand, @target, @user)
      `);
    return ins.recordset[0] as Record<string, unknown>;
  });
  return mapRow(inserted);
}

export async function deleteBrandErpInterfaceMap(
  claimBrandCode: string,
): Promise<void> {
  const claim = claimBrandCode.trim().toUpperCase();
  if (!claim) throw new Error("กรุณาระบุแบรนด์เบิก");

  await writeBothPools(async (tx) => {
    await tx.request().input("brand", sql.NVarChar, claim).query(`
        DELETE FROM [dbo].[AccBrandErpInterface]
        WHERE BrandCode = @brand
      `);
  });
}
