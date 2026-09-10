/**
 * Is migration 144 applied? Read-only.
 *
 * `AccReimburseApproverBrand` must exist in BOTH form databases before the AP-4
 * brand-scope code runs: `loadApproverScopeByStaffId` is the first thing both
 * AP-4 queues do, and `listMyWorkRows` names the table inside a query
 * `queryBothPools` runs against both. SQL Server binds object names at compile
 * time, so a missing table is `Invalid object name` — a 500, not an empty list.
 *
 * Reports the answer; changes nothing. Applying 144 is the operator's call.
 */
import fs from "node:fs";
import path from "node:path";
// NOT a static import of mssql: it reaches @/env, which validates the whole
// environment AT IMPORT and throws before loadDotEnvLocal() below has run.
// verify-master-alignment.ts carries the same note and the same dynamic import.

/** Same .env.local reader the sibling checks use — this repo has no dotenv dependency. */
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
    if ((v.startsWith(String.fromCharCode(34)) && v.endsWith(String.fromCharCode(34))) ||
        (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadDotEnvLocal();

/** Database names come from env, and env reaches SQL — never interpolate one unguarded. */
function safeDbName(raw: string | undefined, fallback: string): string {
  const name = (raw ?? fallback).trim();
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`refusing an unsafe database name from the environment: ${JSON.stringify(name)}`);
  }
  return name;
}

async function probe(dbName: string) {
  const { getAppPool } = await import("../../src/lib/db/mssql");
  const pool = await getAppPool(dbName);
  const res = await pool.request().query(`
    SELECT
      CASE WHEN OBJECT_ID('dbo.AccReimburseApproverBrand', 'U') IS NULL THEN 0 ELSE 1 END AS HasBrandTable,
      CASE WHEN OBJECT_ID('dbo.AccReimburseApprover', 'U') IS NULL THEN 0 ELSE 1 END AS HasApproverTable
  `);
  const row = res.recordset[0] as { HasBrandTable: number; HasApproverTable: number };

  let approverRows: number | null = null;
  let activeApprovers: number | null = null;
  if (row.HasApproverTable) {
    const counts = await pool.request().query(`
      SELECT COUNT(*) AS Total, SUM(CASE WHEN IsActive = 1 THEN 1 ELSE 0 END) AS Active
      FROM [dbo].[AccReimburseApprover]
    `);
    const c = counts.recordset[0] as { Total: number; Active: number | null };
    approverRows = c.Total;
    activeApprovers = c.Active ?? 0;
  }

  let brandRows: number | null = null;
  if (row.HasBrandTable) {
    const b = await pool.request().query(`SELECT COUNT(*) AS N FROM [dbo].[AccReimburseApproverBrand]`);
    brandRows = (b.recordset[0] as { N: number }).N;
  }

  return {
    dbName,
    hasBrandTable: !!row.HasBrandTable,
    approverRows,
    activeApprovers,
    brandRows,
  };
}

async function main() {
  const prod = safeDbName(process.env.MSSQL_FORM_DATABASE, "Rocks_Portal_Form");
  const uat = safeDbName(process.env.MSSQL_FORM_UAT_DATABASE, "Rocks_Portal_Form_UAT");

  const results = [await probe(prod), await probe(uat)];

  for (const r of results) {
    console.log(
      `${r.dbName}: AccReimburseApproverBrand ${r.hasBrandTable ? "PRESENT" : "*** MISSING ***"}` +
        ` | AccReimburseApprover rows=${r.approverRows ?? "n/a"} active=${r.activeApprovers ?? "n/a"}` +
        ` | brand rows=${r.brandRows ?? "n/a"}`,
    );
  }

  const missing = results.filter((r) => !r.hasBrandTable);
  if (missing.length > 0) {
    console.log("");
    console.log("FAIL — migration 144 is not applied to: " + missing.map((r) => r.dbName).join(", "));
    console.log("  Both AP-4 queues 500 while it is missing, and /my-work + Home's pending count");
    console.log("  break for EVERY user of EVERY form, because listMyWorkRows names the table");
    console.log("  inside a query queryBothPools runs against both databases.");
    console.log("  Apply: npm run apply-sql -- --db <database> --file migrations/144_acc_reimburse_approver_brand.sql");
    process.exit(1);
  }

  console.log("");
  console.log("PASS — 144 is applied to both form databases.");
  const stranded = results.filter((r) => (r.activeApprovers ?? 0) > 0 && (r.brandRows ?? 0) === 0);
  if (stranded.length > 0) {
    console.log(
      "NOTE — active approvers with zero brand ticks in: " +
        stranded.map((r) => r.dbName).join(", ") +
        ". They approve nothing until an admin ticks a brand at ตั้งค่า → สิทธิ์เข้าถึง.",
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("verify-144-approver-brand failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
