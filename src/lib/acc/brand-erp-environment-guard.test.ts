import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BRAND_ERP_ENVIRONMENT_COLUMN } from "@/lib/acc/brand-erp-environment";

/**
 * **Every statement against the four per-brand Interface ERP tables bounds
 * itself to one Business Central environment.**
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
 * ## It found a real defect on its first run, which is why it counts rather
 * ## than merely looks
 *
 * `upsertBrandBranch` was half-converted: three statements named `@environment`
 * with nothing binding it, and both INSERTs supplied the value with no column
 * to put it in. The typecheck was clean — an unbound SQL parameter and a
 * column-count mismatch are both runtime errors.
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
 * Scan a source once, returning every template literal with its position, and a
 * copy of the source with comments blanked out (same length, so positions still
 * line up).
 *
 * **Two cheaper approaches were tried and both were wrong**, which is why this
 * is a scanner rather than a regex. Slicing from the table's NAME forward loses
 * the verb, because it sits BEFORE the name (`DELETE FROM [dbo].[X]`).
 * Splitting on backticks and taking the odd chunks then broke the moment the
 * unit became a function body rather than a whole file: the doc comments in
 * these services are full of backticks, so an odd count inside one comment
 * INVERTS the parity and every "template" afterwards is the code between them.
 * That is not a theoretical failure — it reported two INSERTs as missing a
 * column they plainly have.
 *
 * Blanking comments matters for the counting rule too: a `brandErpEnvPredicate`
 * named in prose must not be counted as a call that bounds a statement.
 */
function scan(src: string): { templates: { at: number; text: string }[]; code: string } {
  const templates: { at: number; text: string }[] = [];
  const code: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") code.push(" "), i++;
      continue;
    }
    if (c === "/" && next === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      while (i < stop) code.push(src[i] === "\n" ? "\n" : " "), i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      const start = i;
      code.push(c);
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") code.push(src[i]), i++;
        if (i < src.length) code.push(src[i]), i++;
      }
      code.push(src[i] ?? "");
      i++;
      if (quote === "`") templates.push({ at: start, text: src.slice(start + 1, i - 1) });
      continue;
    }
    code.push(c);
    i++;
  }
  return { templates, code: code.join("") };
}

/**
 * A statement's verb — its FIRST keyword, with `--` comments removed first.
 *
 * Not "does the word INSERT appear anywhere", which is what this asked at
 * first and which is wrong in a way the SQL here makes routine: the comment
 * above both delete-then-insert statements says the words *delete-then-insert*,
 * so every one of those DELETEs was classified as an INSERT, sent down the
 * column-list arm, and reported as missing a column it has no business having.
 */
function verb(sql: string): string | null {
  const body = sql.replace(/--[^\n]*/g, " ");
  const m = /\b(SELECT|INSERT|UPDATE|DELETE|MERGE)\b/i.exec(body);
  return m ? m[1].toUpperCase() : null;
}

function isStatement(sql: string): boolean {
  return verb(sql) !== null;
}

function isInsert(sql: string): boolean {
  return verb(sql) === "INSERT";
}

/**
 * The source's top-level functions, as `{ name, at, end }`.
 *
 * The unit has to be the function rather than the statement, because the
 * predicate a statement depends on is frequently not inside it — see the
 * counting rule in the first test. Read off the comment-blanked copy, so a
 * `function` written in prose cannot open a phantom range.
 */
function functions(code: string): { name: string; at: number; end: number }[] {
  const re = /\n(?:export )?(?:async )?function (\w+)/g;
  const marks: { name: string; at: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) marks.push({ name: m[1], at: m.index });
  return marks.map((mark, i) => ({
    name: mark.name,
    at: mark.at,
    end: i + 1 < marks.length ? marks[i + 1].at : code.length,
  }));
}

