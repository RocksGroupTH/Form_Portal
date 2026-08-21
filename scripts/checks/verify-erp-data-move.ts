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
 *     is a unique CONSTRAINT (true only for the four UQ_*), whether each is
 *     the PRIMARY KEY (true only for the five PK_*, so a PK_* silently
 *     recreated as a plain non-unique index is caught the same way a UQ_*
 *     recreated as a plain index is), and key column order (including DESC
 *     where the source has it)
 *   - Fast_Data holds a synonym of the same name for each, pointing at the
 *     Rocks_ERP_Data copy
 *   - a direct count in Rocks_ERP_Data and a count read through the Fast_Data
 *     synonym agree, both taken in ONE query / ONE round-trip -- not two
 *     separate reads against two pools. After 102 both name the same
 *     physical object, so two separate reads can only disagree if a sync
 *     lands in the gap between them: a healthy system reporting red because
 *     of ordinary network latency is the same class of flakiness the literal
 *     row counts were removed for, just a millisecond-scale window instead
 *     of a day-scale one
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
 * IT REDS ON A FRESH STAND-UP, BY DESIGN -- the run itself is harmless, but
 * the verdict is not usable there. "holds more than zero rows" is an
 * assertion about a system that has already synced Business Central at least
 * once, so a database built by migration 101 against an empty (or newly
 * restored and never-synced) source reds here on all five tables. That is the
 * intended trade -- an empty ErpAccounts in a live deployment means the sync
 * has stopped and the ERP prep queue is resolving nothing -- but on a stand-up
 * it means "no sync has run yet", not "the move is broken". Run one sync from
 * Settings first, then this.
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
// former raises Msg 3723, which is what caught migration 097 -- whether it
// IS the PRIMARY KEY (the same hole one object over: a PK_* silently
// recreated as a plain non-unique index has the right name and passes the
// unique-constraint check too, since a PK is never a UNIQUE CONSTRAINT
// either), and the key column order, DESC-qualified where the source index
// is descending. INCLUDE columns are NOT checked here. No rows/ident fields
// on this constant on purpose -- see the header.
const EXPECTED = [
  { table: "ErpAccounts", indexes: [
      { name: "IX_ErpAccounts_BrandCategory", uniqueConstraint: false, primaryKey: false, keyCols: ["BrandCode", "AccountCategory"] },
      { name: "PK_ErpAccounts", uniqueConstraint: false, primaryKey: true, keyCols: ["Id"] },
      { name: "UQ_ErpAccounts", uniqueConstraint: true, primaryKey: false, keyCols: ["BrandCode", "AccountCategory", "AccountNo"] },
    ] },
  { table: "ErpDimensionValue", indexes: [
      { name: "IX_ErpDimensionValue_BrandDim", uniqueConstraint: false, primaryKey: false, keyCols: ["BrandCode", "DimensionCode"] },
      { name: "PK_ErpDimensionValue", uniqueConstraint: false, primaryKey: true, keyCols: ["Id"] },
      { name: "UQ_ErpDimensionValue", uniqueConstraint: true, primaryKey: false, keyCols: ["BrandCode", "DimensionCode", "Code"] },
    ] },
  { table: "ErpGeneralJournalBatch", indexes: [
      { name: "IX_ErpGeneralJournalBatch_Brand", uniqueConstraint: false, primaryKey: false, keyCols: ["BrandCode"] },
      { name: "PK_ErpGeneralJournalBatch", uniqueConstraint: false, primaryKey: true, keyCols: ["Id"] },
      { name: "UQ_ErpGeneralJournalBatch", uniqueConstraint: true, primaryKey: false, keyCols: ["BrandCode", "BatchName"] },
    ] },
  { table: "ErpBankAccountCard", indexes: [
      { name: "IX_ErpBankAccountCard_Brand", uniqueConstraint: false, primaryKey: false, keyCols: ["BrandCode"] },
      { name: "PK_ErpBankAccountCard", uniqueConstraint: false, primaryKey: true, keyCols: ["Id"] },
      { name: "UQ_ErpBankAccountCard", uniqueConstraint: true, primaryKey: false, keyCols: ["BrandCode", "AccountNo"] },
    ] },
  { table: "ErpSyncLog", indexes: [
      { name: "IX_ErpSyncLog_BrandStarted", uniqueConstraint: false, primaryKey: false, keyCols: ["BrandCode", "StartedAt DESC"] },
      { name: "PK_ErpSyncLog", uniqueConstraint: false, primaryKey: true, keyCols: ["Id"] },
    ] },
];

