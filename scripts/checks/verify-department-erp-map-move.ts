/* eslint-disable no-console */
/**
 * Verify the DepartmentErpMap move
 * (docs/superpowers/specs/2026-08-20-department-erp-map-move-design.md, section 8):
 *
 *   - Rocks_Portal_Form.dbo.DepartmentErpMap is a table, holds 3 rows, its
 *     identity is reseeded to 2004, and its ids/indexes match what 099 built
 *     -- including that UQ_DepartmentErpMap_Dept is a plain unique INDEX
 *     (not a unique constraint) keyed FormCode, BrandCode, DepartmentCode
 *   - Fast_Core.dbo.DepartmentErpMap is a synonym pointing at the new home
 *   - a read through the synonym sees the same rows
 *   - a write through the synonym succeeds, in the siblings' own MERGE shape
 *     (rolled back, so no data moves)
 *   - Rocks_Portal_Form_UAT.dbo.DepartmentErpMap does not exist -- this table
 *     is deliberately a single copy and must never reach the UAT twin
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
  const { getCorePool, getProductionFormPool, getUatFormPool } = await import(
    "../../src/lib/db/mssql"
  );
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
    SELECT name, is_unique, is_unique_constraint FROM sys.indexes
    WHERE object_id = OBJECT_ID('dbo.DepartmentErpMap') AND type > 0
    ORDER BY name;
  `);
  const idxRows = idx.recordset as {
    name: string;
    is_unique: boolean;
    is_unique_constraint: boolean;
  }[];
  const idxNames = idxRows.map((r) => r.name).join(",");
  const expectedIdx = "IX_DepartmentErpMap_Brand,PK_DepartmentErpMap,UQ_DepartmentErpMap_Dept";
  if (idxNames !== expectedIdx) problems.push(`indexes are ${idxNames}, expected ${expectedIdx}`);

  // UQ_DepartmentErpMap_Dept must be a plain unique INDEX, not a unique
  // CONSTRAINT -- name alone can't tell the two apart, and 099's own header
  // calls this property out (migration 098 converted it from the latter).
  const uq = idxRows.find((r) => r.name === "UQ_DepartmentErpMap_Dept");
  if (uq && (!uq.is_unique || uq.is_unique_constraint)) {
    problems.push(
      `UQ_DepartmentErpMap_Dept is_unique=${uq.is_unique} is_unique_constraint=${uq.is_unique_constraint}, expected a plain unique index (is_unique=1, is_unique_constraint=0)`,
    );
  }

  // Key column order matters here: the whole per-form default/override rule
  // (src/lib/acc/per-form-config.ts) depends on FormCode leading so that a
  // NULL default and a form-specific override can coexist per brand/dept.
  const uqCols = await form.request().query(`
    SELECT c.name AS colName
    FROM sys.index_columns ic
    JOIN sys.columns c
      ON c.object_id = ic.object_id AND c.column_id = ic.column_id
    WHERE ic.object_id = OBJECT_ID('dbo.DepartmentErpMap')
      AND ic.index_id = (
        SELECT index_id FROM sys.indexes
        WHERE object_id = OBJECT_ID('dbo.DepartmentErpMap') AND name = 'UQ_DepartmentErpMap_Dept'
      )
    ORDER BY ic.key_ordinal;
  `);
  const uqColList = uqCols.recordset.map((r: { colName: string }) => r.colName).join(",");
  const expectedUqCols = "FormCode,BrandCode,DepartmentCode";
  if (uqColList !== expectedUqCols) {
    problems.push(`UQ_DepartmentErpMap_Dept columns are ${uqColList}, expected ${expectedUqCols}`);
  }

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
  //    the next time ACC Portal saved a mapping. A MERGE, because that is
  //    the siblings' real write shape (spec section 8.4): both upsert
  //    through a MERGE with an explicit column list. Keyed on Id -- picked
  //    dynamically, not on a hard-coded brand like 'PCTH' -- so the probe
  //    does not go stale the day the sole brand changes. Rolled back, so no
  //    data moves.
  const tx = core.transaction();
  await tx.begin();
  try {
    const w = await tx.request().query(`
      MERGE INTO [dbo].[DepartmentErpMap] AS tgt
      USING (SELECT TOP (1) [Id], [HrDepartmentName] FROM [dbo].[DepartmentErpMap] ORDER BY [Id]) AS src
        ON tgt.[Id] = src.[Id]
      WHEN MATCHED THEN
        UPDATE SET [HrDepartmentName] = src.[HrDepartmentName];
    `);
    if (!w.rowsAffected[0]) problems.push("write through the synonym affected no rows");
  } catch (e) {
    problems.push(`write through the synonym failed: ${(e as Error).message}`);
  } finally {
    await tx.rollback();
  }

  // 5. Global Constraint: never in the UAT twin. 099 refuses %_UAT at apply
  //    time, and check:alignment only compares MASTER_TABLES (this table is
  //    deliberately absent from that list), so a hand-created UAT copy would
  //    otherwise go undetected indefinitely.
  const uatForm = await getUatFormPool();
  const uatCheck = await uatForm.request().query(
    `SELECT OBJECT_ID('dbo.DepartmentErpMap') AS oid;`,
  );
  if (uatCheck.recordset[0].oid !== null) {
    problems.push(
      "Rocks_Portal_Form_UAT.dbo.DepartmentErpMap exists -- it must never be created there",
    );
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
