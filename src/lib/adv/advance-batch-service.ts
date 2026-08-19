import { getAccPool, sql } from "@/lib/adv/pool";
import { writeBothPools } from "@/lib/acc/dual-write";
import { resolveErpTargetProfile } from "@/lib/acc/erp-target-profile";
import { fetchBcODataCollection, buildBcODataEntityUrl } from "@/lib/bc/bc-odata";
import { BC_GENERAL_JOURNAL_BATCHES_ENTITY } from "@/lib/erp/account-sync";
import { resolveFormAccess } from "@/lib/form-environment";
import { AP2_FORM_CODE } from "@/features/advance/constants";
import type { ErpBcEnvironment } from "@/lib/acc/erp-environment";

/**
 * Environment-aware Journal Batch cache (AccErpJournalBatch in the form DB).
 * Batches are synced from BC per Company AND environment, so the AP-2 dropdown
 * reads only the batches that exist where it posts (Sandbox for a UAT form).
 */
export interface ErpBatch { batchName: string; displayName: string | null; templateName: string | null }
export interface ErpBatchStatus { company: string; environment: string; count: number; lastSyncedAt: string | null }

const INSERT_CHUNK = 100;

/** AP-2 posts advances as payment journals — only batches under this template are valid. */
export const ADVANCE_JOURNAL_TEMPLATE = "PAYMENTS";

/** Keep only batches under the PAYMENTS template (the CU rejects any other). */
function onlyAdvanceTemplate(batches: ErpBatch[]): ErpBatch[] {
  return batches.filter((b) => (b.templateName ?? "").trim().toUpperCase() === ADVANCE_JOURNAL_TEMPLATE);
}

function pick(r: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) { const v = r[k]; if (typeof v === "string" && v.trim()) return v.trim(); }
  return null;
}

/** The environment AP-2 actually posts to (Sandbox while its form is UAT). */
export async function advanceErpEnvironment(): Promise<ErpBcEnvironment> {
  const access = await resolveFormAccess(AP2_FORM_CODE);
  return access.environment === "UAT" ? "Sandbox" : "Production";
}

/** Live-fetch a Company's batches from BC for a specific environment. */
async function fetchLiveBatches(company: string, environment: ErpBcEnvironment): Promise<ErpBatch[]> {
  const profile = await resolveErpTargetProfile(company.trim().toUpperCase(), environment);
  if (!profile?.bcConnectionId || !profile.baseUrl || !profile.bcName) {
    // Missing connection/company for this env — almost always a UAT target not set up.
    const envLabel = environment === "Sandbox" ? "UAT/Sandbox" : "Production";
    throw new Error(`${company} ยังไม่ได้ตั้งค่า ${envLabel} target (Connection/Company) — ตั้งที่ Accounting → Interface ERP`);
  }
  // Pass the environment so Sandbox hits the /Sandbox OData segment, not /Production.
  const url = buildBcODataEntityUrl(profile.baseUrl, profile.bcName, BC_GENERAL_JOURNAL_BATCHES_ENTITY, environment);
  const rows = await fetchBcODataCollection<Record<string, unknown>>(profile.bcConnectionId, url);
  return rows
    .map((r) => {
      const batchName = pick(r, "Name", "name");
      if (!batchName) return null;
      return {
        batchName,
        displayName: pick(r, "Description", "description"),
        templateName: pick(r, "Journal_Template_Name", "JournalTemplateName", "journalTemplateName"),
      };
    })
    .filter((b): b is ErpBatch => b !== null);
}

