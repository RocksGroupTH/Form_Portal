/* eslint-disable no-console */
/**
 * Verify the TravelProvince move
 * (docs/superpowers/specs/2026-08-21-travel-province-move-design.md, section 7):
 *
 *   - Rocks_Portal_Form.dbo.TravelProvince is a table, holds more than zero
 *     rows, has an identity that has kept pace with the highest id actually
 *     in the table (IDENT_CURRENT >= MAX([Id]), not the row count, which
 *     under-estimates MAX([Id]) the moment ids have a gap), and carries both
 *     index objects under their original names -- PK_TravelProvince and
 *     UQ_TravelProvince_NameTh, the latter still a unique CONSTRAINT rather
 *     than a plain unique index (DROP INDEX against the wrong shape raises
 *     Msg 3723, the trap migration 097 hit) -- each with its expected key
 *     column order
 *   - Fast_Data holds a synonym named TravelProvince, and its
 *     base_object_name names the SAME database getProductionFormPool()
 *     actually resolves (env.MSSQL_FORM_DATABASE) -- not merely some
 *     database literally called Rocks_Portal_Form, so a repointed
 *     MSSQL_FORM_DATABASE reds here instead of silently reading elsewhere
 *   - a direct count in Rocks_Portal_Form and a count read through the
 *     Fast_Data synonym agree, both taken in ONE query / ONE round-trip --
 *     not two separate reads against two pools, which could only disagree
 *     because of ordinary network latency between them, not because of a
 *     real fault
 *   - Rocks_Portal_Form_UAT does NOT have a dbo.TravelProvince object of any
 *     kind -- this table is deliberately a single copy: not dual-written,
 *     not in MASTER_TABLES, and never created in the UAT twin
 *   - Fast_Data still holds its Intel_* / IntelMkt* tables (Rocks Fast's
 *     Intelligence feature, untouched by this move) and the five Erp*
 *     synonyms migrations 101/102 left behind -- proof the move did not
 *     reach anything outside TravelProvince
 *
 * Deliberately NOT checked: a write through the synonym. Nothing writes this
 * table in any of the three applications -- it was seeded by migration 049
 * and has been read-only since, swept for INSERT/UPDATE/DELETE/MERGE across
 * all three repositories while the move was designed -- so proving a
 * cross-database write permission would assert something no caller needs.
 * Its absence here is a decision, not an oversight.
 *
 * Also deliberately NOT checked: a literal row count or IDENT_CURRENT value.
 * 77 rows is what was measured on 2026-08-21, but a future edit to this
 * script's expectations should not be needed just because someone adds a
 * province -- "more than zero, and the identity has kept pace" is the
 * property that actually matters.
 *
 * Read-only.
 *
 * Runs red until both migrations have been applied: Task 1 (this script)
 * only writes it, Task 2 applies 104 then 105 and runs it for the first time.
 *
 * Usage:
 *   npx tsx scripts/checks/verify-travel-province-move.ts
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

// Index SHAPE is structural -- it does not drift the way a row count does,
// and it is the part of this gate that would actually catch a botched
// recreation. Checked per index below: the name (as a set, via the name-list
// comparison), whether it is a unique CONSTRAINT rather than a plain unique
// index -- name alone can't tell UQ_TravelProvince_NameTh-as-constraint apart
// from UQ_TravelProvince_NameTh-as-plain-index, and DROP INDEX against the
// former raises Msg 3723 -- whether it IS the PRIMARY KEY (the same hole one
// object over: a PK_* silently recreated as a plain non-unique index has the
// right name and passes the unique-constraint check too, since a PK is never
// a UNIQUE CONSTRAINT either), and the key column order. No rows/ident fields
// on this constant on purpose -- see the header.
const EXPECTED_INDEXES = [
  { name: "PK_TravelProvince", uniqueConstraint: false, primaryKey: true, keyCols: ["Id"] },
  { name: "UQ_TravelProvince_NameTh", uniqueConstraint: true, primaryKey: false, keyCols: ["NameTh"] },
];

// Fixed by migration 102 and not expected to change; hardcoding these five
// names is no different from hardcoding EXPECTED_INDEXES above -- it is
// structure, not data that drifts with ordinary use.
const EXPECTED_ERP_SYNONYMS = [
  "ErpAccounts",
  "ErpBankAccountCard",
  "ErpDimensionValue",
  "ErpGeneralJournalBatch",
  "ErpSyncLog",
];

async function main() {
  loadDotEnvLocal();
  const { getProductionFormPool, getUatFormPool, getDataPool } = await import(
    "../../src/lib/db/mssql"
  );
  const form = await getProductionFormPool();
  const data = await getDataPool();
  const formDb = String(
    (await form.request().query("SELECT DB_NAME() AS [db];")).recordset[0].db,
  );
  if (!/^[A-Za-z0-9_]+$/.test(formDb)) {
    console.error(`refusing to interpolate an unexpected database name: ${formDb}`);
    process.exit(1);
  }
  const problems: string[] = [];

  // 1a. the table exists -- its own query, on purpose. The row/identity query
  //     below names the table in a SELECT, and a SELECT that names a
  //     nonexistent table is an "Invalid object name" compile error that
  //     fails before OBJECT_ID's NULL could ever be inspected -- so folding
  //     the existence check into that same SELECT would mean a
  //     not-yet-applied (or partially-applied) 104 aborted the whole script
  //     with a generic error instead of a clean, specific problem.
  const idOnly = await form.request().query(`SELECT OBJECT_ID('dbo.TravelProvince', 'U') AS [tableId];`);
  if (idOnly.recordset[0].tableId === null) {
    problems.push(`TravelProvince: not a table in ${formDb} (the database this app resolves through getProductionFormPool())`);
  } else {
    // 1b. more than zero rows, and the identity has kept pace with the
    //     highest id actually present -- MAX([Id]), not the row count.
    const r = await form.request().query(`
      SELECT (SELECT COUNT(*) FROM [dbo].[TravelProvince]) AS [rowCnt],
             (SELECT MAX([Id]) FROM [dbo].[TravelProvince]) AS [maxId],
             IDENT_CURRENT('dbo.TravelProvince') AS [identCur];`);
    const row = r.recordset[0];
    if (!(row.rowCnt > 0)) problems.push(`TravelProvince: holds ${row.rowCnt} rows, expected more than zero`);
    if (row.maxId !== null && Number(row.identCur) < row.maxId) {
      problems.push(`TravelProvince: IDENT_CURRENT ${row.identCur} is behind MAX([Id]) ${row.maxId}`);
    }

    // 1c. both index objects, under their original names, with the right
    //     shape and key column order.
    const idx = await form.request().query(`
      SELECT name, is_unique_constraint AS [uniqueConstraint], is_primary_key AS [primaryKey]
      FROM sys.indexes
      WHERE object_id = OBJECT_ID('dbo.TravelProvince') AND type > 0 ORDER BY name;`);
    const gotNames = idx.recordset.map((x: { name: string }) => x.name).join(",");
    const expectedNames = EXPECTED_INDEXES.map((i) => i.name).join(",");
    if (gotNames !== expectedNames) {
      problems.push(`TravelProvince: indexes are ${gotNames}, expected ${expectedNames}`);
    }
    for (const expIdx of EXPECTED_INDEXES) {
      const found = idx.recordset.find((x: { name: string }) => x.name === expIdx.name);
      if (!found) continue; // already reported by the name-set check above
      if (Boolean(found.uniqueConstraint) !== expIdx.uniqueConstraint) {
        problems.push(
          `TravelProvince: ${expIdx.name} is_unique_constraint=${found.uniqueConstraint}, expected ${expIdx.uniqueConstraint}`,
        );
      }
      if (Boolean(found.primaryKey) !== expIdx.primaryKey) {
        problems.push(
          `TravelProvince: ${expIdx.name} is_primary_key=${found.primaryKey}, expected ${expIdx.primaryKey}`,
        );
      }
      const cols = await form.request().query(`
        SELECT c.name AS [colName], ic.is_descending_key AS [isDesc]
        FROM sys.index_columns ic
        JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
        WHERE ic.object_id = OBJECT_ID('dbo.TravelProvince')
          AND ic.index_id = (SELECT index_id FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.TravelProvince') AND name = '${expIdx.name}')
          AND ic.is_included_column = 0
        ORDER BY ic.key_ordinal;`);
      const gotCols = cols.recordset
        .map((x: { colName: string; isDesc: boolean }) => x.colName + (x.isDesc ? " DESC" : ""))
        .join(",");
      const expCols = expIdx.keyCols.join(",");
      if (gotCols !== expCols) {
        problems.push(`TravelProvince: ${expIdx.name} key columns are ${gotCols}, expected ${expCols}`);
      }
    }

    // 2. the Fast_Data object is a synonym pointing at the new home -- and
    //    specifically at the SAME database this app resolves through
    //    getProductionFormPool() / MSSQL_FORM_DATABASE, not merely at some
    //    database called Rocks_Portal_Form. Migration 105 hard-codes
    //    [Rocks_Portal_Form] as the synonym's base object; repointing the env
    //    var would make this app read a different database than the one the
    //    synonym -- and therefore the Rocks Fast / ACC Portal siblings --
    //    still points at, with no error anywhere.
    const syn = await data.request().query(`
      SELECT base_object_name AS [base] FROM sys.synonyms WHERE name = 'TravelProvince';`);
    if (syn.recordset.length !== 1) {
      problems.push("TravelProvince: Fast_Data has no synonym of that name");
    } else {
      const base = String(syn.recordset[0].base);
      if (base.indexOf(`[${formDb}].`) < 0 || base.indexOf("TravelProvince") < 0) {
        problems.push(
          `TravelProvince: synonym points at ${base}, but this app reads ${formDb} (MSSQL_FORM_DATABASE) through getProductionFormPool()`,
        );
      }

      // 3. the direct count (Rocks_Portal_Form) and the count read through
      //    the Fast_Data synonym agree -- taken in ONE query, ONE
      //    round-trip, from the Fast_Data connection referencing
      //    Rocks_Portal_Form three-part (both databases are on the same
      //    instance). NOT two separate .query() calls: after 105 both sides
      //    name the same physical object, so two round-trips can only
      //    disagree if a change lands in the gap between them -- a healthy
      //    system reporting red because of network latency rather than a
      //    real fault. What this actually proves is that the synonym
      //    resolves and answers a query at all.
      const both = await data.request().query(`
        SELECT (SELECT COUNT(*) FROM [dbo].[TravelProvince]) AS [viaSynonym],
               (SELECT COUNT(*) FROM [${formDb}].[dbo].[TravelProvince]) AS [direct];`);
      const bothRow = both.recordset[0];
      if (bothRow.viaSynonym !== bothRow.direct) {
        problems.push(
          `TravelProvince: read through the synonym returned ${bothRow.viaSynonym}, direct count is ${bothRow.direct}`,
        );
      }
    }
  }

  // 4. Rocks_Portal_Form_UAT does NOT have a dbo.TravelProvince object of any
  //    kind. TravelProvince is deliberately a single copy: a synonym points
  //    at exactly one database, so the Rocks Fast / ACC Portal siblings could
  //    never reach a UAT twin even if one existed, and with nothing writing
  //    the table in any application there is nothing for dual-write to carry
  //    and nothing that could drift. Unqualified OBJECT_ID (no type filter)
  //    on purpose -- neither a table nor a synonym nor anything else of that
  //    name may exist here.
  const uatForm = await getUatFormPool();
  const uatCheck = await uatForm.request().query(`SELECT OBJECT_ID('dbo.TravelProvince') AS [oid];`);
  if (uatCheck.recordset[0].oid !== null) {
    problems.push(
      "Rocks_Portal_Form_UAT has a dbo.TravelProvince object -- this table must stay a single copy and never reach the UAT twin",
    );
  }

  // 5. Fast_Data still holds what it is supposed to hold: its Intel_* /
  //    IntelMkt* tables (Rocks Fast's Intelligence feature, which this app
  //    never touches) and the five Erp* synonyms migrations 101/102 left
  //    behind. The move must not have reached anything outside
  //    TravelProvince.
  const intel = await data.request().query(`
    SELECT COUNT(*) AS [intelCount] FROM sys.tables WHERE name LIKE 'Intel[_]%' OR name LIKE 'IntelMkt%';`);
  if (!(intel.recordset[0].intelCount > 0)) {
    problems.push("Fast_Data: no Intel_*/IntelMkt* tables found -- the move may have reached tables it should not have");
  }
  // The IN list is derived from EXPECTED_ERP_SYNONYMS rather than a second
  // hard-coded copy of the same five names -- these are fixed literals with
  // no external input, so string-building the list is as safe as every other
  // interpolated identifier in this file.
  const erpInList = EXPECTED_ERP_SYNONYMS.map((n) => `'${n}'`).join(",");
  const erpSyn = await data.request().query(`
    SELECT name AS [name] FROM sys.synonyms
    WHERE name IN (${erpInList})
    ORDER BY name;`);
  const gotErpNames = erpSyn.recordset.map((x: { name: string }) => x.name).join(",");
  const expectedErpNames = EXPECTED_ERP_SYNONYMS.slice().sort().join(",");
  if (gotErpNames !== expectedErpNames) {
    problems.push(`Fast_Data: Erp* synonyms are [${gotErpNames}], expected [${expectedErpNames}]`);
  }

  if (problems.length) {
    console.error("FAIL");
    for (const p of problems) console.error("  - " + p);
    process.exit(1);
  }
  console.log(`OK: TravelProvince lives in ${formDb} and Fast_Data reaches it by synonym`);
  process.exit(0);
}

main().catch((e) => {
  console.error("verify-travel-province-move failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
