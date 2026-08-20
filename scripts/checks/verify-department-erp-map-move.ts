/* eslint-disable no-console */
/**
 * Verify the DepartmentErpMap move
 * (docs/superpowers/specs/2026-08-20-department-erp-map-move-design.md, section 8):
 *
 *   - Rocks_Portal_Form.dbo.DepartmentErpMap is a table, holds 3 rows, its
 *     identity is reseeded to 2004, and its ids/indexes match what 099 built
 *   - Fast_Core.dbo.DepartmentErpMap is a synonym pointing at the new home
 *   - a read through the synonym sees the same rows
 *   - a write through the synonym succeeds (rolled back, so no data moves)
 *
 * Read-only except for the rolled-back write probe in part 4.
 *
 * Usage:
 *   npx tsx scripts/checks/verify-department-erp-map-move.ts
 *
 * tsx does not auto-load .env.local or resolve the "@/" alias, so this
 * script loads env vars itself and imports the pool via a relative path.
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
    // Strip surrounding quotes to match Next.js / dotenv behaviour.
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

async function main() {
  loadDotEnvLocal();
  const { getCorePool, getProductionFormPool } = await import("../../src/lib/db/mssql");
  const core = await getCorePool();
  const form = await getProductionFormPool();
  const problems: string[] = [];

  // 1. the table, its rows and its shape
  const shape = await form.request().query(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[DepartmentErpMap]) AS rowCount,
      IDENT_CURRENT('dbo.DepartmentErpMap') AS identCurrent,
      OBJECT_ID('dbo.DepartmentErpMap', 'U') AS tableId;
  `);
  const s = shape.recordset[0];
  if (s.tableId === null) problems.push("Rocks_Portal_Form.dbo.DepartmentErpMap is not a table");
  if (s.rowCount !== 3) problems.push(`expected 3 rows, found ${s.rowCount}`);
  if (Number(s.identCurrent) !== 2004) problems.push(`IDENT_CURRENT is ${s.identCurrent}, expected 2004`);

  const ids = await form.request().query(
    `SELECT Id FROM [dbo].[DepartmentErpMap] ORDER BY Id;`
  );
  const idList = ids.recordset.map((r: { Id: number }) => r.Id).join(",");
  if (idList !== "1004,1005,1006") problems.push(`ids are ${idList}, expected 1004,1005,1006`);

  const idx = await form.request().query(`
    SELECT name FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.DepartmentErpMap') AND type > 0
    ORDER BY name;
  `);
  const idxNames = idx.recordset.map((r: { name: string }) => r.name).join(",");
  const expectedIdx = "IX_DepartmentErpMap_Brand,PK_DepartmentErpMap,UQ_DepartmentErpMap_Dept";
  if (idxNames !== expectedIdx) problems.push(`indexes are ${idxNames}, expected ${expectedIdx}`);

  // 2. the Fast_Core object is a synonym pointing at the new home
  const syn = await core.request().query(`
    SELECT base_object_name FROM sys.synonyms WHERE name = 'DepartmentErpMap';
  `);
  if (syn.recordset.length !== 1) {
    problems.push("Fast_Core has no synonym named DepartmentErpMap");
  } else {
    const base = String(syn.recordset[0].base_object_name);
    if (base.indexOf("Rocks_Portal_Form") < 0 || base.indexOf("DepartmentErpMap") < 0) {
      problems.push(`synonym points at ${base}`);
    }
  }

  // 3. a read through the synonym sees the same rows
  const through = await core.request().query(
    `SELECT COUNT(*) AS n FROM [dbo].[DepartmentErpMap];`
  );
  if (through.recordset[0].n !== 3) {
    problems.push(`read through the synonym returned ${through.recordset[0].n} rows, expected 3`);
  }

  // 4. a WRITE through the synonym succeeds -- this is the siblings'
  //    cross-database permission, and it would otherwise only be discovered
  //    the next time ACC Portal saved a mapping. Rolled back, so no data moves.
  const tx = core.transaction();
  await tx.begin();
  try {
    const w = await tx.request().query(`
      UPDATE [dbo].[DepartmentErpMap]
      SET HrDepartmentName = HrDepartmentName
      WHERE BrandCode = 'PCTH';
    `);
    if (!w.rowsAffected[0]) problems.push("write through the synonym affected no rows");
  } catch (e) {
    problems.push(`write through the synonym failed: ${(e as Error).message}`);
  } finally {
    await tx.rollback();
  }

  if (problems.length) {
    console.error("FAIL");
    for (const p of problems) console.error("  - " + p);
    process.exit(1);
  }
  console.log("OK: DepartmentErpMap lives in Rocks_Portal_Form and Fast_Core reaches it by synonym");
  process.exit(0);
}

main().catch((e) => {
  console.error("verify-department-erp-map-move failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
