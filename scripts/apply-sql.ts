/* eslint-disable no-console */
/**
 * Apply a .sql file against one or all configured brand Dashboard DBs.
 *
 * Usage:
 *   npm run apply-sql -- --file sql/foodstory-views.sql
 *   npm run apply-sql -- --file sql/foodstory-views.sql --db Rocks_UNO_Data
 *
 * Default mode enumerates BrandConfig.DashboardDatabaseName for every
 * active brand whose DashboardDbConnectionId is set, then runs the file
 * against each target.
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

interface Args {
  file: string;
  db: string | null;
  brand: string | null;
}

function parseArgs(): Args {
  const out: Args = { file: "", db: null, brand: null };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file" || a === "-f") out.file = argv[++i] ?? "";
    else if (a === "--db" || a === "-d") out.db = argv[++i] ?? null;
    else if (a === "--brand" || a === "-b") out.brand = argv[++i] ?? null;
  }
  if (!out.file) {
    throw new Error("Missing --file <path>");
  }
  return out;
}

function splitBatches(text: string): string[] {
  // mssql driver doesn't understand GO — split here.
  return text
    .split(/^\s*GO\s*;?\s*$/gim)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

type PoolGetter = () => Promise<import("mssql").ConnectionPool>;

async function runOnDb(
  label: string,
  getPool: PoolGetter,
  filePath: string,
  batches: string[],
): Promise<void> {
  console.log(`\n=== ${label} ===`);
  const pool = await getPool();
  for (let i = 0; i < batches.length; i++) {
    console.log(`  batch ${i + 1}/${batches.length} (${batches[i].length} chars)`);
    await pool.request().batch(batches[i]);
  }
  // Verify: count views matching the names defined in the file (best effort)
  const check = await pool.request().query(`
    SELECT name FROM sys.views WHERE schema_id = SCHEMA_ID('dbo')
      AND name LIKE 'vw_Foodstory_%'
  `);
  console.log(
    `  verified: ${check.recordset.length} matching view(s) — ${check.recordset
      .map((r: { name: string }) => r.name)
      .join(", ") || "none"}`,
  );
  console.log(`  applied ${path.basename(filePath)} to ${label} OK`);
}

async function main() {
  loadDotEnvLocal();
  const args = parseArgs();
  const filePath = path.resolve(process.cwd(), args.file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`SQL file not found: ${filePath}`);
  }
  const text = fs.readFileSync(filePath, "utf8");
  const batches = splitBatches(text);
  if (batches.length === 0) {
    throw new Error(`No SQL batches found in ${args.file}`);
  }
  console.log(`Loaded ${batches.length} batch(es) from ${args.file}`);

  if (args.brand) {
    // --brand resolves through getBrandDashboardPool — handles external SQL servers
    // whose credentials are stored encrypted in DbConnection (not in env).
    const { getBrandDashboardPool } = await import("../src/lib/intelligence/brand-pool");
    await runOnDb(
      `brand ${args.brand}`,
      () => getBrandDashboardPool(args.brand!),
      filePath,
      batches,
    );
  } else if (args.db) {
    // --db uses MSSQL_* env credentials (saai's home server only).
    const { getAppPool } = await import("../src/lib/db/mssql");
    await runOnDb(args.db, () => getAppPool(args.db!), filePath, batches);
  } else {
    // Default: enumerate every brand whose Dashboard DB is configured.
    // Uses getBrandDashboardPool per target so external-server brands work.
    const { listConfiguredBrandTargets, getBrandDashboardPool } = await import(
      "../src/lib/intelligence/brand-pool"
    );
    const targets = await listConfiguredBrandTargets();
    if (targets.length === 0) {
      throw new Error(
        "No brand targets found in BrandConfig. Configure DashboardDbConnectionId + DashboardDatabaseName, or pass --db <name>.",
      );
    }
    console.log(
      `Found ${targets.length} target(s): ${targets
        .map((t) => `${t.brandCode}→${t.databaseName}`)
        .join(", ")}`,
    );
    for (const t of targets) {
      await runOnDb(
        `${t.brandCode} → ${t.databaseName}`,
        () => getBrandDashboardPool(t.brandCode),
        filePath,
        batches,
      );
    }
  }

  console.log("\nDone.");
  process.exit(0);
}

main().catch((err) => {
  console.error("apply-sql failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
