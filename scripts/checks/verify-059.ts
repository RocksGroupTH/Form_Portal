/* eslint-disable no-console */
/**
 * Verify a Form Portal database matches the split design
 * (docs/superpowers/specs/2026-08-13-portal-form-db-split-design.md):
 *
 *   - 43 tables, 26 foreign keys
 *   - the master/config tables hold rows
 *   - the 23 transactional tables are empty
 *   - AccSetting.ERP_INTERFACE_ENV matches the environment
 *   - AccSequence continues from the right number
 *
 * Read-only: safe to point at any database, including Fast_Form.
 *
 * Usage:
 *   npx tsx scripts/checks/verify-059.ts --db Rocks_Portal_Form     --env prod
 *   npx tsx scripts/checks/verify-059.ts --db Rocks_Portal_Form_UAT --env uat
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

/**
 * Config tables that must hold rows. The three seeded tables with no rows in
 * the source (AccApproverInterfaceBrand, AccApproverSettingsTab,
 * AccSameDayBrandStaff) are deliberately absent — requiring rows there would
 * fail a correctly seeded database.
 */
const MUST_HAVE_ROWS = [
  "AccFormMaster",
  "AccFormBrand",
  "AccApprover",
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
  "AccSetting",
];

/** Transactional tables: reachable from AccRequest by FK, plus the queue and Form Builder. */
const MUST_BE_EMPTY = [
  "AccRequest",
  "AccApproval",
  "AccActivityLog",
  "AccRequestFile",
  "AccPerDiem",
  "AccPerDiemDay",
  "AccTravelExpense",
  "AccTravelExpenseItem",
  "AccTravelVehicleSection",
  "AccTravelBooking",
  "AccTravelBookingDetail",
  "AccTravelDepartureLocation",
  "AccTravelWorkLocation",
  "AccEmailQueue",
  "OfficeForms",
  "OfficeFormVersions",
  "OfficeFormSubmissions",
  "OfficeFormApprovals",
  "OfficeFormWorkflows",
  "OfficeFormWorkflowSteps",
  "OfficeFormFiles",
  "OfficeFormEmailQueue",
  "OfficeFormActivityLog",
];

async function main() {
  loadDotEnvLocal();

  const argv = process.argv.slice(2);
  let db = "";
  let envName = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--db") db = argv[++i] ?? "";
    else if (argv[i] === "--env") envName = argv[++i] ?? "";
  }
  if (!db || (envName !== "prod" && envName !== "uat")) {
    throw new Error("Usage: --db <database> --env <prod|uat>");
  }

  const { getAppPool } = await import("../../src/lib/db/mssql");
  const pool = await getAppPool(db);
  const failures: string[] = [];

  const tableCount = (await pool.request().query("SELECT COUNT(*) AS N FROM sys.tables"))
    .recordset[0].N as number;
  if (tableCount !== 43) failures.push(`expected 43 tables, found ${tableCount}`);

  const fkCount = (await pool.request().query("SELECT COUNT(*) AS N FROM sys.foreign_keys"))
    .recordset[0].N as number;
  if (fkCount !== 26) failures.push(`expected 26 foreign keys, found ${fkCount}`);

  for (const t of MUST_HAVE_ROWS) {
    const n = (await pool.request().query(`SELECT COUNT(*) AS N FROM [dbo].[${t}]`)).recordset[0]
      .N as number;
    if (n === 0) failures.push(`${t} is empty but should hold config rows`);
  }

  for (const t of MUST_BE_EMPTY) {
    const n = (await pool.request().query(`SELECT COUNT(*) AS N FROM [dbo].[${t}]`)).recordset[0]
      .N as number;
    if (n !== 0) failures.push(`${t} should be empty, found ${n} row(s)`);
  }

  const expectedErp = envName === "prod" ? "Production" : "Sandbox";
  const erp = (
    await pool
      .request()
      .query("SELECT SettingValue AS V FROM AccSetting WHERE SettingKey = 'ERP_INTERFACE_ENV'")
  ).recordset[0]?.V as string | undefined;
  if (erp !== expectedErp) {
    failures.push(`ERP_INTERFACE_ENV is ${erp ?? "missing"}, expected ${expectedErp}`);
  }

  const expectedSeq: Record<string, number> =
    envName === "prod" ? { TOF: 46, TRL: 9 } : { TOF: 9000, TRL: 9000 };
  const seqs = (await pool.request().query("SELECT Prefix, Year, LastSeq FROM AccSequence"))
    .recordset;
  for (const prefix of ["TOF", "TRL"]) {
    const row = seqs.find((r) => r.Prefix === prefix && r.Year === 2026);
    if (!row) failures.push(`AccSequence has no ${prefix}/2026 row`);
    else if (row.LastSeq !== expectedSeq[prefix]) {
      failures.push(`AccSequence ${prefix}/2026 is ${row.LastSeq}, expected ${expectedSeq[prefix]}`);
    }
  }

  if (failures.length) {
    console.error(`FAIL — ${db} (${envName})`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(
    `PASS — ${db} (${envName}): 43 tables, 26 FKs, config seeded, transactional tables empty`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("verify-059 failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
