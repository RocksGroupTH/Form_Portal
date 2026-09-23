import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **Every statement against the four per-brand Interface ERP tables bounds
 * itself by the BC environment.**
 *
 * Migration 161 split `AccBrandJournalBatch`, `AccBrandGlAccount`,
 * `AccBrandBankAccount` and `AccBrandBranchCode` by BC environment, because
 * every value in them is the name of an object inside one company — a batch, an
 * account number, a bank card, a BRANCH dimension value. A value chosen from
 * Production's chart may not exist in Sandbox, and the journal built from it
 * fails when somebody presses Send.
 *
 * ## Two different silent failures, one predicate
 *
 * A **read** without it returns the other environment's configuration: a real
 * row, no error, and a journal posted with an account that belongs to a company
 * nobody meant. A **write** without it is worse, because two of these paths are
 * delete-then-insert: saving one environment's override would remove the
 * other's outright, and the row would simply be gone.
 *
 * Neither is a type error and neither is visible from a behavioural test of the
 * calling screen, which renders a list either way. The text of the SQL is what
 * can be checked, so that is what this reads.
 *
 * ## What counts as bounding it, and why there are two spellings
 *
 * `brandErpEnvPredicate()` is the one to use — that is what the module exists
 * for. But a `SELECT` names the column plainly (`…, FormCode, Environment`) and
 * an `INSERT` names it in its column list, so requiring the helper alone would
 * red every one of those. Either spelling satisfies this; what fails is a
 * statement that names neither, which is a statement that cannot tell the two
 * environments apart.
 *
 * ## `AccBrandErpInterface` is deliberately absent
 *
 * Claim brand → interface target is a decision about the business, not the name
 * of an object inside a company. It carries no `Environment` column and must
 * not be given one — see `brand-erp-environment.ts`.
 */

const SRC = path.resolve(process.cwd(), "src");

const SPLIT_TABLES = [
  "AccBrandJournalBatch",
  "AccBrandGlAccount",
  "AccBrandBankAccount",
  "AccBrandBranchCode",
];

const SELF = "brand-erp-environment-guard.test.ts";

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

const FILES = sourceFiles(SRC)
  .map((p) => ({
    rel: path.relative(SRC, p).split(path.sep).join("/"),
    src: fs.readFileSync(p, "utf8"),
  }))
  .filter((f) => !f.rel.endsWith(SELF));

/**
 * The template literals in a file, which is where every statement here lives.
 *
 * Slicing from the table's NAME forward — the obvious first attempt — is wrong
 * twice over: the verb sits BEFORE the name (`DELETE FROM [dbo].[X]`), so the
 * slice loses the very keyword that says it is a statement, and the slice then
 * runs into whatever follows. Odd-indexed backtick-delimited chunks are the
 * template bodies, which is the unit a statement actually occupies.
 */
function templates(src: string): string[] {
  const parts = src.split("`");
  const out: string[] = [];
  for (let i = 1; i < parts.length; i += 2) out.push(parts[i]);
  return out;
}

function isStatement(sql: string): boolean {
  return /\b(SELECT|INSERT|UPDATE|DELETE|MERGE)\b/i.test(sql);
}

test("every statement on a split table bounds itself by the environment", () => {
  const offenders: string[] = [];
  for (const { rel, src } of FILES) {
    for (const sql of templates(src)) {
      if (!isStatement(sql)) continue;
      const table = SPLIT_TABLES.find((t) => sql.indexOf(t) !== -1);
      if (!table) continue;
      if (sql.indexOf("brandErpEnvPredicate") !== -1) continue;
      if (sql.indexOf("Environment") !== -1) continue;
      offenders.push(`${rel} — a statement on ${table}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "these read or write a per-brand Interface ERP table without naming the environment. Since " +
      "migration 161 each holds Production AND Sandbox rows: a read returns the other " +
      "environment's account or batch, and an unbounded delete-then-insert removes it:\n  " +
      offenders.join("\n  "),
  );
});

test("the three services resolve the environment rather than assuming one", () => {
  /* They resolve it themselves when the caller does not say — that is what
     keeps the money path from being able to forget. What must not happen is a
     literal: `Environment = 'Production'` is correct for exactly one half of
     the users and wrong for the other, with no error either way. */
  for (const { rel, src } of FILES) {
    const bad = /Environment\s*=\s*'(Production|Sandbox)'/.exec(src);
    assert.equal(
      bad,
      null,
      `${rel} compares Environment against the literal ${bad?.[1]}. Use the resolved value ` +
        "(resolveEffectiveErpEnvironment, or the caller's explicit override)",
    );
  }
  for (const rel of [
    "lib/acc/brand-journal-batch-service.ts",
    "lib/acc/brand-account-service.ts",
    "lib/acc/brand-branch-service.ts",
  ]) {
    const src = FILES.find((f) => f.rel === rel)?.src ?? "";
    assert.ok(
      src.indexOf("resolveEffectiveErpEnvironment()") !== -1,
      `${rel} no longer resolves the environment when a caller omits it — every read on the ` +
        "money path passes nothing, so this is what decides which half they get",
    );
    assert.ok(
      src.indexOf("brandErpEnvPredicate") !== -1,
      `${rel} no longer uses the shared predicate. Hand-writing it per query is how one copy ` +
        "loses its arm and silently reads the other environment's configuration",
    );
  }
});

test("AccBrandErpInterface is not split", () => {
  /* Stated as a test rather than only in prose, because "split the Interface
     ERP tables" reads as though it should be one of them. It maps a claim brand
     to the company its claims post into, which is the same answer in both
     environments; giving it an Environment would invite two org charts. */
  for (const { rel, src } of FILES) {
    if (rel.endsWith(".test.ts")) continue;
    for (const sql of templates(src)) {
      if (!isStatement(sql)) continue;
      if (sql.indexOf("AccBrandErpInterface") === -1) continue;
      assert.ok(
        sql.indexOf("Environment") === -1 && sql.indexOf("brandErpEnvPredicate") === -1,
        `${rel} names the environment in a statement on AccBrandErpInterface. That table has no ` +
          "such column and must not gain one — claim brand -> target is a business decision, " +
          "not the name of an object inside a BC company",
      );
    }
  }
});
