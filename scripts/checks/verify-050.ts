/* eslint-disable no-console */
/**
 * Verify migration 050:
 *   - Fast_Form.dbo.AccRequest's CK_AccRequest_Status check constraint allows 'Completed'
 *     (AP-17's terminal status) in addition to the original migration-013 value list.
 *
 * Usage: npx tsx scripts/checks/verify-050.ts
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
    // Without this, values like `MSSQL_PASSWORD="…"` get the literal quotes
    // included as part of the password — auth then silently fails.
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

const EXPECTED_VALUES = [
  "Draft", "Submitted", "ManagerApproved", "Approved", "Rejected", "Returned", "Cancelled", "Completed",
];

async function main() {
  loadDotEnvLocal();
  const { getAppPool } = await import("../../src/lib/db/mssql");

  const formPool = await getAppPool("Fast_Form");
  const result = await formPool.request().query(`
    SELECT cc.definition
    FROM sys.check_constraints cc
    WHERE cc.name = 'CK_AccRequest_Status'
      AND cc.parent_object_id = OBJECT_ID('dbo.AccRequest')
  `);
  if (result.recordset.length !== 1) {
    throw new Error("CK_AccRequest_Status constraint not found on dbo.AccRequest");
  }
  const definition = (result.recordset[0] as { definition: string }).definition;
  console.log("CK_AccRequest_Status definition:", definition);

  if (!definition.includes("Completed")) {
    throw new Error("CK_AccRequest_Status does not allow 'Completed'");
  }
  for (const v of EXPECTED_VALUES) {
    if (!definition.includes(v)) {
      throw new Error(`CK_AccRequest_Status is missing original value '${v}' — recreate may have dropped it`);
    }
  }
  console.log(`OK: CK_AccRequest_Status allows all ${EXPECTED_VALUES.length} values, including 'Completed'`);

  // The constraint must actually reject an out-of-list value — proves it's a live,
  // enforced CHECK and not just a definition string that happens to contain the words.
  const tx = formPool.transaction();
  await tx.begin();
  try {
    let rejected = false;
    try {
      await tx.request().query(`
        INSERT INTO [dbo].[AccRequest] (FormCode, Status) VALUES ('AP-17', 'NotARealStatus')
      `);
    } catch (e) {
      rejected = true;
      const msg = e instanceof Error ? e.message : String(e);
      if (!/CK_AccRequest_Status/i.test(msg)) {
        throw new Error(`INSERT was rejected but not by CK_AccRequest_Status: ${msg}`);
      }
    }
    if (!rejected) throw new Error("CHECK constraint did not reject an invalid Status value");
    console.log("OK: CHECK constraint actively rejects an invalid Status value");
  } finally {
    await tx.rollback().catch(() => {});
  }

  console.log("\nverify-050 PASSED");
  process.exit(0);
}

main().catch((err) => {
  console.error("verify-050 failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
