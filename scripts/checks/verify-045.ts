/* eslint-disable no-console */
/**
 * Verify migration 045: DepartmentErpMap.FixedGlAccountNo / FixedGlDescription exist.
 *
 * Usage: npx tsx scripts/checks/verify-045.ts
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

  const pool = await getAppPool("Fast_Core");
  const result = await pool.request().query(`
    SELECT COL_LENGTH('dbo.DepartmentErpMap','FixedGlAccountNo') AS a,
           COL_LENGTH('dbo.DepartmentErpMap','FixedGlDescription') AS b
  `);
  const row = result.recordset[0] as { a: number | null; b: number | null };
  console.log("verify-045 result:", row);

  if (row.a == null) {
    throw new Error("DepartmentErpMap.FixedGlAccountNo does not exist");
  }
  if (row.b == null) {
    throw new Error("DepartmentErpMap.FixedGlDescription does not exist");
  }

  console.log("OK: both FixedGlAccountNo and FixedGlDescription columns exist on DepartmentErpMap");
  process.exit(0);
}

main().catch((err) => {
  console.error("verify-045 failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
