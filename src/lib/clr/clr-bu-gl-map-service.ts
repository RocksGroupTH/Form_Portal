import { getAccPool, sql } from "@/lib/acc/pool";
import { getAppPool } from "@/lib/db/mssql";
import { env } from "@/env";

export interface ClrBuGlMapRow {
  id: number;
  company: string;
  buCode: string;
  glAccountNo: string;
  isActive: boolean;
  note: string | null;
}

/**
 * BU → G/L account for one BC company.
 *
 * A store the company owns books its expense to the account it was coded to; a
 * franchised or managed one books it to a receivable, because the money is
 * charged back. The BU dimension already sits on every journal line, so that is
 * what the rule keys on.
 *
 * A BU with no row keeps the coded account — the behaviour every line had before
 * this table existed. COCO has no row on purpose ("บัญชีตาม คชจ" is the absence
 * of a rule), and neither do the BUs nobody has ruled on yet, so an unanswered
 * question changes nothing rather than guessing.
 */
export async function loadBuGlAccounts(company: string): Promise<Record<string, string>> {
  const co = (company ?? "").trim().toUpperCase();
  if (!co) return {};
  const pool = await getAccPool();
  const res = await pool
    .request()
    .input("co", sql.NVarChar, co)
    .query(`
      SELECT BuCode, GlAccountNo FROM [dbo].[AccClrBuGlMap]
      WHERE Company = @co AND IsActive = 1
    `);
  const out: Record<string, string> = {};
  for (const r of res.recordset as Record<string, unknown>[]) {
    const bu = String(r.BuCode ?? "").trim().toUpperCase();
    const gl = String(r.GlAccountNo ?? "").trim();
    if (bu && gl) out[bu] = gl;
  }
  return out;
}

/** Every row for the settings screen, active or not. */
export async function listBuGlMap(company: string): Promise<ClrBuGlMapRow[]> {
  const co = (company ?? "").trim().toUpperCase();
  if (!co) return [];
  const pool = await getAccPool();
  const res = await pool
    .request()
    .input("co", sql.NVarChar, co)
    .query(`
      SELECT Id, Company, BuCode, GlAccountNo, IsActive, Note
      FROM [dbo].[AccClrBuGlMap]
      WHERE Company = @co
      ORDER BY BuCode
    `);
  return (res.recordset as Record<string, unknown>[]).map((r) => ({
    id: r.Id as number,
    company: String(r.Company ?? ""),
    buCode: String(r.BuCode ?? ""),
    glAccountNo: String(r.GlAccountNo ?? ""),
    isActive: r.IsActive === true || r.IsActive === 1,
    note: (r.Note as string) ?? null,
  }));
}

/** Add or change one BU's account. Blank account = delete the rule. */
export async function upsertBuGlMap(input: {
  company: string;
  buCode: string;
  glAccountNo: string;
  note?: string | null;
}): Promise<void> {
  const co = (input.company ?? "").trim().toUpperCase();
  const bu = (input.buCode ?? "").trim().toUpperCase();
  const gl = (input.glAccountNo ?? "").trim();
  if (!co || !bu) throw new Error("ต้องระบุ Company และ BU");

  const pool = await getAccPool();
  if (!gl) {
    // Deleting is how a BU goes back to "บัญชีตาม คชจ" — the same state as never
    // having had a row, rather than a row that means nothing.
    await pool.request().input("co", sql.NVarChar, co).input("bu", sql.NVarChar, bu)
      .query(`DELETE FROM [dbo].[AccClrBuGlMap] WHERE Company=@co AND BuCode=@bu`);
    return;
  }

  await pool.request()
    .input("co", sql.NVarChar, co)
    .input("bu", sql.NVarChar, bu)
    .input("gl", sql.NVarChar, gl)
    .input("note", sql.NVarChar, input.note ?? null)
    .query(`
      MERGE [dbo].[AccClrBuGlMap] AS t
      USING (SELECT @co AS Company, @bu AS BuCode) AS s
        ON t.Company = s.Company AND t.BuCode = s.BuCode
      WHEN MATCHED THEN UPDATE SET GlAccountNo=@gl, Note=@note, IsActive=1, UpdatedAt=SYSDATETIME()
      WHEN NOT MATCHED THEN INSERT (Company, BuCode, GlAccountNo, Note) VALUES (@co, @bu, @gl, @note);
    `);
}

/**
 * Every BU that exists in this Company's Locations, with how many use it.
 *
 * The settings screen lists these rather than a free-text box: a rule typed
 * against a BU that no Location carries is a rule that never fires, and nothing
 * on screen would say so. The count is there because it is the difference
 * between a BU worth ruling on and one with four shops in it.
 */
export async function listCompanyBus(
  company: string,
): Promise<{ buCode: string; locations: number }[]> {
  const co = (company ?? "").trim().toUpperCase();
  if (!co) return [];
  const pool = await getAppPool(env.MSSQL_ERP_DATA_DATABASE);
  const res = await pool
    .request()
    .input("co", sql.NVarChar, co)
    .query(`
      SELECT BuCode, COUNT(*) AS Locations
      FROM [dbo].[ErpLocation]
      WHERE BrandCode = @co AND NULLIF(LTRIM(RTRIM(ISNULL(BuCode,''))),'') IS NOT NULL
      GROUP BY BuCode
      ORDER BY COUNT(*) DESC
    `);
  return (res.recordset as Record<string, unknown>[]).map((r) => ({
    buCode: String(r.BuCode ?? ""),
    locations: Number(r.Locations ?? 0),
  }));
}
