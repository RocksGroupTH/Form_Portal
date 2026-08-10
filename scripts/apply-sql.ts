/* eslint-disable no-console */
/**
 * Apply a .sql file against one named database on the app's MSSQL server.
 *
 * Usage:
 *   npm run apply-sql -- --db Fast_Form --file migrations/013_portal_acc_core.sql
 *
 * Both --db and --file are required. Credentials come from the MSSQL_* keys
 * in .env.local; the file is split on GO and each batch is run in order.
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
  db: string;
}

function parseArgs(): Args {
  let file = "";
  let db = "";
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file" || a === "-f") file = argv[++i] ?? "";
    else if (a === "--db" || a === "-d") db = argv[++i] ?? "";
  }
  if (!file) {
    throw new Error("Missing --file <path>");
  }
  if (!db) {
    throw new Error("--db <database> is required, e.g. --db Fast_Form");
  }
  return { file, db };
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

  // --db uses the MSSQL_* env credentials for the app's own SQL server.
  const { getAppPool } = await import("../src/lib/db/mssql");
  await runOnDb(args.db, () => getAppPool(args.db), filePath, batches);

  console.log("\nDone.");
  process.exit(0);
}

main().catch((err) => {
  console.error("apply-sql failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
