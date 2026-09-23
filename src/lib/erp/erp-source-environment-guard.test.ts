import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **Every query against the Business Central mirror names `SourceEnvironment`.**
 *
 * Migration 159 let a tester's Sandbox rows and production's live rows sit in
 * one set of tables. From that moment a query without the predicate is not an
 * error — it is a query that returns **more rows than it should**, silently:
 * a tester's picker listing production's chart of accounts, or a production
 * journal built against a Sandbox branch. Nothing throws, nothing is empty, and
 * every row it returns is a real row.
 *
 * ## Why this is a source-reading guard
 *
 * The failure is a **missing clause**. No type catches it, no behavioural test
 * of the calling feature would notice — it renders a list either way — and
 * there is no database harness in this repository. What can be checked is the
 * text of the SQL, and the one thing worth checking is exactly the thing that
 * goes missing.
 *
 * ## The rule, and why it is per STATEMENT rather than per file
 *
 * A file-level "this module mentions SourceEnvironment somewhere" arm passes
 * the moment one of a file's nine queries has it — which is the shape
 * `advance-erp-master-service.ts` actually has. The arm below slices each
 * `FROM [dbo].[Erp…]` out with the WHERE that follows it, so a tenth query
 * added without the predicate reds on its own.
 *
 * ## What it deliberately does NOT check
 *
 * That the predicate is *correct* — that it compares against the resolved
 * environment rather than a literal. A guard over SQL text cannot verify SQL
 * semantics, a lesson this repository has recorded twice (AP-4's
 * `queue-service-guard.test.ts`, AP-17's continuation guard). What it makes
 * impossible is the clause being absent, which is the failure that has
 * actually happened: `ErpVendors` carried this column from migration 117 and
 * every row said `Production` for two years because nothing filled it in.
 *
 * If this goes red, add the predicate. Do not add the file to the exemptions —
 * there are none, and a query that genuinely wants both environments should say
 * so with its own explicit `SourceEnvironment IN (…)`, which this arm accepts
 * because the column is named.
 */

const SRC = path.resolve(process.cwd(), "src");

/** The mirror tables. `ErpSyncLog` is here too: which run wrote it matters. */
const MIRROR_TABLES = [
  "ErpAccounts",
  "ErpBankAccountCard",
  "ErpDimensionValue",
  "ErpGeneralJournalBatch",
  "ErpLocation",
  "ErpSyncLog",
  "ErpVendors",
];

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
  .filter((f) => !f.rel.endsWith("erp-source-environment-guard.test.ts"));

/**
 * Each statement that reads a mirror table, as the block of SQL from the
 * `FROM`/`INTO`/`MERGE` naming it up to the end of that template literal.
 *
 * Cut at the backtick rather than at a fixed number of lines: a WHERE can be
 * several lines below its FROM, and a query with no WHERE at all (a plain
 * `SELECT … FROM`) is exactly the case that must not be skipped.
 */
function mirrorStatements(src: string): { table: string; sql: string }[] {
  const out: { table: string; sql: string }[] = [];
  for (const table of MIRROR_TABLES) {
    const needle = "[dbo].[" + table + "]";
    let at = src.indexOf(needle);
    while (at !== -1) {
      const end = src.indexOf("`", at);
      out.push({ table, sql: src.slice(at, end === -1 ? src.length : end) });
      at = src.indexOf(needle, at + 1);
    }
  }
  return out;
}

test("every mirror statement names SourceEnvironment", () => {
  const offenders: string[] = [];
  for (const { rel, src } of FILES) {
    for (const { table, sql } of mirrorStatements(src)) {
      if (sql.indexOf("SourceEnvironment") !== -1) continue;
      offenders.push(`${rel} — a statement on ${table}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "these statements read or write the BC mirror without naming SourceEnvironment. Since " +
      "migration 159 the tables hold Production AND Sandbox rows, so an unqualified statement " +
      "returns the other environment's data — silently, with no error and no empty result:\n  " +
      offenders.join("\n  "),
  );
});

test("the sync writers stamp the environment rather than defaulting it", () => {
  /* An INSERT that omits the column takes the DEFAULT, which is 'Production'.
     For the SIBLING applications that is exactly right and is what migration
     160's views rely on. For OUR syncs it is a silent mislabel: a Sandbox sync
     would write rows claiming to be Production, and they would then leak into
     the sibling's view. So every INSERT this app makes names the column. */
  for (const { rel, src } of FILES) {
    if (!rel.startsWith("lib/erp/")) continue;
    for (const { table, sql } of mirrorStatements(src)) {
      if (sql.indexOf("INSERT") === -1) continue;
      assert.ok(
        sql.indexOf("SourceEnvironment") !== -1,
        `${rel} INSERTs into ${table} without naming SourceEnvironment. It would take the ` +
          "DEFAULT ('Production') — right for Rocks Fast writing through Fast_Data's view, " +
          "wrong for us: a Sandbox sync would write rows labelled Production",
      );
    }
  }
});

test("the environment comes from the shared resolver, not a literal", () => {
  /* `ERP_VENDOR_SOURCE_ENVIRONMENT = "Production"` is how this went wrong the
     first time: migration 117 built the column, and a literal meant every
     vendor row said Production whichever BC it came from. A literal here is
     that mistake returning, and it is invisible — the predicate is present, the
     query runs, and the answer is wrong for exactly one half of the users. */
  for (const { rel, src } of FILES) {
    const bad = /SourceEnvironment\s*=\s*'(Production|Sandbox)'/.exec(src);
    assert.equal(
      bad,
      null,
      `${rel} compares SourceEnvironment against the literal ${bad?.[1]}. Use the resolved ` +
        "environment (resolveErpSourceEnvironment, or a ctx/parameter carrying it) — a literal " +
        "is correct for exactly one of the two environments and wrong for the other, with no " +
        "error either way",
    );
  }
});
