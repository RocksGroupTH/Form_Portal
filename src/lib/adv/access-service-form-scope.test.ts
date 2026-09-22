import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ADV_CLR_FORMS, storableAdvClrKeysForForm } from "./settings-tabs";

/**
 * `setAdvClrAccessTabs` must replace only the keys of the form being saved.
 *
 * **This guard exists because the unscoped version destroys live access data.**
 * `AccAdvClrAccess` is one roster for two forms and `AccAdvClrAccessTab` one
 * column of keys over it, so while both forms' grants were edited on one screen
 * a full `DELETE ... WHERE AccessId = @aid` was correct: the posted list really
 * was the whole granted set. The moment AP-2's screen posts only AP-2's keys,
 * that same statement deletes every AP-3 grant the person holds — silently, in
 * BOTH databases, on the screen whose whole job is handing out access. It is
 * the write-side twin of the read-side failure CLAUDE.md already records for
 * AP-4: *"the next tick would POST a one-element set and revoke the rest."*
 *
 * **Source-reading, because the thing that must hold is a missing SQL bound**
 * and no behavioural test in this repository can see one: `access-service.ts`
 * reaches `@/env` through `@/lib/adv/pool`, which validates the whole
 * environment at import time and throws in the test runner, so the service
 * cannot be imported here at all.
 *
 * That makes this the weaker of two layers and it is written as such. The
 * layer with teeth is `settings-tabs.test.ts`, which re-derives the partition
 * itself — every storable key belongs to exactly one form, and the two scopes
 * together cover the whole vocabulary. This file's job is only to pin that the
 * SQL is bound to *that* partition rather than to a list retyped beside the
 * statement, which is how one copy of a rule loses an arm.
 */

const FILE = "src/lib/adv/access-service.ts";

/**
 * Comments stripped before anything is matched. This file NAMES the statement
 * it used to carry and explains why it changed, so a search over raw text would
 * pass on prose alone — the failure mode `settings-route-gates.test.ts`
 * documents for the routes it reads.
 */