async function replaceBatches(company: string, environment: ErpBcEnvironment, batches: ErpBatch[]): Promise<void> {
  await writeBothPools(async (tx) => {
    await tx.request().input("c", sql.NVarChar, company).input("e", sql.NVarChar, environment)
      .query(`DELETE FROM [dbo].[AccErpJournalBatch] WHERE Company=@c AND Environment=@e`);
    for (let i = 0; i < batches.length; i += INSERT_CHUNK) {
      const chunk = batches.slice(i, i + INSERT_CHUNK);
      const req = tx.request().input("c", sql.NVarChar, company).input("e", sql.NVarChar, environment);
      const values = chunk.map((b, j) => {
        req.input(`n${j}`, sql.NVarChar, b.batchName);
        req.input(`d${j}`, sql.NVarChar, b.displayName);
        req.input(`t${j}`, sql.NVarChar, b.templateName ?? "");
        return `(@c, @e, @n${j}, @d${j}, @t${j})`;
      }).join(",");
      await req.query(`INSERT INTO [dbo].[AccErpJournalBatch] (Company, Environment, BatchName, DisplayName, TemplateName) VALUES ${values}`);
    }
  });
}

/** Sync one Company's batches from BOTH environments into the cache. */
export async function syncErpBatches(company: string): Promise<{ company: string; production: number; sandbox: number; errors: string[] }> {
  const target = company.trim().toUpperCase();
  const errors: string[] = [];
  const counts: Record<string, number> = { Production: 0, Sandbox: 0 };
  for (const env of ["Sandbox", "Production"] as ErpBcEnvironment[]) {
    try {
      const batches = await fetchLiveBatches(target, env);
      await replaceBatches(target, env, batches);
      counts[env] = batches.length;
    } catch (e) {
      errors.push(`${env}: ${e instanceof Error ? e.message : "error"}`);
    }
  }
  return { company: target, production: counts.Production, sandbox: counts.Sandbox, errors };
}

/**
 * Batches for the dropdown: read the cache first; if this (Company, Environment)
 * has none, live-fetch from BC once and fill the cache. Manual Sync still refreshes.
 * Returns an error string (instead of throwing) when the live fetch fails — e.g. the
 * Company has no UAT target configured — so the UI can show why it is empty.
 */
export async function listErpBatchesAutoSync(
  company: string,
  environment: ErpBcEnvironment,
): Promise<{ batches: ErpBatch[]; autoSynced: boolean; error: string | null }> {
  const cached = await listErpBatchesFromDb(company, environment);
  if (cached.length > 0) return { batches: onlyAdvanceTemplate(cached), autoSynced: false, error: null };
  try {
    const live = await fetchLiveBatches(company, environment);
    if (live.length > 0) await replaceBatches(company, environment, live);
    return { batches: onlyAdvanceTemplate(live), autoSynced: true, error: null };
  } catch (e) {
    return { batches: [], autoSynced: false, error: e instanceof Error ? e.message : "ดึง batch ไม่สำเร็จ" };
  }
}

/** Read cached batches for a Company + environment. */
export async function listErpBatchesFromDb(company: string, environment: ErpBcEnvironment): Promise<ErpBatch[]> {
  const pool = await getAccPool();
  const r = await pool.request()
    .input("c", sql.NVarChar, company.trim().toUpperCase())
    .input("e", sql.NVarChar, environment)
    .query(`
      SELECT BatchName, DisplayName, TemplateName
      FROM [dbo].[AccErpJournalBatch] WHERE Company=@c AND Environment=@e
      ORDER BY BatchName
    `);
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    batchName: x.BatchName as string,
    displayName: (x.DisplayName as string) ?? null,
    templateName: (x.TemplateName as string) ?? null,
  }));
}

/** Per Company+environment count + last sync, for the settings UI. */
export async function listErpBatchStatus(): Promise<ErpBatchStatus[]> {
  const pool = await getAccPool();
  const r = await pool.request().query(`
    SELECT Company, Environment, COUNT(*) AS Cnt, MAX(SyncedAt) AS LastSynced
    FROM [dbo].[AccErpJournalBatch] GROUP BY Company, Environment
  `);
  return (r.recordset as Record<string, unknown>[]).map((x) => ({
    company: (x.Company as string).toUpperCase(),
    environment: x.Environment as string,
    count: x.Cnt as number,
    lastSyncedAt: x.LastSynced ? (x.LastSynced as Date).toISOString() : null,
  }));
}