test("every statement on a split table bounds itself to one environment", () => {
  const offenders: string[] = [];
  for (const { rel, src } of FILES) {
    const { templates, code } = scan(src);
    for (const fn of functions(code)) {
      const stmts = templates
        .filter((t) => t.at >= fn.at && t.at < fn.end)
        .map((t) => t.text)
        .filter((sql) => isStatement(sql) && SPLIT_TABLES.some((t) => sql.indexOf(t) !== -1));
      if (stmts.length === 0) continue;

      // An INSERT bounds itself by naming the column; it has no WHERE to put a
      // predicate in. Supplying @environment without the column is a
      // column-count mismatch, which is how this arm earned its keep.
      for (const sql of stmts) {
        if (!isInsert(sql)) continue;
        const cols = /\(([^)]*)\)\s*(?:\r?\n\s*)?VALUES/i.exec(sql);
        if (!cols || cols[1].indexOf(BRAND_ERP_ENVIRONMENT_COLUMN) === -1)
          offenders.push(`${rel} — ${fn.name}: an INSERT with no Environment column`);
      }

      /* Everything else needs a predicate, and the calls are COUNTED rather
         than merely found. The predicate is often seeded into an array the
         template interpolates — `const conditions = [brandErpEnvPredicate()]` —
         so the text a read depends on sits outside the read's own template. A
         presence test would then be satisfied by a SIBLING statement's call,
         and an earlier version of this file was satisfied by a SELECT's column
         LIST while its WHERE went unbounded. One call per statement is the
         rule that actually holds. */
      const need = stmts.filter((sql) => !isInsert(sql)).length;
      const have = code.slice(fn.at, fn.end).split("brandErpEnvPredicate").length - 1;
      if (have < need)
        offenders.push(
          `${rel} — ${fn.name}: ${need} statement(s) need the environment, ` +
            `${have} brandErpEnvPredicate call(s)`,
        );
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "these read or write a per-brand Interface ERP table without bounding it to one " +
      "environment. Since migration 161 each table holds Production AND Sandbox rows: a read " +
      "returns the other environment's account or batch, and an unbounded delete-then-insert " +
      "removes it:\n  " +
      offenders.join("\n  "),
  );
});

