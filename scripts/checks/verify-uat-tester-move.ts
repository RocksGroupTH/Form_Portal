/* eslint-disable no-console */
/**
 * Verify the TesterPerDiem move (docs/superpowers/specs/2026-09-07-uat-tester-move-design.md):
 *
 *   - TesterPerDiem is a TABLE in the database this app actually resolves
 *     through getUatFormPool() / MSSQL_FORM_UAT_DATABASE -- not merely in some
 *     database called Rocks_Portal_Form_UAT
 *   - Fast_Core does NOT hold UatTesterPerDiem, as an object of any kind. It
 *     gets no synonym -- nothing outside this application names it -- and a
 *     leftover table there would be a second copy that silently stops being
 *     written
 *   - TesterPerDiem has no IsActive column. Nothing reads one any more, so a
 *     survivor is a stale flag waiting to be mistaken for a live one
 *   - the UAT database does not still hold the OLD name either. Migration 142
 *     renamed UatTesterPerDiem -> TesterPerDiem and left a synonym for the
 *     build that was still running; 143 drops it. A leftover TABLE means a
 *     half-applied rename, a leftover SYNONYM means 143 has not run yet, and
 *     the two get different advice because a synonym breaks nothing and a
 *     second table does
 *
 * The command keeps its name, check:uat-tester-home. It is about where this
 * app's UAT-only tables live, which the rename did not change.
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

  // 1. TesterPerDiem is a real table in the database the app itself opens
  const there = await uat.request().query<{ rate: number | null }>(`
    SELECT OBJECT_ID('dbo.TesterPerDiem', 'U') AS [rate];`);
  if (there.recordset[0].rate === null) {
    problems.push(`TesterPerDiem: not a table in ${uatDb} (the database this app opens with getUatFormPool()) — run migrations 139 and 142.`);
  }

  // 2. Fast_Core must NOT hold the table under its ORIGINAL name.
  //
  // The old name is deliberate and is not an oversight of the rename: Fast_Core
  // never held anything called TesterPerDiem. Migration 138 created
  // UatTesterPerDiem there and 140 dropped it, so UatTesterPerDiem is the only
  // name that can be left behind — probing for the new one would pass on a
  // database that still holds the old copy, which is the exact failure this
  // check exists for.
  const leftover = await core.request().query<{ obj: number | null }>(`
    SELECT OBJECT_ID('dbo.UatTesterPerDiem') AS [obj];`);
  if (leftover.recordset[0].obj !== null) {
    problems.push(
      "UatTesterPerDiem: Fast_Core still holds an object of that name. It gets no synonym by design, and a leftover table is a second copy that silently stops being written — run migration 140.",
    );
  }

  // 3. The old name must not survive in the UAT database either.
  //
  // A half-applied rename is the one failure in this sequence that is SILENT:
  // every query in src/ names TesterPerDiem, so a database still holding
  // UatTesterPerDiem as a TABLE fails loudly at the first read, but a leftover
  // SYNONYM fails nothing at all and simply leaves two names for one table
  // forever. The two cases get different advice because they have different
  // remedies, and the synonym one is legitimate for as long as it takes to
  // deploy: 142 creates it precisely so the previous build keeps working, and
  // 143 removes it afterwards.
  const oldHere = await uat.request().query<{ tbl: number | null; syn: number | null }>(`
    SELECT OBJECT_ID('dbo.UatTesterPerDiem', 'U')  AS [tbl],
           OBJECT_ID('dbo.UatTesterPerDiem', 'SN') AS [syn];`);
  if (oldHere.recordset[0].tbl !== null) {
    problems.push(
      `UatTesterPerDiem: ${uatDb} still holds a TABLE of that name beside TesterPerDiem. The rename is half applied, or migration 139 was re-run after 142 — 139's guard is satisfied by the synonym, so re-running it creates a second, empty table. Establish which one holds the rates before dropping anything.`,
    );
  } else if (oldHere.recordset[0].syn !== null) {
    // Not a fault, but not the finished state either, and this check asserts the
    // finished state. It said "expected" while returning exit 1, which is two
    // answers to one question.
    problems.push(
      `UatTesterPerDiem: ${uatDb} still has the synonym migration 142 leaves behind for the previous build, so the sequence is not finished. Harmless — both names resolve — but run migration 143 once the new build is live.`,
    );
  }

  // 4. The column this work exists to remove is actually gone.
  //
  // Everything above is about WHERE the table is and what it is called. None of
  // it notices an IsActive that survived, and a surviving IsActive is not inert:
  // nothing reads it any more, so it would sit there collecting stale values
  // that a future reader could mistake for a live flag and re-introduce the
  // filter that priced a switched-off tester at their real HR salary.
  const shape = await uat.request().query<{ isActive: number | null }>(`
    SELECT COL_LENGTH('dbo.TesterPerDiem', 'IsActive') AS [isActive];`);
  if (shape.recordset[0].isActive !== null) {
    problems.push(
      `TesterPerDiem: ${uatDb} still has an IsActive column. Every stored rate is meant to count, with the effective date the only selector, as in HR — run migration 143.`,
    );
  }

  if (problems.length > 0) {
    console.error("FAIL — the TesterPerDiem move is not in the expected state:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(
    `PASS — TesterPerDiem is a table in ${uatDb} with no IsActive column, nothing ` +
      "there still answers to UatTesterPerDiem, and Fast_Core holds no object of " +
      "that name either.",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("check:uat-tester-home failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
