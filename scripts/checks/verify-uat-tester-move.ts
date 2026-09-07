/* eslint-disable no-console */
/**
 * Verify the UatTester move (docs/superpowers/specs/2026-09-07-uat-tester-move-design.md):
 *
 *   - UatTester and UatTesterPerDiem are TABLES in the database this app
 *     actually resolves through getUatFormPool() / MSSQL_FORM_UAT_DATABASE --
 *     not merely in some database called Rocks_Portal_Form_UAT
 *   - Fast_Core.dbo.UatTester is a SYNONYM whose base_object_name names that
 *     SAME database. Migration 140 hard-codes [Rocks_Portal_Form_UAT]; repointing
 *     the env var would make this app and ACC Portal read different rosters with
 *     no error anywhere, which is the hazard this check exists for
 *   - a count through the synonym and a direct count agree, taken in ONE
 *     round-trip -- two separate reads could only disagree because a write
 *     landed between them, which is flakiness, not a fault
 *   - Fast_Core does NOT hold UatTesterPerDiem, as an object of any kind. It
 *     deliberately gets no synonym, and a leftover table there would be a second
 *     copy that silently stops being written
 *
 * Read-only. Run: npm run check:uat-tester-home
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

async function main() {
  loadDotEnvLocal();
  const { getUatFormPool, getCorePool } = await import("@/lib/db/mssql");

  const uat = await getUatFormPool();
  const core = await getCorePool();
  // The database name comes from the app's own connection (DB_NAME() on the
  // pool getUatFormPool() itself opened), not from env.MSSQL_FORM_UAT_DATABASE
  // -- this is what proves the synonym points at the database the app actually
  // resolves through, rather than merely at whatever the environment claims.
  // Guarded exactly like verify-travel-province-move.ts:119-122 before it is
  // interpolated into SQL below.
  const uatDb = String(
    (await uat.request().query("SELECT DB_NAME() AS [db];")).recordset[0].db,
  );
  if (!/^[A-Za-z0-9_]+$/.test(uatDb)) {
    console.error(`refusing to interpolate an unexpected database name: ${uatDb}`);
    process.exit(1);
  }
  const problems: string[] = [];

  // 1. both tables are real tables in the database the app itself opens
  const there = await uat.request().query<{ tester: number | null; rate: number | null }>(`
    SELECT OBJECT_ID('dbo.UatTester', 'U') AS [tester],
           OBJECT_ID('dbo.UatTesterPerDiem', 'U') AS [rate];`);
  if (there.recordset[0].tester === null) {
    problems.push(`UatTester: not a table in ${uatDb} (the database this app opens with getUatFormPool())`);
  }
  if (there.recordset[0].rate === null) {
    problems.push(`UatTesterPerDiem: not a table in ${uatDb}`);
  }

  // 2. Fast_Core's object is a synonym pointing at that SAME database
  const syn = await core.request().query<{ base: string }>(`
    SELECT base_object_name AS [base] FROM sys.synonyms WHERE name = 'UatTester';`);
  if (syn.recordset.length !== 1) {
    problems.push("UatTester: Fast_Core has no synonym of that name");
  } else {
    const base = String(syn.recordset[0].base);
    if (base.indexOf(`[${uatDb}].`) < 0 || base.indexOf("UatTester") < 0) {
      problems.push(
        `UatTester: synonym points at ${base}, but this app reads ${uatDb} (MSSQL_FORM_UAT_DATABASE) through getUatFormPool()`,
      );
    } else {
      // 3. one round-trip, from the Fast_Core connection
      const both = await core.request().query<{ viaSynonym: number; direct: number }>(`
        SELECT (SELECT COUNT(*) FROM [dbo].[UatTester]) AS [viaSynonym],
               (SELECT COUNT(*) FROM [${uatDb}].[dbo].[UatTester]) AS [direct];`);
      const row = both.recordset[0];
      if (row.viaSynonym !== row.direct) {
        problems.push(
          `UatTester: read through the synonym returned ${row.viaSynonym}, direct count is ${row.direct}`,
        );
      }
    }
  }

  // 4. Fast_Core must NOT hold UatTesterPerDiem in any form
  const leftover = await core.request().query<{ obj: number | null }>(`
    SELECT OBJECT_ID('dbo.UatTesterPerDiem') AS [obj];`);
  if (leftover.recordset[0].obj !== null) {
    problems.push(
      "UatTesterPerDiem: Fast_Core still holds an object of that name. It gets no synonym by design, and a leftover table is a second copy that silently stops being written — run migration 141.",
    );
  }

  if (problems.length > 0) {
    console.error("FAIL — the UatTester move is not in the expected state:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(
    `PASS — UatTester and UatTesterPerDiem are tables in ${uatDb}, Fast_Core.dbo.UatTester is a synonym pointing there, and Fast_Core holds no UatTesterPerDiem.`,
  );
}

main().catch((err) => {
  console.error("check:uat-tester-home failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
