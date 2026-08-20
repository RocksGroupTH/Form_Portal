import { getAccPool, sql } from "@/lib/acc/pool";
import { writeBothPools } from "@/lib/acc/dual-write";
import { ERP_INTERFACE_BRANDS } from "@/lib/acc/erp-interface-brands";
import {
  defaultsOnly,
  perFormOrderBy,
  perFormPredicate,
  perFormWriteMatch,
  pickAllForForm,
} from "@/lib/acc/per-form-config";

export interface ErpTargetSettingRow {
  brandCode: string;
  descriptionPrefix: string | null;
  bcUatId: string | null;
  bcUatName: string | null;
  bcUatConnectionId: number | null;
  /** `null` is the default, which answers every form. */
  formCode: string | null;
}

function mapRow(x: Record<string, unknown>): ErpTargetSettingRow {
  return {
    brandCode: (x.BrandCode as string).trim().toUpperCase(),
    descriptionPrefix: (x.DescriptionPrefix as string) ?? null,
    bcUatId: (x.BcUatId as string) ?? null,
    bcUatName: (x.BcUatName as string) ?? null,
    bcUatConnectionId: (x.BcUatConnectionId as number) ?? null,
    // Never absent — see the note in brand-erp-interface-map-service.
    formCode: (x.FormCode as string | null) ?? null,
  };
}

/**
 * With `formCode`, this form's target settings; without, the defaults alone.
 *
 * Always one row per ERP interface brand: a brand with no row at all is
 * synthesised empty, and a synthesised row is a default by construction.
 */
export async function listErpTargetSettings(
  formCode?: string,
): Promise<ErpTargetSettingRow[]> {
  const pool = await getAccPool();
  const bindForm = (req: ReturnType<typeof pool.request>) => {
    if (formCode) req.input("formCode", sql.NVarChar(20), formCode);
    return req;
  };
  const where = formCode ? `WHERE ${perFormPredicate()}` : "WHERE FormCode IS NULL";
  const order = `ORDER BY BrandCode, ${perFormOrderBy()}`;

  let rows: ErpTargetSettingRow[] = [];
  try {
    const r = await bindForm(pool.request()).query(`
      SELECT BrandCode, DescriptionPrefix, BcUatId, BcUatName, BcUatConnectionId, FormCode
      FROM [dbo].[AccBrandErpTargetSetting]
      ${where}
      ${order}
    `);
    rows = r.recordset.map((x: Record<string, unknown>) => mapRow(x));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("BcUatId") && !msg.includes("Invalid column name"))
      throw err;
    const r = await bindForm(pool.request()).query(`
      SELECT BrandCode, DescriptionPrefix, FormCode FROM [dbo].[AccBrandErpTargetSetting]
      ${where}
      ${order}
    `);
    rows = r.recordset.map((x: Record<string, unknown>) => ({
      brandCode: (x.BrandCode as string).trim().toUpperCase(),
      descriptionPrefix: (x.DescriptionPrefix as string) ?? null,
      bcUatId: null,
      bcUatName: null,
      bcUatConnectionId: null,
      formCode: (x.FormCode as string | null) ?? null,
    }));
  }

  // One row per brand: the unique index is (FormCode, BrandCode).
  const resolved = formCode
    ? pickAllForForm(rows, formCode, (row) => row.brandCode)
    : defaultsOnly(rows);

  const byCode = new Map(resolved.map((row) => [row.brandCode, row]));
  return ERP_INTERFACE_BRANDS.map((b) => {
    const code = b.id.toUpperCase();
    return (
      byCode.get(code) ?? {
        brandCode: code,
        descriptionPrefix: null,
        bcUatId: null,
        bcUatName: null,
        bcUatConnectionId: null,
        formCode: null,
      }
    );
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

  // The editor edits the default, so every statement below is bounded to it.
  // Unbounded, the probe could find an override and the UPDATE would rewrite
  // the default and every form's override for this brand in one statement.
  const existing = await pool
    .request()
    .input("code", sql.NVarChar, code)
    .query(
      `SELECT Id FROM [dbo].[AccBrandErpTargetSetting]
       WHERE BrandCode = @code AND ${perFormWriteMatch(null)}`,
    );

  const bcUatId =
    patch.bcUatId !== undefined ? patch.bcUatId?.trim() || null : undefined;
  const bcUatName =
    patch.bcUatName !== undefined ? patch.bcUatName?.trim() || null : undefined;
  const bcUatConnectionId =
    patch.bcUatConnectionId !== undefined ? patch.bcUatConnectionId : undefined;

  if (existing.recordset.length === 0) {
    await writeBothPools(async (tx) => {
      await tx
        .request()
        .input("code", sql.NVarChar, code)
        .input("uatId", sql.NVarChar, bcUatId ?? null)
        .input("uatName", sql.NVarChar, bcUatName ?? null)
        .input("uatConn", sql.Int, bcUatConnectionId ?? null)
        .input("user", sql.Int, userId || null).query(`
          INSERT INTO [dbo].[AccBrandErpTargetSetting]
            (BrandCode, BcUatId, BcUatName, BcUatConnectionId, FormCode, CreatedBy)
          VALUES (@code, @uatId, @uatName, @uatConn, NULL, @user)
        `);
    });
    return;
  }

  await writeBothPools(async (tx) => {
    const sets: string[] = ["UpdatedAt = SYSDATETIME()"];
    const req = tx.request().input("code", sql.NVarChar, code);
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
      WHERE BrandCode = @code AND ${perFormWriteMatch(null)}
    `);
  });
}