const code = fs
  .readFileSync(path.resolve(process.cwd(), FILE), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

const REPLACE = "setAdvClrAccessTabs";

/** One exported function's source, from its signature to the next export. */
function bodyOf(name: string): string {
  const start = code.indexOf("export async function " + name + "(");
  assert.notEqual(start, -1, name + " is gone from " + FILE + " — has it been renamed?");
  const rest = code.slice(start);
  const next = rest.slice(1).search(/\nexport\s/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/** The text of the first `DELETE` template literal in a function body. */
function deleteStatement(body: string): string {
  const m = body.match(/DELETE FROM[\s\S]*?`/);
  assert.ok(m, REPLACE + " no longer issues a DELETE at all");
  return m![0];
}

/** The right-hand side of `const <name> = ...;` inside a body. */
function declarationOf(body: string, name: string): string {
  const at = body.indexOf("const " + name + " =");
  assert.notEqual(at, -1, name + " is not declared in " + REPLACE);
  const from = body.slice(at + ("const " + name + " =").length);
  const end = from.indexOf(";");
  assert.notEqual(end, -1, name + "'s declaration does not terminate");
  return from.slice(0, end);
}

test("the replace takes a REQUIRED form — an optional one is a default that deletes", () => {
  const sig = bodyOf(REPLACE).split(")")[0];
  assert.ok(
    /\bform\s*:/.test(sig),
    REPLACE + " takes no form — it cannot know which half of the roster it may replace",
  );
  // An optional or defaulted parameter is the whole hazard wearing a type: a
  // caller that forgets it still compiles, and whichever form the default names
  // has the OTHER form's grants deleted out from under it.
  assert.ok(!/\bform\s*\?\s*:/.test(sig), "form is optional — a caller can omit it");
  assert.ok(
    !/\bform\s*:[^,)]*=/.test(sig),
    "form carries a default — an omitted form silently picks one",
  );
});

test("the DELETE is bounded to the saved form's own keys", () => {
  const del = deleteStatement(bodyOf(REPLACE));
  assert.ok(del.includes("AccAdvClrAccessTab"), "the delete no longer names the grant table");
  assert.ok(del.includes("AccessId = @aid"), "the delete is no longer scoped to one person");
  // THE assertion, and the one that failed before this change landed. Without
  // this arm the statement removes every key the person holds, the other form's
  // included, which nothing else in this repository would notice.
  assert.ok(
    /AND\s+TabKey\s+IN\s*\(/.test(del),
    "the delete is not bounded by TabKey — saving one form wipes the other form's grants",
  );
});

test("the bounded list is parameterized, never interpolated key text", () => {
  const body = bodyOf(REPLACE);
  const del = deleteStatement(body);

  const m = del.match(/TabKey\s+IN\s*\(\$\{(\w+)\}\)/);
  assert.ok(m, "the IN list is not built from a single interpolated placeholder list");
  const expr = declarationOf(body, m![1]);

  // Placeholders are mapped from an INDEX, so no key value can reach the SQL
  // text at all. A map over the key strings themselves would interpolate them.
  assert.ok(/\.map\(/.test(expr), "the placeholder list is not mapped from the scope");
  const prefix = (expr.match(/@([A-Za-z_]\w*)\$\{/) ?? [])[1];
  assert.ok(prefix, "the placeholders are not @name${i} parameters mapped from an index");

  // Every placeholder the statement names must actually be bound, and typed.
  assert.ok(
    body.includes(".input(`" + prefix + "${"),
    "the @" + prefix + "N placeholders are never bound with .input()",
  );
  assert.ok(
    /sql\.NVarChar/.test(body),
    "the bound keys are not typed — an untyped input is a driver guess",
  );
});

test("the list bound into the DELETE is the FORM'S SCOPE, not the posted keys", () => {
  // Added after mutation testing: every assertion above survived swapping
  // `scope` for `wanted` in both the map and the binding loop, and that is a
  // real bug rather than a stylistic one. Bound to `wanted`, the statement
  // deletes only the keys it is about to re-insert — so **unticking a box never
  // takes effect**, and a grant can be added from this screen but never removed
  // by it. The shape stays perfectly parameterized while doing it, which is why
  // none of the shape checks noticed.
  const body = bodyOf(REPLACE);
  const del = deleteStatement(body);
  const listVar = (del.match(/TabKey\s+IN\s*\(\$\{(\w+)\}\)/) ?? [])[1];
  assert.ok(listVar, "the IN list is not an interpolated placeholder list");

  // Whatever array the placeholders are mapped from is the one being deleted.
  const source = (declarationOf(body, listVar).match(/(\w+)\s*\.map\(/) ?? [])[1];
  assert.ok(source, "the placeholder list is not mapped from a named array");
  assert.ok(
    declarationOf(body, source).includes("storableAdvClrKeysForForm("),
    "the DELETE is bound to `" + source + "`, which is not the form's key scope — " +
      "if that is the posted list, unticking a grant silently does nothing",
  );

  // ...and the .input() loop must bind that SAME array, or the placeholders and
  // their values come from two different lists.
  assert.ok(
    new RegExp("\\b" + source + "\\.forEach\\(").test(body),
    "the bound values do not come from `" + source + "`, the array the placeholders count",
  );
});

test("the bound list is the shared metadata, not a key list retyped beside the SQL", () => {
  const body = bodyOf(REPLACE);
  assert.ok(
    body.includes("storableAdvClrKeysForForm("),
    "the delete's scope is not derived from settings-tabs — a second copy of the " +
      "partition here would lose an arm the next time a key is added",
  );
  assert.ok(
    /import[\s\S]*storableAdvClrKeysForForm[\s\S]*from "@\/lib\/adv\/settings-tabs"/.test(code),
    "storableAdvClrKeysForForm is not imported from the module that owns the partition",
  );
  // No literal key may appear anywhere in the service. A retyped list is how
  // the screen and the write come to disagree about what a form owns.
  const keys = ADV_CLR_FORMS.reduce<string[]>(
    (acc, form) => acc.concat(storableAdvClrKeysForForm(form)),
    [],
  );
  for (const key of keys) {
    assert.ok(
      !code.includes('"' + key + '"'),
      "the key \"" + key + "\" is written out in " + FILE + " — derive it instead",
    );
  }
});

test("no unbounded delete of the grant table survives anywhere in the file", () => {
  // The sweep, not the spot check: a second writer added later must not
  // reintroduce the statement this guard exists to have removed.
  const parts = code.split("DELETE FROM");
  for (let i = 1; i < parts.length; i += 1) {
    const stmt = parts[i].slice(0, parts[i].indexOf("`") === -1 ? undefined : parts[i].indexOf("`"));
    if (!stmt.includes("AccAdvClrAccessTab")) continue;
    assert.ok(
      /AND\s+TabKey\s+IN\s*\(/.test(stmt),
      "an unbounded DELETE against AccAdvClrAccessTab is back: " + stmt.trim(),
    );
  }
});
