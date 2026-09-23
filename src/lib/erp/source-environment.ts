import { resolveEffectiveErpEnvironment } from "@/lib/acc/erp-environment";
import type { ErpBcEnvironment } from "@/lib/acc/erp-environment-shared";

/**
 * **Which Business Central environment a mirror row was synced from — the one
 * seam every query against `Rocks_ERP_Data` goes through.**
 *
 * Migration 159 gave `ErpAccounts`, `ErpBankAccountCard`, `ErpDimensionValue`,
 * `ErpGeneralJournalBatch`, `ErpLocation` and `ErpSyncLog` a
 * `SourceEnvironment` column and rebuilt each unique key to lead with it, so a
 * tester's Sandbox data and production's live data sit in one set of tables
 * without touching each other. `ErpVendors` has had the column since migration
 * 117 and simply had it hardcoded to `'Production'`.
 *
 * The user asked for this on 2026-09-23: *"ตอน sync ข้อมูลของ ERP ถ้า Sync
 * และอ่านแยกกันระหว่าง PRO กับ UAT ด้วย"*.
 *
 * ## The failure this is shaped to prevent is SILENT, not loud
 *
 * A missing `SourceEnvironment` predicate does not throw. It returns **more
 * rows than it should**: a tester sees production's chart of accounts, or a
 * production user sees a Sandbox journal batch — on the paths that build
 * journal lines for Business Central. There is no error, no empty list, and
 * nothing a behavioural test would notice, because every row it returns is a
 * real row.
 *
 * So the rule is per QUERY, not per module: **every statement naming a mirror
 * table carries the predicate**, and `erp-source-environment-guard.test.ts`
 * reads the sources to hold it — the failure is a *missing* clause, which no
 * type can catch and which the next person to add a query will not think of.
 *
 * ## The values are `ErpBcEnvironment`'s own, deliberately
 *
 * `'Production'` and `'Sandbox'` — not `'PRO'`/`'UAT'`, and not the form
 * environment's own `'Production'`/`'UAT'` vocabulary. Migration 117 chose
 * these when it created the column, `resolveEffectiveErpEnvironment()` already
 * answers in them, and a second spelling of the same idea is how a WHERE clause
 * comes to match nothing at all. The mapping from the FORM environment to this
 * one stays where it already lived — UAT ⇒ Sandbox — and is not restated here.
 *
 * ## Why a named seam rather than calling the resolver directly
 *
 * Two reasons, and neither is style. The guard can pin *this* import rather
 * than trying to recognise every spelling of an inline call; and the name says
 * at each call site which question is being asked — "which BC did this row come
 * from", not "which BC should this request post to", which happen to have the
 * same answer today and are not the same question.
 */

/** The column, so a query builder and the guard agree on one spelling. */
export const ERP_SOURCE_ENVIRONMENT_COLUMN = "SourceEnvironment";

/**
 * The environment whose mirror rows this request should read and write.
 *
 * **It follows the form environment, so a tester reads Sandbox rows and
 * everyone else reads Production ones** — the same switch that already decides
 * which BC a journal posts to, which is what makes the two consistent by
 * construction rather than by a second setting somebody has to keep in step.
 *
 * Code with no request scope — scripts, the background mail drain — resolves
 * **Production**, exactly as its database does. That is the fail-safe
 * direction here: a script that syncs or reads without a request is doing
 * production's work.
 */
export async function resolveErpSourceEnvironment(): Promise<ErpBcEnvironment> {
  return resolveEffectiveErpEnvironment();
}

export type { ErpBcEnvironment };
