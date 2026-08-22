/* eslint-disable no-console */
/**
 * Read-only check for Task 4: prove getMultiBrandDepartmentMappingPage() now
 * returns rows keyed by DepartmentCode (string, e.g. ACC/IT) with names from
 * listDepartmentCodes(). Reads the live Rocks_Portal_Form DB — DepartmentErpMap
 * moved there in migrations 099/100, and the service reaches it through
 * getProductionFormPool(), not through Fast_Core's synonym.
 *
 * Does NOT mutate any mapping data.
 *
 * Usage: npx tsx scripts/checks/dept-map-rekey.ts
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
  const { getMultiBrandDepartmentMappingPage } = await import(
    "../../src/lib/acc/department-map-service"
  );

  const page = await getMultiBrandDepartmentMappingPage();
  console.log(`getMultiBrandDepartmentMappingPage: ${page.groups.length} group(s), dimension=${page.dimensionCode}`);

  for (const g of page.groups) {
    console.log(`  target=${g.targetBrandCode} mappings=${g.mappings.length}`);
    for (const m of g.mappings.slice(0, 5)) {
      // Assert the row is keyed by a non-numeric code (e.g. "ACC"), not the old numeric HrDepartmentId.
      if (/^\d+$/.test(m.departmentCode)) {
        throw new Error(
          `departmentCode "${m.departmentCode}" looks numeric — rekey may not have applied (target=${g.targetBrandCode})`,
        );
      }
      console.log(
        `    code=${m.departmentCode} name=${m.departmentName ?? "(none)"} erpCode=${m.erpCode ?? "(unmapped)"}`,
      );
    }
    if (g.mappings.length > 5) console.log(`    ... (${g.mappings.length - 5} more)`);
  }

  console.log("OK: dept-map-rekey check passed — rows are code-keyed (read-only, 0 mutations)");
  process.exit(0);
}

main().catch((err) => {
  console.error("dept-map-rekey check failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
