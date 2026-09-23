import { getAccPool, sql } from "@/lib/acc/pool";
import { writeBothPools } from "@/lib/acc/dual-write";
import { AP1_FORM_CODE } from "@/features/accounting/constants";
import { getAllowedBrands } from "@/lib/acc/brand-options";
import { isErpInterfaceBrand } from "@/lib/acc/erp-interface-brands";
import { resolveEffectiveErpEnvironment } from "@/lib/acc/erp-environment";
import {
  brandErpEnvPredicate,
  type ErpBcEnvironment,
} from "@/lib/acc/brand-erp-environment";
import {
  defaultsOnly,
  perFormOrderBy,
  perFormPredicate,

  perFormWriteMatch,
  pickAllForForm,
} from "@/lib/acc/per-form-config";

async function assertJournalBrandAllowed(brandCode: string): Promise<void> {
  const code = brandCode.trim().toUpperCase();
  // Awaited. Unawaited this is `if (promise)`, which is always true, and every
  // brand would skip AP-1's allow-list check below.
  if (await isErpInterfaceBrand(code)) return;
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
  /** `null` is the default, which answers every form. */
  formCode: string | null;
  /**
   * Which BC this batch name exists in — 'Production' or 'Sandbox'
   * (migration 161). **Never null**: a batch name is the name of an object in
   * one company, so a row belongs to exactly one environment.
   */
  environment: string;
}

function mapRow(x: Record<string, unknown>): BrandJournalBatchRow {
  return {
    id: x.Id as number,
    brandCode: x.BrandCode as string,
    batchName: x.BatchName as string,
    displayName: (x.DisplayName as string) ?? null,
    isActive: !!x.IsActive,
    sortOrder: x.SortOrder as number,
    // Never absent — see the note in brand-erp-interface-map-service.
    formCode: (x.FormCode as string | null) ?? null,
    environment: (x.Environment as string) ?? "Production",
  };
}

/**
 * With `formCode`, this form's journal batches; without, the defaults alone.
 * Picked per `(BrandCode, BatchName)` — the unique index minus `FormCode`.
 */
