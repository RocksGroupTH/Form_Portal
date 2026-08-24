/* eslint-disable no-console */
/**
 * Read-only check: prove Task 3's wiring — loadErpJournalBuildContext()
 * now loads and exposes deptGlOverridesByTarget (per-department Fixed G/L
 * override map, keyed by target/interface brand -> hrDeptId).
 *
 * Does NOT mutate any data.
 *
 * Usage: npx tsx scripts/checks/journal-context-dept-gl.ts
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
  const { loadErpJournalBuildContext } = await import(
    "../../src/lib/acc/erp-journal-context"
  );

  // The context resolves per form now, so the check has to name one. AP-1 is
  // the form the send path this check covers actually posts.
  const { AP1_FORM_CODE } = await import("../../src/features/accounting/constants");
  const ctx = await loadErpJournalBuildContext(AP1_FORM_CODE);

  const targets = Object.keys(ctx.deptGlOverridesByTarget);
  console.log(`deptGlOverridesByTarget (${AP1_FORM_CODE}): ${targets.length} target key(s)`);
  for (const target of targets) {
    const deptMap = ctx.deptGlOverridesByTarget[target];
    const depts = Object.keys(deptMap);
    console.log(`  target=${target} deptOverrides=${depts.length}`);
    for (const deptId of depts) {
      const o = deptMap[deptId];
      console.log(`    hrDeptId=${deptId} accountNo=${o.accountNo} description=${o.description}`);
    }
  }

  console.log(
    "OK: loadErpJournalBuildContext wired to deptGlOverridesByTarget (read-only, 0 mutations)",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("journal-context-dept-gl check failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
