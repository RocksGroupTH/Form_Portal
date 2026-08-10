/* eslint-disable no-console */
/**
 * Read-only check: prove the Task 2 service-layer SQL parses against the
 * live Fast_Core DB — getMultiBrandDepartmentMappingPage() (glOptions wiring)
 * and loadDeptGlOverridesByTarget() (new Fixed G/L override loader).
 *
 * Does NOT mutate any mapping data.
 *
 * Usage: npx tsx scripts/checks/dept-gl-service.ts
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
  const { getMultiBrandDepartmentMappingPage, loadDeptGlOverridesByTarget } = await import(
    "../../src/lib/acc/department-map-service"
  );

  const page = await getMultiBrandDepartmentMappingPage();
  console.log(`getMultiBrandDepartmentMappingPage: ${page.groups.length} group(s)`);
  for (const g of page.groups) {
    console.log(
      `  target=${g.targetBrandCode} glOptions=${g.glOptions.length} mappings=${g.mappings.length}`,
    );
    const withGl = g.mappings.filter((m) => m.fixedGlAccountNo);
    if (withGl.length > 0) {
      console.log(`    fixedGl overrides present: ${withGl.length}`);
    }
  }

  const overrides = await loadDeptGlOverridesByTarget(new Map());
  console.log(`loadDeptGlOverridesByTarget(new Map()): ${overrides.size} target key(s)`);

  console.log("OK: dept-gl-service SQL parsed successfully (read-only, 0 mutations)");
  process.exit(0);
}

main().catch((err) => {
  console.error("dept-gl-service check failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
