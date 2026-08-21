/* eslint-disable no-console */
/**
 * Verify the ERP sync data move
 * (docs/superpowers/specs/2026-08-21-erp-sync-data-move-design.md, section 7):
 *
 *   - each of the five tables (ErpAccounts, ErpDimensionValue,
 *     ErpGeneralJournalBatch, ErpBankAccountCard, ErpSyncLog) is a table in
 *     Rocks_ERP_Data, holds the expected row count, has its identity reseeded
 *     to the expected value, and carries the expected index names
 *   - Fast_Data holds a synonym of the same name for each, pointing at the
 *     Rocks_ERP_Data copy
 *   - a read through the synonym sees the same rows
 *   - a write through the synonym succeeds, in the siblings' own MERGE shape
 *     (rolled back, so no data moves)
 *   - Fast_Data.dbo.TravelProvince -- a table the move must not touch -- is
 *     still a table
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

const EXPECTED = [
  { table: "ErpAccounts", rows: 4793, ident: 4793,
    indexes: ["IX_ErpAccounts_BrandCategory", "PK_ErpAccounts", "UQ_ErpAccounts"] },
  { table: "ErpDimensionValue", rows: 806, ident: 806,
    indexes: ["IX_ErpDimensionValue_BrandDim", "PK_ErpDimensionValue", "UQ_ErpDimensionValue"] },
  { table: "ErpGeneralJournalBatch", rows: 174, ident: 174,
    indexes: ["IX_ErpGeneralJournalBatch_Brand", "PK_ErpGeneralJournalBatch", "UQ_ErpGeneralJournalBatch"] },
  { table: "ErpBankAccountCard", rows: 64, ident: 64,
    indexes: ["IX_ErpBankAccountCard_Brand", "PK_ErpBankAccountCard", "UQ_ErpBankAccountCard"] },
  { table: "ErpSyncLog", rows: 21, ident: 21,
    indexes: ["IX_ErpSyncLog_BrandStarted", "PK_ErpSyncLog"] },
];

async function main() {
  loadDotEnvLocal();
  const { getDataPool, getAppPool } = await import("../../src/lib/db/mssql");
  const data = await getDataPool();
  const erp = await getAppPool("Rocks_ERP_Data");
  const problems: string[] = [];

  for (const e of EXPECTED) {
    // 1. the table, its rows, its identity
    const r = await erp.request().query(`
      SELECT OBJECT_ID('dbo.${e.table}', 'U') AS [tableId],
             (SELECT COUNT(*) FROM [dbo].[${e.table}]) AS [rowCnt],
             IDENT_CURRENT('dbo.${e.table}') AS [identCur];`);
    const row = r.recordset[0];
    if (row.tableId === null) problems.push(`${e.table}: not a table in Rocks_ERP_Data`);
    if (row.rowCnt !== e.rows) problems.push(`${e.table}: ${row.rowCnt} rows, expected ${e.rows}`);
    if (Number(row.identCur) !== e.ident) problems.push(`${e.table}: IDENT_CURRENT ${row.identCur}, expected ${e.ident}`);

    // the indexes, by name
    const idx = await erp.request().query(`
      SELECT name FROM sys.indexes
      WHERE object_id = OBJECT_ID('dbo.${e.table}') AND type > 0 ORDER BY name;`);
    const got = idx.recordset.map((x: { name: string }) => x.name).join(",");
    if (got !== e.indexes.join(",")) problems.push(`${e.table}: indexes are ${got}, expected ${e.indexes.join(",")}`);

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

    // 3. a read through the synonym sees the same rows
    const thru = await data.request().query(`SELECT COUNT(*) AS [n] FROM [dbo].[${e.table}];`);
    if (thru.recordset[0].n !== e.rows) {
      problems.push(`${e.table}: read through the synonym returned ${thru.recordset[0].n}, expected ${e.rows}`);
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
