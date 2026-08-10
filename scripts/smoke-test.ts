/* eslint-disable no-console */
/**
 * Smoke-test DB reachability:
 *   1. SELECT 1 against Fast_Core (via the app's MSSQL_* env).
 *   2. For every active brand in BrandConfig with DashboardDbConnectionId set:
 *      - Resolve pool via getBrandDashboardPool.
 *      - SELECT TOP 1 * FROM dbo.vw_Foodstory_Clean (best-effort — view may not exist yet).
 *
 * Always exits 0 — CI without DB access shouldn't fail builds.
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

  // Step 1: Fast_Core reachability
  try {
    const { getCorePool } = await import("../src/lib/db/mssql");
    const pool = await getCorePool();
    await pool.request().query("SELECT 1 AS ok");
    console.log("[ok]   Fast_Core — SELECT 1");
  } catch (err) {
    console.log(
      `[fail] Fast_Core — ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(0);
  }

  // Step 2: each configured brand Dashboard DB
  try {
    const { listConfiguredBrandTargets, getBrandDashboardPool } = await import(
      "../src/lib/intelligence/brand-pool"
    );
    const targets = await listConfiguredBrandTargets();
    if (targets.length === 0) {
      console.log(
        "[warn] No brand targets configured (BrandConfig.DashboardDbConnectionId/Name)",
      );
      process.exit(0);
    }
    for (const t of targets) {
      try {
        const pool = await getBrandDashboardPool(t.brandCode);
        const r = await pool
          .request()
          .query("SELECT TOP 1 * FROM dbo.vw_Foodstory_Clean");
        console.log(
          `[ok]   ${t.brandCode.padEnd(6)} → ${t.databaseName} (${r.recordset.length} row sample)`,
        );
      } catch (err) {
        console.log(
          `[fail] ${t.brandCode.padEnd(6)} → ${t.databaseName} — ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  } catch (err) {
    console.log(
      `[fail] brand enumeration — ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("smoke-test crashed:", err instanceof Error ? err.message : err);
  process.exit(0);
});