test("the three services resolve the environment rather than assuming one", () => {
  /* They resolve it themselves when the caller does not say — that is what
     keeps the money path from being able to forget, and why the parameter
     exists only for the settings screens' PRO/UAT toggle. What must not happen
     is a literal: `Environment = 'Production'` is correct for exactly one half
     of the users and wrong for the other, with no error either way. */
  for (const { rel, src } of FILES) {
    const bad = /Environment\s*=\s*'(Production|Sandbox)'/.exec(src);
    assert.equal(
      bad,
      null,
      `${rel} compares Environment against the literal ${bad?.[1]}. Use the resolved value ` +
        "(resolveEffectiveErpEnvironment, or the caller's explicit override)",
    );
  }
  /* Per FUNCTION, not per file. A file-level presence test is satisfied by a
     sibling: `brand-account-service` resolves it three times over (list, upsert
     and merge, since one service covers both gl and bank), so replacing ONE of
     them with a literal leaves the file still mentioning the resolver and the
     test still green. Mutation-verified — that mutation is the reason this arm
     is written this way rather than as the one-liner it started as. */
  const offenders: string[] = [];
  for (const rel of [
    "lib/acc/brand-journal-batch-service.ts",
    "lib/acc/brand-account-service.ts",
    "lib/acc/brand-branch-service.ts",
  ]) {
    const src = FILES.find((f) => f.rel === rel)?.src ?? "";
    assert.notEqual(src, "", `${rel} is missing — has it been renamed?`);
    const { code } = scan(src);
    for (const fn of functions(code)) {
      const body = code.slice(fn.at, fn.end);
      // The signal that a function answers per environment at all: it accepts
      // the override. Every one of those must also carry the fallback, or a
      // caller that passes nothing gets whatever was hardcoded instead.
      if (body.indexOf("ErpBcEnvironment") === -1) continue;
      if (body.indexOf("resolveEffectiveErpEnvironment()") === -1)
        offenders.push(`${rel} — ${fn.name}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "these take an environment override but no longer resolve one when the caller omits it. " +
      "Every read on the money path passes nothing, so the fallback is what decides which " +
      "half of the configuration they get:\n  " + offenders.join("\n  "),
  );
});

test("a settings route takes its environment from the viewer, not from its path", () => {
  /**
   * **The navbar's PRO/UAT switch decides which half these screens configure**
   * — the user's rule, 2026-09-24: *"UAT หรือ PRO ไม่ต้องเปลี่ยนตรงนี้ เพราะ
   * เปลี่ยนจากด้านบน navbar อยู่แล้ว"*. A control on the page would be a second
   * switch sharing the word UAT, which `erp-environment.ts` already names as
   * how a test request ends up in the real ERP.
   *
   * So these routes call `resolveSettingsErpEnvironment()`. What they must NOT
   * call is the ordinary `resolveEffectiveErpEnvironment()`, and the failure is
   * the quiet kind: it compiles, it returns a real `ErpBcEnvironment`, and it
   * answers **Production however the navbar is set** — because the settings
   * prefix is pinned to `null` in `ROUTE_RULES` (so a config-row id is not read
   * as an `AccRequest` id) and a `null` class resolves Production outright. The
   * screen would then show and save the PRO half to somebody who is looking at
   * a UAT chip in the navbar.
   *
   * And they must not take it off the wire either. A settings route that reads
   * `?environment=` has reintroduced the second switch through the back door,
   * this time one the page can set without the person seeing it.
   */
  const WIRE = [
    'searchParams.get("environment")',
    "body.environment",
    "body?.environment",
  ];
  const offenders: string[] = [];
  for (const { rel, src: raw } of FILES) {
    if (!rel.startsWith("app/api/") || rel.indexOf("/settings/") === -1) continue;
    // Comment-blanked, because these routes NAME the wrong resolver in prose in
    // order to say why they do not call it — and a text search cannot tell an
    // explanation from a call.
    const src = scan(raw).code;
    // The IDENTIFIER, not the substring: `@/lib/form-environment/classify-path`
    // is an import path and says nothing about Business Central.
    if (!/(?<![\w/-])environment(?![\w/-])/i.test(src)) continue;

    if (src.indexOf("resolveEffectiveErpEnvironment(") !== -1)
      offenders.push(`${rel} — calls resolveEffectiveErpEnvironment, which answers Production here`);
    const wire = WIRE.filter((needle) => src.indexOf(needle) !== -1);
    if (wire.length > 0)
      offenders.push(`${rel} — takes the environment off the wire (${wire.join(", ")})`);
    /* `advanceErpEnvironment()` is the second legitimate spelling, and it
       predates this: AP-2's live batch picker resolves through
       `resolveFormAccess(AP-2)`, which consults the same `viewerIsTesting()`
       and additionally requires AP-2 itself to be UAT-enabled. So it follows
       the navbar too, just with one extra condition — a tester whose AP-2 has
       UatEnabled off gets Production there and Sandbox on the Interface ERP
       tab. Left alone deliberately rather than unified: that route is not part
       of the 161 split, and changing what an existing picker resolves is a
       decision rather than a tidy-up. */
    if (
      src.indexOf("resolveSettingsErpEnvironment") === -1 &&
      src.indexOf("advanceErpEnvironment") === -1 &&
      src.indexOf("resolveEffectiveErpEnvironment(") === -1 &&
      wire.length === 0
    )
      offenders.push(`${rel} — names an environment but resolves none`);
  }
  assert.deepEqual(
    offenders,
    [],
    "these settings routes do not follow the navbar's PRO/UAT switch:\n  " + offenders.join("\n  "),
  );
});

test("the ERP send's echo is an echo, and stays one", () => {
  /**
   * The one place a request body legitimately carries an environment.
   *
   * The send takes it as an **echo**: the client sends back the environment the
   * queue it is looking at was built in, the route compares it with the freshly
   * resolved one, and answers 409 on drift so the page reloads rather than
   * posting a journal into a company the operator was not looking at. The value
   * is compared and discarded — never stored, never used to select rows.
   *
   * Pinned to that fact rather than merely excused: turn the echo into
   * something the route acts on and the comparison goes with it, and this test
   * says so.
   */
  const ECHO_ROUTE = "app/api/request/accounting/erp-prep/send/route.ts";
  const echo = FILES.find((f) => f.rel === ECHO_ROUTE);
  assert.ok(echo, `${ECHO_ROUTE} is missing — has it moved?`);
  assert.ok(
    echo.src.indexOf("body.environment") !== -1,
    `${ECHO_ROUTE} no longer reads the echoed environment, so the client and the server can ` +
      "drift apart with nothing noticing",
  );
  assert.ok(
    echo.src.indexOf("ENVIRONMENT_STALE_ERROR") !== -1,
    `${ECHO_ROUTE} no longer refuses on environment drift, so its body.environment is not an ` +
      "echo any more — it is an input, and an input must not come from the client",
  );
});

test("AccBrandErpInterface is not split", () => {
  /* Stated as a test rather than only in prose, because "split the Interface
     ERP tables" reads as though it should be one of them. It maps a claim brand
     to the company its claims post into, which is the same answer in both
     environments; giving it an Environment would invite two org charts. */
  for (const { rel, src } of FILES) {
    if (rel.endsWith(".test.ts")) continue;
    for (const { text: sql } of scan(src).templates) {
      if (!isStatement(sql)) continue;
      if (sql.indexOf("AccBrandErpInterface") === -1) continue;
      assert.ok(
        sql.indexOf(BRAND_ERP_ENVIRONMENT_COLUMN) === -1 &&
          sql.indexOf("brandErpEnvPredicate") === -1,
        `${rel} names the environment in a statement on AccBrandErpInterface. That table has no ` +
          "such column and must not gain one — claim brand -> target is a business decision, " +
          "not the name of an object inside a BC company",
      );
    }
  }
});
