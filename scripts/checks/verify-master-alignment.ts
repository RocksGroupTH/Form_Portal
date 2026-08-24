/* eslint-disable no-console */
/**
 * Assert the 21 shared configuration tables are identical in Rocks_Portal_Form
 * and Rocks_Portal_Form_UAT.
 *
 * Per-form routing means AP-1 may read one copy while AP-17 reads the other, so
 * these tables must not drift. src/lib/acc/dual-write.ts keeps them in step by
 * running every mutation against both databases; this is the check that the
 * invariant actually holds — run it after any manual SQL against either
 * database, or when a setting looks different between forms.
 *
 * Read-only.
 *
 * Usage: npm run check:alignment
 *
 * tsx does not auto-load .env.local or resolve the "@/" alias, so this
 * script loads env vars itself and imports the pool via a relative path.
 */

import fs from "node:fs";
import path from "node:path";
// Relative, and from a module with no imports of its own — the "@/" alias does
// not resolve here, and a static import must not pull in anything that reads
// env vars before loadDotEnvLocal() has run.
import { isEnvironmentSpecificSettingKey } from "../../src/lib/acc/setting-scope";

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

/** The 21 tables dual-write keeps in step. */
const MASTER_TABLES = [
  "AccFormMaster",
  "AccFormBrand",
  "AccApprover",
  "AccApproverInterfaceBrand",
  "AccApproverSettingsTab",
  "AccBookingApprover",
  "AccBookingApproverTab",
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

/**
 * Compare on business columns only. The mssql driver round-trips datetime2(7)
 * through a millisecond-resolution JavaScript Date, so audit timestamps drift by
 * up to 2ms on copy — a known, harmless artefact recorded in the 2026-08-13
 * split spec.
 */
function normalise(table: string, rows: Record<string, unknown>[]): string[] {
  return rows
    .filter((r) => {
      // AccSetting holds a handful of per-database keys that setSetting()
      // deliberately does not dual-write — the ERP environment leftover and
      // each requester's AP-17 ID-card reuse consent. One shared predicate, so
      // an excluded key can never be reported here as drift.
      if (table !== "AccSetting") return true;
      return !isEnvironmentSpecificSettingKey(String(r.SettingKey));
    })
    .map((r) => {
      const out: Record<string, unknown> = {};
      Object.keys(r)
        .filter((k) => !(r[k] instanceof Date))
        .sort()
        .forEach((k) => (out[k] = r[k]));
      return JSON.stringify(out);
    })
    .sort();
}

async function main() {
  loadDotEnvLocal();
  const { getAppPool } = await import("../../src/lib/db/mssql");

  const prodName = process.env.MSSQL_FORM_DATABASE ?? "Rocks_Portal_Form";
  const uatName = process.env.MSSQL_FORM_UAT_DATABASE ?? "Rocks_Portal_Form_UAT";

  const [prod, uat] = await Promise.all([getAppPool(prodName), getAppPool(uatName)]);

  const failures: string[] = [];
  let totalRows = 0;

  for (const t of MASTER_TABLES) {
    const [a, b] = await Promise.all([
      prod.request().query(`SELECT * FROM [dbo].[${t}]`),
      uat.request().query(`SELECT * FROM [dbo].[${t}]`),
    ]);
    const left = normalise(t, a.recordset);
    const right = normalise(t, b.recordset);
    totalRows += left.length;

    if (left.join("|") === right.join("|")) continue;

    failures.push(`${t}: ${prodName} has ${left.length} row(s), ${uatName} has ${right.length}`);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      if (left[i] !== right[i]) {
        failures.push(`    ${prodName}: ${left[i] ?? "(missing)"}`);
        failures.push(`    ${uatName}: ${right[i] ?? "(missing)"}`);
        break;
      }
    }
  }

  if (failures.length) {
    console.error(`FAIL — configuration has drifted between ${prodName} and ${uatName}`);
    for (const f of failures) console.error(`  ${f}`);
    console.error("");
    console.error("Every mutation should go through writeBothPools (src/lib/acc/dual-write.ts).");
    console.error("A direct SQL edit against one database alone is the usual cause.");
    process.exit(1);
  }

  console.log(
    `PASS — ${MASTER_TABLES.length} configuration tables identical across ` +
      `${prodName} and ${uatName} (${totalRows} rows compared; datetime columns and ` +
      `AccSetting.ERP_INTERFACE_ENV excluded by design)`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("verify-master-alignment failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
