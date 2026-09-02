/* eslint-disable no-console */
/**
 * Read-only verification for Task 3 (AP-17 types + province/settings/allowance-log services):
 *   - listProvinces() -> 77 active rows
 *   - listReasons/listAccommodations/listVehicles/listRentVehicles() -> seeded rows
 *   - getAllowanceLog(employeeId) -> rows for a real EmployeeId found in EmployeeAllowanceLog
 *
 * Does not mutate any data.
 *
 * Usage: npx tsx scripts/checks/verify-travel-booking-lookups.ts
 *
 * tsx does not auto-load .env.local; this script loads env vars itself. It uses
 * relative imports (not "@/") to avoid depending on tsx's tsconfig-paths resolution.
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

  const {
    listReasons, listAccommodations, listVehicles, listRentVehicles,
  } = await import("../../src/lib/acc/travel-booking/settings-service");
  const { getAllowanceLog } = await import("../../src/lib/acc/travel-booking/allowance-log");
  const { getHrPool } = await import("../../src/lib/hr/pool");

  // No province check any more: AP-17 dropped its จังหวัด field on 2026-09-01
  // and the editor and its service were deleted on 2026-09-02. TravelProvince
  // itself still exists and still has 77 Thai rows — ACC Portal reads them —
  // but nothing in THIS app reads the table, so there is nothing here to check.

  // --- settings-service ----------------------------------------------------
  const reasons = await listReasons();
  const accommodations = await listAccommodations();
  const vehicles = await listVehicles();
  const rentVehicles = await listRentVehicles();
  console.log(`listReasons() -> ${reasons.length} rows`, reasons);
  console.log(`listAccommodations() -> ${accommodations.length} rows`, accommodations);
  console.log(`listVehicles() -> ${vehicles.length} rows`, vehicles);
  console.log(`listRentVehicles() -> ${rentVehicles.length} rows`, rentVehicles);
  if (reasons.length < 3 || accommodations.length < 3 || vehicles.length < 4 || rentVehicles.length < 4) {
    throw new Error("One or more settings tables returned fewer rows than the migration-048 seed");
  }
  console.log("OK: all 4 settings lookups return seeded rows");

  // --- allowance-log ---------------------------------------------------
  const hrPool = await getHrPool();
  const sampleRow = await hrPool.request().query(`
    SELECT TOP 1 EmployeeId FROM [dbo].[EmployeeAllowanceLog] ORDER BY EmployeeId
  `);
  const employeeId = sampleRow.recordset[0]?.EmployeeId as string | undefined;
  if (!employeeId) {
    console.warn("WARN: EmployeeAllowanceLog is empty — cannot exercise getAllowanceLog() against a real row");
  } else {
    console.log(`Using EmployeeId=${employeeId} from EmployeeAllowanceLog`);
    const log = await getAllowanceLog(employeeId);
    console.log(`getAllowanceLog("${employeeId}") -> ${log.length} rows`);
    console.log("  entries:", log);
    if (log.length === 0) {
      throw new Error("getAllowanceLog() returned no rows for an EmployeeId known to exist in EmployeeAllowanceLog");
    }
    for (const entry of log) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.effectiveDate)) {
        throw new Error(`effectiveDate not in YYYY-MM-DD form: ${entry.effectiveDate}`);
      }
      if (typeof entry.amount !== "number" || Number.isNaN(entry.amount)) {
        throw new Error(`amount not a number: ${entry.amount}`);
      }
    }
    console.log("OK: getAllowanceLog() returns well-formed rows");
  }

  console.log("\nverify-travel-booking-lookups PASSED");
  process.exit(0);
}

main().catch((err) => {
  console.error("verify-travel-booking-lookups failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
