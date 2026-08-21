/* eslint-disable no-console */
/**
 * Verify the ERP sync data move
 * (docs/superpowers/specs/2026-08-21-erp-sync-data-move-design.md, section 7):
 *
 *   - each of the five tables (ErpAccounts, ErpDimensionValue,
 *     ErpGeneralJournalBatch, ErpBankAccountCard, ErpSyncLog) is a table in
 *     Rocks_ERP_Data, holds more than zero rows, has an identity that has
 *     kept pace with the highest id actually in the table (IDENT_CURRENT >=
 *     MAX(Id), not the row count, which under-estimates MAX(Id) the moment
 *     ids have a gap), and carries the expected indexes -- name, whether each
 *     is a unique CONSTRAINT (as migration 101 creates the four UQ_*, versus
 *     a plain index for PK_* / IX_*), and key column order
 *   - Fast_Data holds a synonym of the same name for each, pointing at the
 *     Rocks_ERP_Data copy
 *   - a direct count in Rocks_ERP_Data and a count read through the Fast_Data
 *     synonym agree, both taken at run time
 *   - a write through the synonym succeeds, in the siblings' own MERGE shape
 *     (rolled back, so no data moves)
 *   - Fast_Data.dbo.TravelProvince -- a table the move must not touch -- is
 *     still a table
 *
 * Deliberately NOT checked: a literal row count or IDENT_CURRENT value.
 * These five tables are written by three applications on a sync schedule, so
 * a hardcoded count goes stale the moment any one of them runs a sync --
 * measured drift during Task 1 found three of the five already past their
 * "as measured" snapshot within the same day it was taken. Worse, after
 * migration 102 there is no independent source left to check a count
 * against: Fast_Data.dbo.ErpAccounts (and its four siblings) IS the synonym,
 * so a "direct" read in Rocks_ERP_Data and a read "through the synonym" in
 * Fast_Data are the only two vantage points there are, and comparing them is
 * a tautology about routing, not a fact about the data -- see part 3 below.
 *
 * Read-only except for the rolled-back write probe in part 4.
 *
 * Usage:
 *   npx tsx scripts/checks/verify-erp-data-move.ts
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

// Index SHAPE is structural -- unlike row counts it does not drift with a
// sync run, and it is the part of this gate that would actually catch a
// botched recreation. Checked per index below: the name (as a set, via the
// name-list comparison), whether it is a unique CONSTRAINT rather than a
// plain unique index -- name alone can't tell UQ_ErpAccounts-as-constraint
// apart from UQ_ErpAccounts-as-plain-index, and DROP INDEX against the
// former raises Msg 3723, which is what caught migration 097 -- and the key
// column order. INCLUDE columns are NOT checked here. No rows/ident fields
// on this constant on purpose -- see the header.
const EXPECTED = [
  { table: "ErpAccounts", indexes: [
      { name: "IX_ErpAccounts_BrandCategory", uniqueConstraint: false, keyCols: ["BrandCode", "AccountCategory"] },
      { name: "PK_ErpAccounts", uniqueConstraint: false, keyCols: ["Id"] },
      { name: "UQ_ErpAccounts", uniqueConstraint: true, keyCols: ["BrandCode", "AccountCategory", "AccountNo"] },
    ] },
  { table: "ErpDimensionValue", indexes: [
      { name: "IX_ErpDimensionValue_BrandDim", uniqueConstraint: false, keyCols: ["BrandCode", "DimensionCode"] },
      { name: "PK_ErpDimensionValue", uniqueConstraint: false, keyCols: ["Id"] },
      { name: "UQ_ErpDimensionValue", uniqueConstraint: true, keyCols: ["BrandCode", "DimensionCode", "Code"] },
    ] },
  { table: "ErpGeneralJournalBatch", indexes: [
      { name: "IX_ErpGeneralJournalBatch_Brand", uniqueConstraint: false, keyCols: ["BrandCode"] },
      { name: "PK_ErpGeneralJournalBatch", uniqueConstraint: false, keyCols: ["Id"] },
      { name: "UQ_ErpGeneralJournalBatch", uniqueConstraint: true, keyCols: ["BrandCode", "BatchName"] },
    ] },
  { table: "ErpBankAccountCard", indexes: [
      { name: "IX_ErpBankAccountCard_Brand", uniqueConstraint: false, keyCols: ["BrandCode"] },
      { name: "PK_ErpBankAccountCard", uniqueConstraint: false, keyCols: ["Id"] },
      { name: "UQ_ErpBankAccountCard", uniqueConstraint: true, keyCols: ["BrandCode", "AccountNo"] },
    ] },
  { table: "ErpSyncLog", indexes: [
      { name: "IX_ErpSyncLog_BrandStarted", uniqueConstraint: false, keyCols: ["BrandCode", "StartedAt"] },
      { name: "PK_ErpSyncLog", uniqueConstraint: false, keyCols: ["Id"] },
    ] },
];

async function main() {
  loadDotEnvLocal();
  const { getDataPool, getAppPool } = await import("../../src/lib/db/mssql");
  const data = await getDataPool();
  const erp = await getAppPool("Rocks_ERP_Data");
  const problems: string[] = [];

  for (const e of EXPECTED) {
    // 1a. the table exists -- its own query, on purpose. The row/identity
    //     query below names the table in a SELECT, and a SELECT that names a
    //     nonexistent table is an "Invalid object name" compile error that
    //     fails before OBJECT_ID's NULL could ever be inspected -- so folding
    //     the existence check into that same SELECT (as an earlier version of
    //     this script did) meant a partially-applied 101 aborted the whole
    //     script instead of naming which table was missing.
    const idOnly = await erp.request().query(`SELECT OBJECT_ID('dbo.${e.table}', 'U') AS [tableId];`);
    if (idOnly.recordset[0].tableId === null) {
      problems.push(`${e.table}: not a table in Rocks_ERP_Data`);
      continue;
    }

    // 1b. it holds more than zero rows, and its identity has kept pace with
    //     the highest id actually present -- MAX([Id]), not the row count.
    //     Row count under-estimates MAX(Id) the moment ids have a gap (any
    //     row that failed to copy, any id skipped upstream): 4,000 rows with
    //     MAX(Id) = 4813 and IDENT_CURRENT = 4500 would pass a row-count
    //     comparison and still collide on the next insert.
    const r = await erp.request().query(`
      SELECT (SELECT COUNT(*) FROM [dbo].[${e.table}]) AS [rowCnt],
             (SELECT MAX([Id]) FROM [dbo].[${e.table}]) AS [maxId],
             IDENT_CURRENT('dbo.${e.table}') AS [identCur];`);
    const row = r.recordset[0];
    if (!(row.rowCnt > 0)) problems.push(`${e.table}: holds ${row.rowCnt} rows, expected more than zero`);
    if (row.maxId !== null && Number(row.identCur) < row.maxId) {
      problems.push(`${e.table}: IDENT_CURRENT ${row.identCur} is behind MAX(Id) ${row.maxId}`);
    }

    // the indexes: the name set (structural, checked against a literal), then
    // per index whether it is a unique CONSTRAINT and its key column order.
    const idx = await erp.request().query(`
      SELECT name, is_unique_constraint AS [uniqueConstraint] FROM sys.indexes
      WHERE object_id = OBJECT_ID('dbo.${e.table}') AND type > 0 ORDER BY name;`);
    const gotNames = idx.recordset.map((x: { name: string }) => x.name).join(",");
    const expectedNames = e.indexes.map((i) => i.name).join(",");
    if (gotNames !== expectedNames) {
      problems.push(`${e.table}: indexes are ${gotNames}, expected ${expectedNames}`);
    }
    for (const expIdx of e.indexes) {
      const found = idx.recordset.find((x: { name: string }) => x.name === expIdx.name);
      if (!found) continue; // already reported by the name-set check above
      if (Boolean(found.uniqueConstraint) !== expIdx.uniqueConstraint) {
        problems.push(
          `${e.table}: ${expIdx.name} is_unique_constraint=${found.uniqueConstraint}, expected ${expIdx.uniqueConstraint}`,
        );
      }
      const cols = await erp.request().query(`
        SELECT c.name AS [colName]
        FROM sys.index_columns ic
        JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
        WHERE ic.object_id = OBJECT_ID('dbo.${e.table}')
          AND ic.index_id = (SELECT index_id FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.${e.table}') AND name = '${expIdx.name}')
          AND ic.is_included_column = 0
        ORDER BY ic.key_ordinal;`);
      const gotCols = cols.recordset.map((x: { colName: string }) => x.colName).join(",");
      const expCols = expIdx.keyCols.join(",");
      if (gotCols !== expCols) {
        problems.push(`${e.table}: ${expIdx.name} key columns are ${gotCols}, expected ${expCols}`);
      }
    }

    // 2. the Fast_Data object is a synonym pointing at the new home
    const syn = await data.request().query(`
      SELECT base_object_name AS [base] FROM sys.synonyms WHERE name = '${e.table}';`);
    if (syn.recordset.length !== 1) {
      problems.push(`${e.table}: Fast_Data has no synonym of that name`);
    } else {
      const base = String(syn.recordset[0].base);
      if (base.indexOf("Rocks_ERP_Data") < 0 || base.indexOf(e.table) < 0) {
        problems.push(`${e.table}: synonym points at ${base}`);
      }
    }

    // 3. the direct count (Rocks_ERP_Data) and the count read through the
    //    Fast_Data synonym agree, both taken right now. This is a tautology
    //    about routing, not a fact about the data -- Fast_Data.dbo.${e.table}
    //    IS the synonym, so "direct" and "through the synonym" hit the same
    //    object. What it actually proves is that the synonym resolves and
    //    answers a query at all, which is worth catching on its own.
    const thru = await data.request().query(`SELECT COUNT(*) AS [n] FROM [dbo].[${e.table}];`);
    if (thru.recordset[0].n !== row.rowCnt) {
      problems.push(`${e.table}: read through the synonym returned ${thru.recordset[0].n}, direct count is ${row.rowCnt}`);
    }
  }

  // 4. a WRITE through a synonym succeeds. This is the siblings' cross-database
  //    permission, which would otherwise be discovered the next time either app
  //    ran a sync. MERGE, because that is the shape all three actually use.
  //    Rolled back, so no data moves.
  const tx = data.transaction();
  await tx.begin();
  try {
    const w = await tx.request().query(`
      MERGE [dbo].[ErpSyncLog] AS t
      USING (SELECT TOP (1) [Id] FROM [dbo].[ErpSyncLog] ORDER BY [Id]) AS s
        ON t.[Id] = s.[Id]
      WHEN MATCHED THEN UPDATE SET t.[Status] = t.[Status];`);
    if (!w.rowsAffected[0]) problems.push("write through the ErpSyncLog synonym affected no rows");
  } catch (err) {
    problems.push(`write through the synonym failed: ${(err as Error).message}`);
  } finally {
    await tx.rollback();
  }

  // 5. Fast_Data still holds what it is supposed to hold. The move must not
  //    have reached anything outside its five.
  const tp = await data.request().query(`SELECT OBJECT_ID('dbo.TravelProvince', 'U') AS [oid];`);
  if (tp.recordset[0].oid === null) problems.push("Fast_Data.dbo.TravelProvince is no longer a table");

  if (problems.length) {
    console.error("FAIL");
    for (const p of problems) console.error("  - " + p);
    process.exit(1);
  }
  console.log("OK: the five ERP sync tables live in Rocks_ERP_Data and Fast_Data reaches them by synonym");
  process.exit(0);
}

main().catch((e) => {
  console.error("verify-erp-data-move failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
