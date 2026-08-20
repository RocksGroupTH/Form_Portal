/* eslint-disable no-console */
/**
 * Seed a Form Portal database with master/config rows copied from Fast_Form.
 *
 * Copies the 19 configuration tables listed in the design spec
 * (docs/superpowers/specs/2026-08-13-portal-form-db-split-design.md). The 23
 * transactional tables are deliberately left empty. AccSequence and
 * AccSetting.ERP_INTERFACE_ENV are set per environment rather than copied,
 * because copying them would restart running numbers already issued and would
 * leave production pointed at the ERP sandbox.
 *
 * AccBookingApprover and AccBookingApproverTab are the two shared master tables
 * this script does not copy — see the notes in MASTER_TABLES below.
 *
 * Requires migrations/059_portal_form_baseline.sql to be applied first — this
 * copies rows, it does not create tables.
 *
 * Usage:
 *   npx tsx scripts/seed-portal-form.ts --db Rocks_Portal_Form     --env prod
 *   npx tsx scripts/seed-portal-form.ts --db Rocks_Portal_Form_UAT --env uat
 *   npx tsx scripts/seed-portal-form.ts --db Rocks_Portal_Form     --env prod --dry-run
 *
 * tsx does not auto-load .env.local or resolve the "@/" alias, so this
 * script loads env vars itself and imports the pool via a relative path.
 */

import fs from "node:fs";
import path from "node:path";
import type { ConnectionPool } from "mssql";

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

const SOURCE_DB = "Fast_Form";

/**
 * The 19 master/config tables, ordered so a parent is always copied before the
 * child that references it (AccFormMaster before AccFormBrand, AccApprover
 * before AccApproverInterfaceBrand, AccTravelVehicleOption before
 * AccTravelVehiclePlace).
 */
const MASTER_TABLES = [
  "AccFormMaster",
  "AccFormBrand",
  "AccApprover",
  "AccApproverInterfaceBrand",
  "AccApproverSettingsTab",
  // AccBookingApprover is deliberately absent. It is the 20th shared master
  // table and npm run check:alignment covers it, but SOURCE_DB (Fast_Form) has
  // no such table: AP-17's roster is Form Portal's own, created by
  // migrations/095_acc_booking_approver.sql. Listing it here would fail the
  // copy on a missing source table. Seed it from Settings after migrating.
  //
  // AccBookingApproverTab is deliberately absent for the same reason. It is
  // the 21st shared master table and npm run check:alignment covers it, but
  // it is created by migrations/096_acc_booking_approver_tab.sql and SOURCE_DB
  // (Fast_Form) has never had it. copyTable() opens with an unguarded
  // SELECT *, so an entry here would abort the seed partway. Its rows key on
  // AccBookingApprover.Id, which is not copied either, so there would be
  // nothing coherent to point them at. Grant tabs from Settings after migrating.
  "AccVehicle",
  "AccTravelReason",
  "AccTravelAccommodation",
  "AccTravelRentVehicle",
  "AccTravelVehicleOption",
  "AccTravelVehiclePlace",
  "AccBrandBankAccount",
  "AccBrandBranchCode",
  "AccBrandGlAccount",
  "AccBrandJournalBatch",
  "AccBrandErpInterface",
  "AccBrandErpTargetSetting",
  "AccSameDayBrandStaff",
  "AccSetting",
];

interface Args {
  db: string;
  env: "prod" | "uat";
  dryRun: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let db = "";
  let envName = "";
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--db") db = argv[++i] ?? "";
    else if (argv[i] === "--env") envName = argv[++i] ?? "";
    else if (argv[i] === "--dry-run") dryRun = true;
  }
  if (!db) throw new Error("--db <database> is required");
  if (envName !== "prod" && envName !== "uat") throw new Error("--env must be prod or uat");
  if (db === SOURCE_DB) throw new Error(`Refusing to seed ${SOURCE_DB} — it belongs to Rocks Fast`);
  return { db, env: envName, dryRun };
}

