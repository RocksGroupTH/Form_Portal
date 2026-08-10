/* eslint-disable no-console */
/**
 * Verify hasIntelAccess() (src/lib/intel-access.ts):
 *   - admin role short-circuits to true without touching the DB
 *   - an email with no IntelBrandPermission grant returns false
 *   - a real granted email (direct or via active group) returns true
 *
 * Read-only — does not mutate any data.
 *
 * Usage: npx tsx scripts/checks/verify-intel-access.ts
 *
 * tsx does not auto-load .env.local or resolve the "@/" alias, so this
 * script loads env vars itself and imports the pool/helper via relative paths.
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
  const { hasIntelAccess } = await import("../../src/lib/intel-access");
  const { getCorePool } = await import("../../src/lib/db/mssql");

  // 0) Empty email — should be false (no grant possible without an email).
  const emptyEmailResult = await hasIntelAccess("", "Staff");
  console.log("empty email ('', 'Staff') ->", emptyEmailResult);
  if (emptyEmailResult !== false) {
    throw new Error("Expected empty email to return false");
  }

  // 1) Admin short-circuit — should be true without needing a real email.
  const adminResult = await hasIntelAccess("x@y", "IT Admin");
  console.log("admin role ('x@y', 'IT Admin') ->", adminResult);
  if (adminResult !== true) {
    throw new Error("Expected admin role to short-circuit to true");
  }

  // 2) Nobody grant — should be false.
  const nobodyResult = await hasIntelAccess("definitely-nobody@nowhere.test", "Staff");
  console.log("no grant ('definitely-nobody@nowhere.test', 'Staff') ->", nobodyResult);
  if (nobodyResult !== false) {
    throw new Error("Expected email with no grant to return false");
  }

  // 3) Try to find a real granted email (direct or via active group) and confirm true.
  const pool = await getCorePool();
  const granted = await pool.request().query(`
    SELECT TOP 1 LOWER(UserEmail) AS email FROM IntelBrandPermission WHERE UserEmail IS NOT NULL
    UNION
    SELECT TOP 1 LOWER(gm.UserEmail) AS email
    FROM IntelBrandPermission bp
    INNER JOIN IntelPermissionGroupMember gm ON bp.GroupId = gm.GroupId
    INNER JOIN IntelPermissionGroup g ON gm.GroupId = g.Id AND g.IsActive = 1
  `);
  const realEmail = (granted.recordset[0] as { email: string } | undefined)?.email;
  if (realEmail) {
    const realResult = await hasIntelAccess(realEmail, "Staff");
    console.log(`real granted email ('${realEmail}', 'Staff') ->`, realResult);
    if (realResult !== true) {
      throw new Error(`Expected granted email ${realEmail} to return true`);
    }
  } else {
    console.log("No real granted email found in IntelBrandPermission — skipping that case.");
  }

  console.log("OK: hasIntelAccess behaves as expected");
  process.exit(0);
}

main().catch((err) => {
  console.error("verify-intel-access failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
