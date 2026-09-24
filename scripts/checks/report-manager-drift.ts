/* eslint-disable no-console */
/**
 * Report every request whose manager HR names **today** is not the one stamped
 * on it at submit.
 *
 * Since 2026-09-24 the MANAGER step is resolved live (see
 * `src/lib/acc/current-manager.ts`), so those rows are exactly the ones that
 * changed hands: they left the stamped manager's My Work and appeared in the
 * current manager's. This is the script that says how many, and which — run it
 * before a deploy to know the blast radius, and after one to explain a "why is
 * this in my queue" question without guessing.
 *
 * It also counts the rows that fall back: a requester with no usable manager on
 * record today is still answered by the snapshot, by both the list and the
 * button, so those are the rows this change does NOT touch.
 *
 * Read-only. Runs against both form databases, because a request lives in one
 * or the other and the manager comes from a different table in each — HR in
 * production, `Fast_Core.UatTester` in UAT.
 *
 * Usage: npm run check:manager-drift
 *
 * tsx does not auto-load .env.local, so this script loads env vars itself and
 * imports through dynamic `import()` so nothing reads `@/env` before it has.
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadDotEnvLocal();

async function main() {
  const cm = await import("../../src/lib/acc/current-manager-sql");
  const db = await import("../../src/lib/db/mssql");

  for (const [label, poolFn, env] of [
    ["Rocks_Portal_Form", db.getProductionFormPool, "Production"],
    ["Rocks_Portal_Form_UAT", db.getUatFormPool, "UAT"],
  ] as const) {
    const pool = await poolFn();
    console.log(`\n================ ${label} (${env}) ================`);

    // One projection, three readings of it — the counts and the sample cannot
    // disagree about what "drifted" means.
    const base = `
      SELECT r.Id, r.RequestNo, r.FormCode, r.Status, r.CurrentStepCode,
             r.StaffId, r.RequesterFullName,
             r.ManagerStaffId AS SnapshotManager,
             ${cm.currentManagerStaffIdSql(env, "r")} AS LiveManager,
             ${cm.currentManagerNameSql(env, "r")} AS LiveManagerName,
             CASE WHEN ${cm.hasCurrentManagerPredicate(env, "r")} THEN 1 ELSE 0 END AS HasLive
      FROM [dbo].[AccRequest] r
      WHERE r.Status <> 'Draft'`;

    const totals = await pool.request().query(`
      WITH x AS (${base})
      SELECT COUNT(*) AS Total,
             SUM(HasLive) AS WithLiveManager,
             SUM(CASE WHEN HasLive = 0 THEN 1 ELSE 0 END) AS FallsBackToSnapshot,
             SUM(CASE WHEN HasLive = 1 AND LiveManager <> COALESCE(SnapshotManager, -1)
                      THEN 1 ELSE 0 END) AS Drifted,
             SUM(CASE WHEN HasLive = 1 AND LiveManager <> COALESCE(SnapshotManager, -1)
                       AND Status = 'Submitted' AND CurrentStepCode = 'MANAGER'
                      THEN 1 ELSE 0 END) AS DriftedAndPending
      FROM x
    `);
    const t = totals.recordset[0];
    console.log(`  non-draft requests            ${t.Total ?? 0}`);
    console.log(`  with a live manager on record ${t.WithLiveManager ?? 0}`);
    console.log(`  no live answer (snapshot wins)${String(t.FallsBackToSnapshot ?? 0).padStart(4)}`);
    console.log(`  live <> snapshot              ${t.Drifted ?? 0}`);
    console.log(`  ...of which still PENDING     ${t.DriftedAndPending ?? 0}  <- these changed hands`);

    // The pending ones are the only rows where the drift changes who can act
    // right now; the rest are history and stay visible to whoever acted.
    const pending = await pool.request().query(`
      WITH x AS (${base})
      SELECT * FROM x
      WHERE HasLive = 1 AND LiveManager <> COALESCE(SnapshotManager, -1)
        AND Status = 'Submitted' AND CurrentStepCode = 'MANAGER'
      ORDER BY Id DESC
    `);
    if (pending.recordset.length > 0) {
      console.log("\n  pending requests that moved to a different manager:");
      for (const row of pending.recordset) {
        console.log(
          `    ${String(row.RequestNo ?? row.Id).padEnd(16)} ${String(row.FormCode).padEnd(6)}` +
            ` requester ${String(row.RequesterFullName ?? row.StaffId ?? "?").padEnd(24)}` +
            ` ${row.SnapshotManager ?? "-"} -> ${row.LiveManager} (${row.LiveManagerName ?? "?"})`,
        );
      }
    }
  }
  process.exit(0);
}

void main();