/** Copy every row of one table, preserving identity values. */
async function copyTable(
  src: ConnectionPool,
  dst: ConnectionPool,
  table: string,
  dryRun: boolean,
): Promise<void> {
  const rows = (await src.request().query(`SELECT * FROM [dbo].[${table}]`)).recordset;
  const existing = (await dst.request().query(`SELECT COUNT(*) AS N FROM [dbo].[${table}]`))
    .recordset[0].N as number;

  if (existing > 0) {
    console.log(`  ${table}: skipped — target already has ${existing} row(s)`);
    return;
  }
  if (rows.length === 0) {
    console.log(`  ${table}: nothing to copy (source empty)`);
    return;
  }
  if (dryRun) {
    console.log(`  ${table}: would copy ${rows.length} row(s)`);
    return;
  }

  const cols = Object.keys(rows[0]);
  const identityCount = (
    await dst
      .request()
      .input("t", table)
      .query(`SELECT COUNT(*) AS N FROM sys.identity_columns WHERE object_id = OBJECT_ID(@t)`)
  ).recordset[0].N as number;
  const hasIdentity = identityCount > 0;

  const colList = cols.map((c) => `[${c}]`).join(", ");
  if (hasIdentity) await dst.request().batch(`SET IDENTITY_INSERT [dbo].[${table}] ON`);
  try {
    for (const row of rows) {
      const req = dst.request();
      cols.forEach((c, i) => req.input(`p${i}`, (row as Record<string, unknown>)[c]));
      const params = cols.map((_, i) => `@p${i}`).join(", ");
      await req.query(`INSERT INTO [dbo].[${table}] (${colList}) VALUES (${params})`);
    }
  } finally {
    if (hasIdentity) await dst.request().batch(`SET IDENTITY_INSERT [dbo].[${table}] OFF`);
  }
  console.log(`  ${table}: copied ${rows.length} row(s)`);
}

async function main() {
  loadDotEnvLocal();
  const args = parseArgs();
  const { getAppPool, sql } = await import("../src/lib/db/mssql");
  const src = await getAppPool(SOURCE_DB);
  const dst = await getAppPool(args.db);

  console.log(`Seeding ${args.db} (${args.env})${args.dryRun ? " — DRY RUN" : ""}`);

  console.log("\nMaster/config tables:");
  for (const t of MASTER_TABLES) await copyTable(src, dst, t, args.dryRun);

  /* ── Environment-specific values ── */
  const erpEnv = args.env === "prod" ? "Production" : "Sandbox";
  console.log(`\nERP_INTERFACE_ENV -> ${erpEnv}`);
  if (!args.dryRun) {
    await dst
      .request()
      .input("v", sql.NVarChar, erpEnv)
      .query(`
        UPDATE AccSetting SET SettingValue = @v, UpdatedAt = GETDATE()
        WHERE SettingKey = 'ERP_INTERFACE_ENV';
        IF @@ROWCOUNT = 0
          INSERT INTO AccSetting (SettingKey, SettingValue, UpdatedAt)
          VALUES ('ERP_INTERFACE_ENV', @v, GETDATE());
      `);
  }

  // PROD continues the numbers already issued from the old system; UAT starts
  // at 9000 so a UAT number is never mistaken for a production one.
  const seqs =
    args.env === "prod"
      ? [
          { prefix: "TOF", year: 2026, last: 46 },
          { prefix: "TRL", year: 2026, last: 9 },
        ]
      : [
          { prefix: "TOF", year: 2026, last: 9000 },
          { prefix: "TRL", year: 2026, last: 9000 },
        ];

  console.log("\nAccSequence:");
  for (const s of seqs) {
    console.log(`  ${s.prefix}/${s.year} -> LastSeq ${s.last}`);
    if (args.dryRun) continue;
    await dst
      .request()
      .input("p", sql.NVarChar, s.prefix)
      .input("y", sql.Int, s.year)
      .input("n", sql.Int, s.last)
      .query(`
        UPDATE AccSequence SET LastSeq = @n, UpdatedAt = GETDATE()
        WHERE Prefix = @p AND Year = @y;
        IF @@ROWCOUNT = 0
          INSERT INTO AccSequence (Prefix, Year, LastSeq, UpdatedAt)
          VALUES (@p, @y, @n, GETDATE());
      `);
  }

  console.log("\nDone.");
  process.exit(0);
}

main().catch((e) => {
  console.error("seed-portal-form failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
