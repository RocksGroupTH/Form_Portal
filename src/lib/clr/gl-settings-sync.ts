import { syncBrandErpGlAccounts } from "@/lib/erp/account-sync";
import { BRANCH_DIMENSION_CODE, syncBrandDimensionValues } from "@/lib/erp/dimension-sync";
import { syncBrandErpLocations } from "@/lib/erp/location-sync";

/**
 * Pull from Business Central exactly what one settings screen lists, for one
 * company.
 *
 * Each screen picks from lists that are a mirror of BC, so an account added or
 * renamed over there does not reach the screen until somebody syncs. Before
 * this the only sync buttons were AP-1's Interface ERP tab and AP-3's
 * Location / BU tab, neither of which is where somebody configuring G/L
 * categories is looking.
 *
 * **What each target pulls is what its screen actually shows**, no more:
 *
 * - `glAccounts` — the chart of accounts (`ErpAccounts`). That is the whole
 *   list the หมวดบัญชี G/L screen renders.
 * - `buGlMap` — the Locations (which carry the BUs), the BRANCH dimension
 *   values, and the chart of accounts. The Fix G/L by BU or Branch screen picks
 *   from all three.
 *
 * **Everything it writes lives in `Rocks_ERP_Data`, which has no UAT twin**, so
 * a sync from a UAT screen and one from production write the same rows. That is
 * correct — it is a mirror of what Business Central holds, not a decision
 * anybody here made — and it is why the routes calling this are `requireRole`
 * rather than a settings-tab grant: Rocks Fast writes the neighbouring tables
 * and ACC Portal reads them through `Fast_Data`'s synonyms, so a tab grant must
 * never become write access to rows two other applications depend on.
 *
 * **One phase's failure does not hide the others.** Each is caught and named, so
 * a company whose Locations have never been set up still gets its accounts —
 * and the screen says which half did not arrive rather than reporting one
 * unexplained failure.
 */

export type GlSyncTarget = "glAccounts" | "buGlMap";

export interface GlSyncResult {
  company: string;
  /** What each phase pulled, in the order it ran. */
  phases: { label: string; rows: number }[];
  /** Phases that threw, each named. Empty on a clean run. */
  errors: { label: string; error: string }[];
}

export async function syncErpForGlSettings(
  company: string,
  target: GlSyncTarget,
  triggeredBy: number | null,
): Promise<GlSyncResult> {
  const co = (company ?? "").trim().toUpperCase();
  if (!co) throw new Error("ต้องระบุบริษัท");

  const phases: GlSyncResult["phases"] = [];
  const errors: GlSyncResult["errors"] = [];

  const run = async (label: string, fn: () => Promise<number>) => {
    try {
      phases.push({ label, rows: await fn() });
    } catch (e) {
      errors.push({ label, error: e instanceof Error ? e.message : "sync failed" });
    }
  };

  if (target === "buGlMap") {
    // Locations first: they are what carry the BU a rule is keyed on, and the
    // screen's leftovers list is built from them.
    await run("Location / BU", async () => (await syncBrandErpLocations(co, triggeredBy)).locationRows);
    await run(
      "สาขา (BRANCH)",
      async () =>
        (await syncBrandDimensionValues(co, BRANCH_DIMENSION_CODE, triggeredBy, { skipLog: true }))
          .rowsUpserted,
    );
  }

  await run("ผังบัญชี G/L", async () => (await syncBrandErpGlAccounts(co)).glRows);

  return { company: co, phases, errors };
}