async function main() {
  loadDotEnvLocal();
  const { getDataPool, getErpDataPool } = await import("../../src/lib/db/mssql");
  const data = await getDataPool();
  // getErpDataPool(), never getAppPool("Rocks_ERP_Data"). The literal made this
  // gate report on the migration's target while the app read wherever
  // MSSQL_ERP_DATA_DATABASE pointed -- the one disagreement it exists to catch.
  const erp = await getErpDataPool();
  const erpDb = String(
    (await erp.request().query("SELECT DB_NAME() AS [db];")).recordset[0].db,
  );
  if (!/^[A-Za-z0-9_]+$/.test(erpDb)) {
    console.error(`refusing to interpolate an unexpected database name: ${erpDb}`);
    process.exit(1);
  }
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
      problems.push(`${e.table}: not a table in ${erpDb} (the database this app reads)`);
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
    // per index whether it is a unique CONSTRAINT, whether it IS the PRIMARY
    // KEY, and its key column order.
    const idx = await erp.request().query(`
      SELECT name, is_unique_constraint AS [uniqueConstraint], is_primary_key AS [primaryKey]
      FROM sys.indexes
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
      if (Boolean(found.primaryKey) !== expIdx.primaryKey) {
        problems.push(
          `${e.table}: ${expIdx.name} is_primary_key=${found.primaryKey}, expected ${expIdx.primaryKey}`,
        );
      }
      // is_descending_key rides along for free -- IX_ErpSyncLog_BrandStarted
      // is (BrandCode, StartedAt DESC) in the source, and without this the
      // DESC would be unverified. Rendered as a " DESC" suffix on the column
      // name so EXPECTED can spell it the same way migration 101 does.
      const cols = await erp.request().query(`
        SELECT c.name AS [colName], ic.is_descending_key AS [isDesc]
        FROM sys.index_columns ic
        JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
        WHERE ic.object_id = OBJECT_ID('dbo.${e.table}')
          AND ic.index_id = (SELECT index_id FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.${e.table}') AND name = '${expIdx.name}')
          AND ic.is_included_column = 0
        ORDER BY ic.key_ordinal;`);
      const gotCols = cols.recordset
        .map((x: { colName: string; isDesc: boolean }) => x.colName + (x.isDesc ? " DESC" : ""))
        .join(",");
      const expCols = expIdx.keyCols.join(",");
      if (gotCols !== expCols) {
        problems.push(`${e.table}: ${expIdx.name} key columns are ${gotCols}, expected ${expCols}`);
      }
    }

    // 2. the Fast_Data object is a synonym pointing at the new home -- and
    //    specifically at the SAME database this app resolves through
    //    MSSQL_ERP_DATA_DATABASE, not merely at some database called
    //    Rocks_ERP_Data. Migration 102 hard-codes [Rocks_ERP_Data] as every
    //    synonym's base object; repointing the env var makes this app read a
    //    different mirror than the one Rocks Fast writes through Fast_Data,
    //    with no error anywhere, on the path that builds Business Central
    //    journal lines. Comparing the two here is what makes that loud.
    const syn = await data.request().query(`
      SELECT base_object_name AS [base] FROM sys.synonyms WHERE name = '${e.table}';`);
    if (syn.recordset.length !== 1) {
      problems.push(`${e.table}: Fast_Data has no synonym of that name`);
    } else {
      const base = String(syn.recordset[0].base);
      if (base.indexOf(`[${erpDb}].`) < 0 || base.indexOf(e.table) < 0) {
        problems.push(
          `${e.table}: synonym points at ${base}, but this app reads ${erpDb} (MSSQL_ERP_DATA_DATABASE)`,
        );
      }
    }

    // 3. the direct count (Rocks_ERP_Data) and the count read through the
    //    Fast_Data synonym agree -- taken in ONE query, ONE round-trip, from
    //    the Fast_Data connection referencing Rocks_ERP_Data three-part
    //    (both databases are on the same instance, same as migration 102's
    //    own guard does it). NOT two separate .query() calls: after 102 both
    //    sides name the same physical object, so two round-trips can only
    //    disagree if a sync lands in the gap between them -- a healthy
    //    system reporting red because of network latency, the same class of
    //    flakiness the literal row counts were removed for, just
    //    milliseconds instead of a day. This is a tautology about routing,
    //    not a fact about the data -- Fast_Data.dbo.${e.table} IS the
    //    synonym, so "direct" and "through the synonym" hit the same object.
    //    What it actually proves is that the synonym resolves and answers a
    //    query at all, which is worth catching on its own.
    const both = await data.request().query(`
      SELECT (SELECT COUNT(*) FROM [dbo].[${e.table}]) AS [viaSynonym],
             (SELECT COUNT(*) FROM [${erpDb}].[dbo].[${e.table}]) AS [direct];`);
    const bothRow = both.recordset[0];
    if (bothRow.viaSynonym !== bothRow.direct) {
      problems.push(`${e.table}: read through the synonym returned ${bothRow.viaSynonym}, direct count is ${bothRow.direct}`);
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
  console.log(`OK: the five ERP sync tables live in ${erpDb} and Fast_Data reaches them by synonym`);
  process.exit(0);
}

main().catch((e) => {
  console.error("verify-erp-data-move failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