export async function listBrandJournalBatches(
  brandCode?: string | null,
  formCode?: string,
  /**
   * Which BC's batches to read. **Omitted, it is the environment this request
   * already resolves to** — which is why the money path (`erp-journal-context`,
   * the payload builders) passes nothing and still cannot read the wrong half.
   * The settings screens pass it, because their PRO/UAT toggle edits the half
   * the viewer is NOT in as often as the one they are.
   */
  environment?: ErpBcEnvironment,
): Promise<BrandJournalBatchRow[]> {
  const env = environment ?? (await resolveEffectiveErpEnvironment());
  const pool = await getAccPool();
  const req = pool.request().input("environment", sql.NVarChar(20), env);
  const conditions: string[] = [brandErpEnvPredicate()];
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
    SELECT Id, BrandCode, BatchName, DisplayName, IsActive, SortOrder, FormCode, Environment
    FROM [dbo].[AccBrandJournalBatch]
    WHERE ${conditions.join(" AND ")}
    ORDER BY BrandCode, SortOrder, BatchName, ${perFormOrderBy()}
  `);
  const rows = r.recordset.map(mapRow);
  return formCode
    ? pickAllForForm(
        rows,
        formCode,
        // See brand-account-service for why the key is JSON.
        (row) => JSON.stringify([row.brandCode.toUpperCase(), row.batchName]),
      )
    : defaultsOnly(rows);
}

export async function upsertBrandJournalBatch(
  input: {
    id?: number;
    brandCode: string;
    batchName: string;
    displayName?: string | null;
    isActive?: boolean;
    sortOrder?: number;
    /**
     * Which BC this batch exists in. Omitted, the environment the request
     * already resolves to — so the settings screen's PRO/UAT toggle is the
     * only thing that ever needs to name it, and every other caller writes
     * the half it is working in by construction.
     */
    environment?: ErpBcEnvironment;
  },
  userId: number,
): Promise<void> {
  const env = input.environment ?? (await resolveEffectiveErpEnvironment());
  const batchName = input.batchName.trim();
  const brandCode = input.brandCode.trim().toUpperCase();
  if (!brandCode) throw new Error("กรุณาเลือกแบรนด์");
  await assertJournalBrandAllowed(brandCode);
  if (!batchName) throw new Error("กรุณาเลือก Journal Batch");

  const pool = await getAccPool();
  // Bounded to the default — the editor has no form selector, and an unbounded
  // probe could land on an override and rewrite another form's batch.
  let rowId = input.id;
  if (rowId == null) {
    const existing = await pool
      .request()
      .input("brand", sql.NVarChar, brandCode)
      .input("environment", sql.NVarChar(20), env).query(`
        SELECT TOP 1 Id FROM [dbo].[AccBrandJournalBatch]
        -- The environment bounds the probe as tightly as the form does: without
        -- it, editing Sandbox's batch would find Production's row and rewrite
        -- it, which is the failure this whole column exists to prevent.
        WHERE BrandCode = @brand AND ${brandErpEnvPredicate()} AND ${perFormWriteMatch(null)}
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
      .input("environment", sql.NVarChar(20), env)
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
      -- Bounded to the default as well as the id. The row id arrives from the
      -- request body, and this editor only ever edits the default, so an id
      -- naming an override must not be updatable through it.
      WHERE Id = @id AND ${brandErpEnvPredicate()} AND ${perFormWriteMatch(null)}
    `);
    } else {
      await req.query(`
      INSERT INTO [dbo].[AccBrandJournalBatch]
        (BrandCode, BatchName, DisplayName, IsActive, SortOrder, FormCode, Environment, CreatedBy)
      VALUES (@brand, @batchName, @displayName, @active, @sort, NULL, @environment, @user)
    `);
    }
  });
}

/**
 * Write one per-form BatchName override for `formCode`, or clear it when
 * `batchName` is null. Keyed by claim brand (AP-2 stores batch per claim brand,
 * not per interface brand). Read path uses explicit formCode='AP-2' filter
 * (see advance-erp-context.ts) to avoid resolveJournalBatchName's interface-
 * brand-first lookup.
 */
export async function mergeFormBrandBatch(
  brandCode: string,
  formCode: string,
  batchName: string | null,
  userId: number,
  /** Omitted, the environment this request resolves to — see `listBrandJournalBatches`. */
  environment?: ErpBcEnvironment,
): Promise<void> {
  const env = environment ?? (await resolveEffectiveErpEnvironment());
  const brand = brandCode.trim().toUpperCase();
  const form = formCode.trim().toUpperCase();
  const batch = batchName?.trim() || null;
  if (!brand) throw new Error("กรุณาระบุแบรนด์");
  if (!form) throw new Error("กรุณาระบุ FormCode");
  await writeBothPools(async (tx) => {
    await tx
      .request()
      .input("brand", sql.NVarChar, brand)
      .input("formCode", sql.NVarChar(20), form)
      .input("environment", sql.NVarChar(20), env)
      .query(`
        DELETE FROM [dbo].[AccBrandJournalBatch]
        -- Bounded by the environment as well as the brand and form. Without it,
        -- saving one environment's override DELETES the other's — this is a
        -- delete-then-insert, so the row it removed would simply be gone.
        WHERE BrandCode = @brand AND FormCode = @formCode AND ${brandErpEnvPredicate()}
      `);
    if (batch) {
      await tx
        .request()
        .input("brand", sql.NVarChar, brand)
        .input("formCode", sql.NVarChar(20), form)
        .input("batch", sql.NVarChar, batch)
        .input("environment", sql.NVarChar(20), env)
        .input("user", sql.Int, userId || null)
        .query(`
          INSERT INTO [dbo].[AccBrandJournalBatch]
            (BrandCode, BatchName, FormCode, IsActive, SortOrder, Environment, CreatedBy)
          VALUES (@brand, @batch, @formCode, 1, 0, @environment, @user)
        `);
    }
  });
}
