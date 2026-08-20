/* eslint-disable no-console */
/**
 * Verify migrations 046/047:
 *   - Fast_Core.dbo.DepartmentErpMap.HrDepartmentId was renamed to DepartmentCode
 *   - Fast_Form.dbo.AccRequest.RequesterDepartmentCode exists
 *
 * Usage: npx tsx scripts/checks/verify-046.ts
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

async function main() {
  loadDotEnvLocal();
  const { getAppPool } = await import("../../src/lib/db/mssql");

  // DepartmentErpMap moved to the form database (migrations 099/100). Fast_Core
  // now holds a synonym, and COL_LENGTH does not resolve synonyms — pointed at
  // Fast_Core this check would fail on a table that is perfectly healthy.
  const deptMapPool = await getAppPool("Rocks_Portal_Form");
  const coreResult = await deptMapPool.request().query(`
    SELECT COL_LENGTH('dbo.DepartmentErpMap','DepartmentCode') AS departmentCode,
           COL_LENGTH('dbo.DepartmentErpMap','HrDepartmentId') AS hrDepartmentId
  `);
  const coreRow = coreResult.recordset[0] as {
    departmentCode: number | null;
    hrDepartmentId: number | null;
  };
  console.log("verify-046 Fast_Core result:", coreRow);

  if (coreRow.departmentCode == null) {
    throw new Error("DepartmentErpMap.DepartmentCode does not exist");
  }
  if (coreRow.hrDepartmentId != null) {
    throw new Error("DepartmentErpMap.HrDepartmentId still exists (rename did not happen)");
  }

  const formPool = await getAppPool("Fast_Form");
  const formResult = await formPool.request().query(`
    SELECT COL_LENGTH('dbo.AccRequest','RequesterDepartmentCode') AS requesterDepartmentCode
  `);
  const formRow = formResult.recordset[0] as { requesterDepartmentCode: number | null };
  console.log("verify-046 Fast_Form result:", formRow);

  if (formRow.requesterDepartmentCode == null) {
    throw new Error("AccRequest.RequesterDepartmentCode does not exist");
  }

  console.log(
    "OK: DepartmentErpMap.DepartmentCode (renamed, HrDepartmentId gone) and AccRequest.RequesterDepartmentCode exist",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("verify-046 failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
