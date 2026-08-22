import { getAccPool, sql } from "@/lib/acc/pool";
import { writeBothPools } from "@/lib/acc/dual-write";
import { isErpInterfaceBrandCode } from "@/lib/acc/erp-interface-brands";
import {
  defaultsOnly,
  perFormOrderBy,
  perFormPredicate,
  perFormWriteMatch,
  pickAllForForm,
} from "@/lib/acc/per-form-config";

export interface BrandErpInterfaceMapRow {
  id: number;
  brandCode: string;
  interfaceBrandCode: string;
  /** `null` is the default, which answers every form. */
  formCode: string | null;
}

function mapRow(x: Record<string, unknown>): BrandErpInterfaceMapRow {
  return {
    id: x.Id as number,
    brandCode: x.BrandCode as string,
    interfaceBrandCode: x.InterfaceBrandCode as string,
    // Never leave this absent: `undefined` is invisible to both pickForForm and
    // defaultsOnly, which drops a form's entire default configuration silently.
    formCode: (x.FormCode as string | null) ?? null,
  };
}

/**
 * All claim-brand → interface-brand mappings.
 *
 * With `formCode`, this form's configuration: its own row per brand where it
 * has one, the default otherwise. Without, the defaults alone — what the
 * settings editor edits, and the safe answer for a caller with no form in hand,
 * since it can never return another form's mapping.
 */
export async function listBrandErpInterfaceMaps(
  formCode?: string,
): Promise<BrandErpInterfaceMapRow[]> {
  const pool = await getAccPool();
  const req = pool.request();
  let where = "WHERE FormCode IS NULL";
  if (formCode) {
    req.input("formCode", sql.NVarChar(20), formCode);
    where = `WHERE ${perFormPredicate()}`;
  }
  const r = await req.query(`
    SELECT Id, BrandCode, InterfaceBrandCode, FormCode
    FROM [dbo].[AccBrandErpInterface]
    ${where}
    ORDER BY BrandCode, ${perFormOrderBy()}
  `);
  const rows = r.recordset.map(mapRow);
  // One row per brand: the unique index is (FormCode, BrandCode).
  return formCode
    ? pickAllForForm(rows, formCode, (row) => row.brandCode.toUpperCase())
    : defaultsOnly(rows);
}

/** Reduced to one row by `TOP 1` in SQL, overrides sorted first. */
export async function getBrandErpInterfaceMap(
  claimBrandCode: string,
  formCode?: string,
): Promise<BrandErpInterfaceMapRow | null> {
  const pool = await getAccPool();
  const req = pool.request().input("brand", sql.NVarChar, claimBrandCode.trim());
  let formWhere = "AND FormCode IS NULL";
  if (formCode) {
    req.input("formCode", sql.NVarChar(20), formCode);
    formWhere = `AND ${perFormPredicate()}`;
  }
  const r = await req.query(`
      SELECT TOP 1 Id, BrandCode, InterfaceBrandCode, FormCode
      FROM [dbo].[AccBrandErpInterface]
      WHERE BrandCode = @brand
      ${formWhere}
      ORDER BY ${perFormOrderBy()}
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
  // The editor edits the default; there is no form selector yet. Resolving the
  // default explicitly keeps the write off any override somebody added by SQL.
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
        INSERT INTO [dbo].[AccBrandErpInterface] (BrandCode, InterfaceBrandCode, FormCode, CreatedBy)
        OUTPUT INSERTED.Id, INSERTED.BrandCode, INSERTED.InterfaceBrandCode, INSERTED.FormCode
        VALUES (@brand, @target, NULL, @user)
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
    // Bounded to the default. Unbounded, this deletes every form's override for
    // the brand as well — the editor only ever meant to clear the shared row.
    await tx.request().input("brand", sql.NVarChar, claim).query(`
        DELETE FROM [dbo].[AccBrandErpInterface]
        WHERE BrandCode = @brand AND ${perFormWriteMatch(null)}
      `);
  });
}
