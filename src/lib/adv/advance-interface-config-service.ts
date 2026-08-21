import { getAccPool, sql } from "@/lib/adv/pool";
import { writeBothPools } from "@/lib/acc/dual-write";

/**
 * AP-2's OWN Interface ERP config, in its own table (AccAdvanceInterfaceConfig),
 * fully separate from AP-1's shared config tables. One row per claim brand.
 *
 * Reads use the AP-2 (UAT) pool; writes go through writeBothPools so Prod + UAT
 * stay in sync — but because this is a dedicated AP-2 table, no AP-1 table is
 * ever touched.
 */
export interface AdvanceInterfaceConfigRow {
  brandCode: string;
  interfaceBrandCode: string | null;
  glAccountNo: string | null;
  glErpDescription: string | null;
  bankAccountNo: string | null;
  branchCode: string | null;
  journalBatchName: string | null;
}

function mapRow(x: Record<string, unknown>): AdvanceInterfaceConfigRow {
  return {
    brandCode: (x.BrandCode as string).toUpperCase(),
    interfaceBrandCode: (x.InterfaceBrandCode as string) ?? null,
    glAccountNo: (x.GlAccountNo as string) ?? null,
    glErpDescription: (x.GlErpDescription as string) ?? null,
    bankAccountNo: (x.BankAccountNo as string) ?? null,
    branchCode: (x.BranchCode as string) ?? null,
    journalBatchName: (x.JournalBatchName as string) ?? null,
  };
}

/** All AP-2 interface config rows, keyed by upper-case brand code. */
export async function listAdvanceInterfaceConfig(): Promise<Record<string, AdvanceInterfaceConfigRow>> {
  const pool = await getAccPool();
  const r = await pool.request().query(`
    SELECT BrandCode, InterfaceBrandCode, GlAccountNo, GlErpDescription, BankAccountNo, BranchCode, JournalBatchName
    FROM [dbo].[AccAdvanceInterfaceConfig]
  `);
  const map: Record<string, AdvanceInterfaceConfigRow> = {};
  for (const row of r.recordset as Record<string, unknown>[]) {
    const m = mapRow(row);
    map[m.brandCode] = m;
  }
  return map;
}

/** One AP-2 interface config row (or null). */
export async function getAdvanceInterfaceConfig(brandCode: string): Promise<AdvanceInterfaceConfigRow | null> {
  const pool = await getAccPool();
  const r = await pool.request()
    .input("brand", sql.NVarChar, brandCode.trim().toUpperCase())
    .query(`
      SELECT BrandCode, InterfaceBrandCode, GlAccountNo, GlErpDescription, BankAccountNo, BranchCode, JournalBatchName
      FROM [dbo].[AccAdvanceInterfaceConfig] WHERE BrandCode = @brand
    `);
  const row = r.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapRow(row) : null;
}

// Column names are fixed constants (never user input) — safe to inline in SQL.
async function mergeConfig(
  brandCode: string,
  set: { col: string; value: string | null }[],
  userId: number,
): Promise<void> {
  const brand = brandCode.trim().toUpperCase();
  if (!brand) throw new Error("กรุณาเลือกแบรนด์");
  await writeBothPools(async (tx) => {
    const req = tx.request()
      .input("brand", sql.NVarChar, brand)
      .input("user", sql.Int, userId || null);
    set.forEach((s, i) => req.input(`v${i}`, sql.NVarChar, s.value));
    const updateSet = set.map((s, i) => `${s.col} = @v${i}`).join(", ");
    const insCols = set.map((s) => s.col).join(", ");
    const insVals = set.map((_, i) => `@v${i}`).join(", ");
    await req.query(`
      MERGE [dbo].[AccAdvanceInterfaceConfig] AS t
      USING (SELECT @brand AS BrandCode) AS s ON t.BrandCode = s.BrandCode
      WHEN MATCHED THEN
        UPDATE SET ${updateSet}, UpdatedAt = SYSDATETIME(), UpdatedBy = @user
      WHEN NOT MATCHED THEN
        INSERT (BrandCode, ${insCols}, CreatedBy) VALUES (@brand, ${insVals}, @user);
    `);
  });
}

/** Set the target Company (ส่งเข้าแบรนด์) for one claim brand. */
export function saveAdvanceTarget(brandCode: string, interfaceBrandCode: string, userId: number) {
  return mergeConfig(brandCode, [{ col: "InterfaceBrandCode", value: interfaceBrandCode.trim().toUpperCase() || null }], userId);
}

/** Set the AP-2 G/L account for one claim brand. (Description comes from the request's purpose.) */
export function saveAdvanceGl(brandCode: string, accountNo: string, userId: number) {
  return mergeConfig(brandCode, [{ col: "GlAccountNo", value: accountNo.trim() || null }], userId);
}

/** Set the AP-2 Bank account for one claim brand. */
export function saveAdvanceBank(brandCode: string, accountNo: string, userId: number) {
  return mergeConfig(brandCode, [{ col: "BankAccountNo", value: accountNo.trim() || null }], userId);
}

/** Set the AP-2 Journal Batch for one claim brand. */
export function saveAdvanceBatch(brandCode: string, batchName: string, userId: number) {
  return mergeConfig(brandCode, [{ col: "JournalBatchName", value: batchName.trim() || null }], userId);
}

/** Save AP-2's target Company + G/L + Bank + Branch + Journal Batch for one claim
 *  brand in a single write. InterfaceBrandCode makes AP-2 resolve its OWN target
 *  Company instead of falling back to AP-1's brand→Company mapping. */
export function saveAdvanceInterface(
  brandCode: string,
  values: { interfaceBrandCode: string; glAccountNo: string; bankAccountNo: string; branchCode: string; journalBatchName: string },
  userId: number,
) {
  return mergeConfig(brandCode, [
    { col: "InterfaceBrandCode", value: values.interfaceBrandCode.trim().toUpperCase() || null },
    { col: "GlAccountNo", value: values.glAccountNo.trim() || null },
    { col: "BankAccountNo", value: values.bankAccountNo.trim() || null },
    { col: "BranchCode", value: values.branchCode.trim() || null },
    { col: "JournalBatchName", value: values.journalBatchName.trim() || null },
  ], userId);
}
