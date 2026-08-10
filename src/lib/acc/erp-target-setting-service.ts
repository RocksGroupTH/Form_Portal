import { getAccPool, sql } from "@/lib/acc/pool";
import { ERP_INTERFACE_BRANDS } from "@/lib/acc/erp-interface-brands";

export interface ErpTargetSettingRow {
  brandCode: string;
  descriptionPrefix: string | null;
  bcUatId: string | null;
  bcUatName: string | null;
  bcUatConnectionId: number | null;
}

function mapRow(x: Record<string, unknown>): ErpTargetSettingRow {
  return {
    brandCode: (x.BrandCode as string).trim().toUpperCase(),
    descriptionPrefix: (x.DescriptionPrefix as string) ?? null,
    bcUatId: (x.BcUatId as string) ?? null,
    bcUatName: (x.BcUatName as string) ?? null,
    bcUatConnectionId: (x.BcUatConnectionId as number) ?? null,
  };
}

export async function listErpTargetSettings(): Promise<ErpTargetSettingRow[]> {
  const pool = await getAccPool();
  let rows: ErpTargetSettingRow[] = [];
  try {
    const r = await pool.request().query(`
      SELECT BrandCode, DescriptionPrefix, BcUatId, BcUatName, BcUatConnectionId
      FROM [dbo].[AccBrandErpTargetSetting]
    `);
    rows = r.recordset.map((x: Record<string, unknown>) => mapRow(x));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("BcUatId") && !msg.includes("Invalid column name")) throw err;
    const r = await pool.request().query(`
      SELECT BrandCode, DescriptionPrefix FROM [dbo].[AccBrandErpTargetSetting]
    `);
    rows = r.recordset.map((x: Record<string, unknown>) => ({
      brandCode: (x.BrandCode as string).trim().toUpperCase(),
      descriptionPrefix: (x.DescriptionPrefix as string) ?? null,
      bcUatId: null,
      bcUatName: null,
      bcUatConnectionId: null,
    }));
  }

  const byCode = new Map(rows.map((row) => [row.brandCode, row]));
  return ERP_INTERFACE_BRANDS.map((b) => {
    const code = b.id.toUpperCase();
    return byCode.get(code) ?? {
      brandCode: code,
      descriptionPrefix: null,
      bcUatId: null,
      bcUatName: null,
      bcUatConnectionId: null,
    };
  });
}

export async function upsertErpTargetUatSetting(
  brandCode: string,
  patch: {
    bcUatId?: string | null;
    bcUatName?: string | null;
    bcUatConnectionId?: number | null;
  },
  userId: number,
): Promise<void> {
  const code = brandCode.trim().toUpperCase();
  const pool = await getAccPool();

  const existing = await pool.request()
    .input("code", sql.NVarChar, code)
    .query(`SELECT Id FROM [dbo].[AccBrandErpTargetSetting] WHERE BrandCode = @code`);

  const bcUatId = patch.bcUatId !== undefined ? (patch.bcUatId?.trim() || null) : undefined;
  const bcUatName = patch.bcUatName !== undefined ? (patch.bcUatName?.trim() || null) : undefined;
  const bcUatConnectionId =
    patch.bcUatConnectionId !== undefined ? patch.bcUatConnectionId : undefined;

  if (existing.recordset.length === 0) {
    await pool.request()
      .input("code", sql.NVarChar, code)
      .input("uatId", sql.NVarChar, bcUatId ?? null)
      .input("uatName", sql.NVarChar, bcUatName ?? null)
      .input("uatConn", sql.Int, bcUatConnectionId ?? null)
      .input("user", sql.Int, userId || null)
      .query(`
        INSERT INTO [dbo].[AccBrandErpTargetSetting]
          (BrandCode, BcUatId, BcUatName, BcUatConnectionId, CreatedBy)
        VALUES (@code, @uatId, @uatName, @uatConn, @user)
      `);
    return;
  }

  const sets: string[] = ["UpdatedAt = SYSDATETIME()"];
  const req = pool.request().input("code", sql.NVarChar, code);
  if (bcUatId !== undefined) {
    req.input("uatId", sql.NVarChar, bcUatId);
    sets.push("BcUatId = @uatId");
  }
  if (bcUatName !== undefined) {
    req.input("uatName", sql.NVarChar, bcUatName);
    sets.push("BcUatName = @uatName");
  }
  if (bcUatConnectionId !== undefined) {
    req.input("uatConn", sql.Int, bcUatConnectionId);
    sets.push("BcUatConnectionId = @uatConn");
  }
  await req.query(`
    UPDATE [dbo].[AccBrandErpTargetSetting]
    SET ${sets.join(", ")}
    WHERE BrandCode = @code
  `);
}
