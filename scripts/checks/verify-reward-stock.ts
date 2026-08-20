/* eslint-disable no-console */
/**
 * Assert AP-11's reward stock counters match the requests that produced them.
 *
 * `AccReward.LockedQty` and `IssuedQty` are maintained incrementally by
 * `src/lib/acc/reward/stock-ledger.ts` — every change is a conditional UPDATE
 * inside the same transaction as the status change that caused it. That is what
 * makes an oversell impossible under concurrency, but it also means the counters
 * are derived state kept by hand rather than computed on read, and derived state
 * kept by hand can drift: a manual UPDATE against AccRequest.Status, a restore
 * that replays one table and not the other, a migration applied to one database.
 *
 * `CK_AccReward_Stock` catches the dangerous direction (committed exceeding
 * stock) at write time. This catches the quiet one — counters that no longer
 * describe reality but still satisfy the constraint, which shows up as rewards
 * that look unavailable when they are not, or the reverse.
 *
 * Re-derives both counters from AccRewardRequest joined to AccRequest, grouped
 * by `LockedRewardId`:
 *
 *   LockedQty = SUM(LockedQty) over requests in Submitted / ManagerApproved /
 *               Approved / Ready / Returned
 *   IssuedQty = SUM(LockedQty) over requests in Received
 *
 * **`LockedQty` and `LockedRewardId`, not `Qty` and `RewardId`.** Those are what
 * the request has actually committed; `Qty`/`RewardId` are what it is asking
 * for, and a Returned request keeps its hold while either is edited, so the two
 * pairs legitimately disagree. A rejected request holds nothing and carries 0.
 *
 * The two status sets come from `STOCK_HOLDING_STATUSES` in the feature
 * constants and from `markReceived` respectively; if either changes, change it
 * here too.
 *
 * Read-only. Checks both databases.
 *
 * Usage: npx tsx scripts/checks/verify-reward-stock.ts
 *
 * tsx does not auto-load .env.local or resolve the "@/" alias, so this script
 * loads env vars itself and imports the pool via a relative path.
 */

import fs from "node:fs";
import path from "node:path";

function loadDotEnvLocal() {
  const p = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

/**
 * The statuses that still hold stock. Mirrors `STOCK_HOLDING_STATUSES` in
 * `src/features/reward/constants.ts` — duplicated as a literal rather than
 * imported because that module pulls in the feature's types, and this script
 * must not drag application imports into a plain SQL check.
 */
const HOLDING = "'Submitted','ManagerApproved','Approved','Ready','Returned'";

interface DriftRow {
  Id: number;
  BrandCode: string;
  Code: string;
  Name: string;
  LockedQty: number;
  IssuedQty: number;
  Qty: number;
  DerivedLocked: number;
  DerivedIssued: number;
}

async function checkDatabase(
  getAppPool: (name: string) => Promise<{ request: () => { query: (q: string) => Promise<{ recordset: unknown[] }> } }>,
  dbName: string,
): Promise<string[]> {
  const failures: string[] = [];

  let pool;
  try {
    pool = await getAppPool(dbName);
  } catch (err) {
    return [`${dbName}: cannot connect — ${err instanceof Error ? err.message : String(err)}`];
  }

  const tableCheck = await pool.request().query(
    `SELECT CASE WHEN OBJECT_ID('dbo.AccReward','U') IS NULL THEN 0 ELSE 1 END AS HasTable`,
  );
  if (!(tableCheck.recordset[0] as { HasTable: number }).HasTable) {
    console.log(`  ${dbName}: no dbo.AccReward — migration 067 not applied here. Skipping.`);
    return [];
  }

  const res = await pool.request().query(`
    SELECT r.Id, r.BrandCode, r.Code, r.Name, r.LockedQty, r.IssuedQty, r.Qty,
           COALESCE(d.Locked, 0) AS DerivedLocked,
           COALESCE(d.Issued, 0) AS DerivedIssued
      FROM [dbo].[AccReward] r
      LEFT JOIN (
        SELECT rr.LockedRewardId AS RewardId,
               SUM(CASE WHEN req.Status IN (${HOLDING}) THEN rr.LockedQty ELSE 0 END) AS Locked,
               SUM(CASE WHEN req.Status = 'Received'    THEN rr.LockedQty ELSE 0 END) AS Issued
          FROM [dbo].[AccRewardRequest] rr
          JOIN [dbo].[AccRequest] req ON req.Id = rr.RequestId
         WHERE rr.LockedRewardId IS NOT NULL
         GROUP BY rr.LockedRewardId
      ) d ON d.RewardId = r.Id
     ORDER BY r.BrandCode, r.Code
  `);

  const rows = res.recordset as DriftRow[];
  let drifted = 0;

  for (const r of rows) {
    const lockedOk = r.LockedQty === r.DerivedLocked;
    const issuedOk = r.IssuedQty === r.DerivedIssued;
    if (lockedOk && issuedOk) continue;

    drifted++;
    const parts: string[] = [];
    if (!lockedOk) parts.push(`LockedQty stored ${r.LockedQty} vs derived ${r.DerivedLocked}`);
    if (!issuedOk) parts.push(`IssuedQty stored ${r.IssuedQty} vs derived ${r.DerivedIssued}`);
    failures.push(`${dbName} · ${r.BrandCode}/${r.Code} "${r.Name}" (id ${r.Id}) — ${parts.join("; ")}`);
  }

  // The constraint should make this unreachable. Reported separately because if
  // it ever fires, the constraint is missing rather than the counters being off.
  for (const r of rows) {
    if (r.LockedQty + r.IssuedQty > r.Qty) {
      failures.push(
        `${dbName} · ${r.BrandCode}/${r.Code} (id ${r.Id}) — committed ${r.LockedQty + r.IssuedQty} exceeds Qty ${r.Qty}. ` +
          `CK_AccReward_Stock should have prevented this; check the constraint exists.`,
      );
    }
  }

  console.log(
    `  ${dbName}: ${rows.length} reward(s) checked, ${drifted} with drift.`,
  );
  return failures;
}

async function main() {
  loadDotEnvLocal();
  const { getAppPool } = await import("../../src/lib/db/mssql");

  const prodName = process.env.MSSQL_FORM_DATABASE ?? "Rocks_Portal_Form";
  const uatName = process.env.MSSQL_FORM_UAT_DATABASE ?? "Rocks_Portal_Form_UAT";

  console.log("Verifying AP-11 reward stock counters...");

  const failures = [
    ...(await checkDatabase(getAppPool as never, prodName)),
    ...(await checkDatabase(getAppPool as never, uatName)),
  ];

  if (failures.length === 0) {
    console.log("\n✅ Reward stock counters agree with the requests that produced them.");
    process.exit(0);
  }

  console.error(`\n❌ ${failures.length} problem(s):\n`);
  for (const f of failures) console.error(`  - ${f}`);
  console.error(
    "\nCounters are maintained by src/lib/acc/reward/stock-ledger.ts. Drift means something\n" +
      "changed AccRequest.Status without going through the approval engine, or a row was\n" +
      "restored/copied between databases. Fix by correcting the counters to the derived\n" +
      "values above, after confirming the request statuses themselves are right.",
  );
  process.exit(1);
}

main().catch((err) => {
  console.error("verify-reward-stock failed:", err);
  process.exit(1);
});
