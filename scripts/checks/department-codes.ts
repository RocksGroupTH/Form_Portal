/* eslint-disable no-console */
/**
 * Read-only check: prove listDepartmentCodes() works against the live
 * Rocks_Portal_HR + Rocks_Codex cross-DB join — lists distinct active-employee
 * DepartmentCodes with names resolved from Rocks_Codex.dbo.Department where
 * present (IT/FN/OP/BD/HR/MKT expected named; ACC/SC/BOD/etc. expected
 * code-only, name = null).
 *
 * Does NOT mutate any data.
 *
 * Usage: npx tsx scripts/checks/department-codes.ts
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
  const { listDepartmentCodes } = await import("../../src/lib/hr/department-lookup");

  const rows = await listDepartmentCodes();
  console.log(`listDepartmentCodes: ${rows.length} row(s)`);
  for (const r of rows) {
    console.log(`  ${r.code}\t${r.name ?? "(no name)"}`);
  }

  const named = rows.filter((r) => r.name !== null);
  const codeOnly = rows.filter((r) => r.name === null);
  console.log(`Named: ${named.length}, code-only: ${codeOnly.length}`);

  console.log("OK: listDepartmentCodes SQL parsed successfully (read-only, 0 mutations)");
  process.exit(0);
}

main().catch((err) => {
  console.error("department-codes check failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
