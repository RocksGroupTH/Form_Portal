import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * `UatTesterPerDiem` moved out of Fast_Core into `Rocks_Portal_Form_UAT`
 * (migrations 139/140), and the pool it is read through is now load-bearing in
 * a way it was not before. `UatTester` itself did NOT move and stays in
 * `Fast_Core` — `src/lib/uat-tester/service.ts` legitimately calls
 * `getCorePool()` and must not appear in the list this file guards.
 *
 * `getUatFormPool` is `getNamedPool(env.MSSQL_FORM_UAT_DATABASE)` — a literal
 * that consults no resolver. `getFormPool` asks the resolver which database
 * answers, and `getActiveUatTester` is one of the reads the resolver performs to
 * decide that, so using it closes the loop `getFormPool →
 * resolveFormEnvironment → resolveCurrentFormAccess → viewerIsTesting →
 * getActiveUatTester → getFormPool`. `src/lib/acc/pool.ts` exports
 * `getAccPool = getFormPool`, so the loop is one habitual reach away.
 *
 * Source-reading rather than behavioural: the failure is a swapped identifier
 * that typechecks, and the symptom is either infinite recursion or
 * `Invalid object name` at runtime — neither of which a unit test of these
 * functions would surface, because they open pools.
 */

const SRC = path.resolve(process.cwd(), "src");

/** Comments quoting the rule must not satisfy it, nor trip it. */
function code(file: string): string {
  return fs
    .readFileSync(path.resolve(SRC, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const MOVED_TABLE_MODULES = [
  "lib/uat-tester/per-diem.ts",
];

const FORBIDDEN = ["getFormPool", "getAccPool", "getProductionFormPool", "getCorePool"];

test("the moved table is read through getUatFormPool", () => {
  for (const file of MOVED_TABLE_MODULES) {
    const src = code(file);
    assert.ok(
      /\bgetUatFormPool\s*\(/.test(src),
      `${file} no longer calls getUatFormPool — UatTesterPerDiem lives in ` +
        "Rocks_Portal_Form_UAT and that literal pool is the only correct way to reach it",
    );
  }
});

test("no forbidden pool getter appears in the moved-table modules", () => {
  for (const file of MOVED_TABLE_MODULES) {
    const src = code(file);
    for (const bad of FORBIDDEN) {
      assert.ok(
        !new RegExp(`\\b${bad}\\b`).test(src),
        `${file} names ${bad}. getFormPool and getAccPool close the resolver loop ` +
          "getFormPool -> resolveFormEnvironment -> viewerIsTesting -> getActiveUatTester -> getFormPool; " +
          "getProductionFormPool and getCorePool resolve databases where these tables do not exist",
      );
    }
  }
});

test("getAccPool really is getFormPool, which is why it is forbidden above", () => {
  // If this ever stops being true the second test's reasoning changes, and the
  // reader deserves to find that out here rather than by tracing it.
  const src = code("lib/acc/pool.ts");
  assert.ok(
    /getAccPool\s*=\s*getFormPool/.test(src),
    "src/lib/acc/pool.ts no longer aliases getAccPool to getFormPool — re-check whether " +
      "getAccPool still closes the resolver loop before relaxing the guard above",
  );
});
