/* eslint-disable no-console */
/**
 * Verify migrations 048/049:
 *   - Fast_Form: 8 AccTravelBooking* tables exist, AccFormMaster has the AP-17 seed row,
 *     and each of the 4 settings tables has its default seed rows.
 *   - Fast_Data: TravelProvince has exactly 77 rows.
 *
 * Usage: npx tsx scripts/checks/verify-048.ts
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

const FAST_FORM_TABLES = [
  "AccTravelBooking",
  "AccTravelWorkLocation",
  "AccTravelDepartureLocation",
  "AccTravelBookingDetail",
  "AccTravelReason",
  "AccTravelAccommodation",
  "AccTravelVehicleOption",
  "AccTravelRentVehicle",
];

async function main() {
  loadDotEnvLocal();
  const { getAppPool } = await import("../../src/lib/db/mssql");

  // --- Fast_Form: 8 tables exist ---------------------------------------
  const formPool = await getAppPool("Fast_Form");
  const tablesResult = await formPool.request().query(`
    SELECT name FROM sys.tables WHERE name IN (
      'AccTravelBooking','AccTravelWorkLocation','AccTravelDepartureLocation',
      'AccTravelBookingDetail','AccTravelReason','AccTravelAccommodation',
      'AccTravelVehicleOption','AccTravelRentVehicle'
    )
  `);
  const foundTables = new Set(
    (tablesResult.recordset as { name: string }[]).map((r) => r.name),
  );
  console.log(`Fast_Form tables found: ${foundTables.size}/${FAST_FORM_TABLES.length}`);
  for (const t of FAST_FORM_TABLES) {
    if (!foundTables.has(t)) {
      throw new Error(`Missing Fast_Form table: ${t}`);
    }
  }
  console.log("OK: all 8 AccTravelBooking* tables exist");

  // --- Fast_Form: AccFormMaster AP-17 seed ------------------------------
  const formMasterResult = await formPool.request().query(`
    SELECT FormCode, RunningPrefix, SortOrder FROM [dbo].[AccFormMaster] WHERE FormCode = 'AP-17'
  `);
  if (formMasterResult.recordset.length !== 1) {
    throw new Error("AccFormMaster is missing the AP-17 seed row");
  }
  const formMasterRow = formMasterResult.recordset[0] as {
    FormCode: string;
    RunningPrefix: string;
    SortOrder: number;
  };
  if (formMasterRow.RunningPrefix !== "TRL") {
    throw new Error(
      `AccFormMaster AP-17 RunningPrefix expected 'TRL', got '${formMasterRow.RunningPrefix}'`,
    );
  }
  console.log("OK: AccFormMaster AP-17 seed row exists", formMasterRow);

  // --- Fast_Form: settings tables have default rows ---------------------
  const settingsExpected: Record<string, number> = {
    AccTravelReason: 3,
    AccTravelAccommodation: 3,
    AccTravelVehicleOption: 4,
    AccTravelRentVehicle: 4,
  };
  for (const [table, expectedCount] of Object.entries(settingsExpected)) {
    const result = await formPool.request().query(`SELECT COUNT(*) AS cnt FROM [dbo].[${table}]`);
    const cnt = (result.recordset[0] as { cnt: number }).cnt;
    console.log(`  ${table}: ${cnt} row(s)`);
    if (cnt < expectedCount) {
      throw new Error(`${table} has ${cnt} row(s), expected at least ${expectedCount}`);
    }
  }
  console.log("OK: all 4 settings tables have default rows");

  // --- Fast_Data: TravelProvince has 77 rows -----------------------------
  const dataPool = await getAppPool("Fast_Data");
  const provinceResult = await dataPool.request().query(`
    SELECT COUNT(*) AS cnt FROM [dbo].[TravelProvince]
  `);
  const provinceCount = (provinceResult.recordset[0] as { cnt: number }).cnt;
  console.log(`Fast_Data.TravelProvince count: ${provinceCount}`);
  if (provinceCount !== 77) {
    throw new Error(`Fast_Data.TravelProvince expected 77 rows, got ${provinceCount}`);
  }
  console.log("OK: Fast_Data.TravelProvince has exactly 77 rows");

  console.log("\nverify-048 PASSED");
  process.exit(0);
}

main().catch((err) => {
  console.error("verify-048 failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
