/* eslint-disable no-console */
/**
 * Verify the UatTesterPerDiem move (docs/superpowers/specs/2026-09-07-uat-tester-move-design.md):
 *
 *   - UatTesterPerDiem is a TABLE in the database this app actually resolves
 *     through getUatFormPool() / MSSQL_FORM_UAT_DATABASE -- not merely in some
 *     database called Rocks_Portal_Form_UAT
 *   - Fast_Core does NOT hold UatTesterPerDiem, as an object of any kind. It
 *     gets no synonym -- nothing outside this application names it -- and a
 *     leftover table there would be a second copy that silently stops being
 *     written
 *
 * `UatTester` itself is out of scope for this check: it did not move and
 * stays in `Fast_Core` -- see the design doc's §2 and §12.
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
  // -- this is what proves the check looks at the database the app actually
  // resolves through, rather than merely at whatever the environment claims.
  // Validated before use, the way verify-travel-province-move.ts:119-122 does.
  // Nothing below interpolates it into SQL today -- the only interpolation was
  // the synonym round-trip this check no longer has -- and the guard stands so
  // that a future check which does interpolate cannot forget it.
  const uatDb = String(
    (await uat.request().query("SELECT DB_NAME() AS [db];")).recordset[0].db,
  );
  if (!/^[A-Za-z0-9_]+$/.test(uatDb)) {
    console.error(`refusing to interpolate an unexpected database name: ${uatDb}`);
    process.exit(1);
  }
  const problems: string[] = [];

  // 1. UatTesterPerDiem is a real table in the database the app itself opens
  const there = await uat.request().query<{ rate: number | null }>(`
    SELECT OBJECT_ID('dbo.UatTesterPerDiem', 'U') AS [rate];`);
  if (there.recordset[0].rate === null) {
    problems.push(`UatTesterPerDiem: not a table in ${uatDb} (the database this app opens with getUatFormPool()) — run migration 139.`);
  }

  // 2. Fast_Core must NOT hold UatTesterPerDiem in any form
  const leftover = await core.request().query<{ obj: number | null }>(`
    SELECT OBJECT_ID('dbo.UatTesterPerDiem') AS [obj];`);
  if (leftover.recordset[0].obj !== null) {
    problems.push(
      "UatTesterPerDiem: Fast_Core still holds an object of that name. It gets no synonym by design, and a leftover table is a second copy that silently stops being written — run migration 140.",
    );
  }

  if (problems.length > 0) {
    console.error("FAIL — the UatTesterPerDiem move is not in the expected state:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(
    `PASS — UatTesterPerDiem is a table in ${uatDb}, and Fast_Core holds no object of that name.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("check:uat-tester-home failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
