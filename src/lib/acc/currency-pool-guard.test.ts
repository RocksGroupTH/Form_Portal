import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * `BrandSetting` exists in `Rocks_Portal_Form` and **not** in
 * `Rocks_Portal_Form_UAT` — measured 2026-08-28, and migration 124 refuses to
 * run against the UAT database at all.
 *
 * So a read through `getAccPool()` / `getFormPool()` throws `Invalid object
 * name 'BrandSetting'` **for a UAT tester and for nobody else**, on the
 * amount-entry path of both AP-1 and AP-17. No type catches it, no build
 * catches it, and no ordinary test run catches it: production works perfectly
 * while the people testing the feature cannot use it. It is the same hazard
 * CLAUDE.md records for `DepartmentErpMap`.
 *
 * This reads the source instead, because there is no route or database harness
 * in this repo.
 *
 * **The rule is per FILE, not per statement.** A module that touches
 * `BrandSetting` must not also import a request-scoped pool, because the next
 * person to add a query there will reach for whichever pool is already in
 * scope. That is why brand writes belong in `brand-registry.ts` — which uses
 * `getProductionFormPool()` and imports neither — and never in
 * `settings-service.ts`, whose first line imports `getAccPool`.
 *
 * If this test goes red, the fix is to move the `BrandSetting` access, never to
 * weaken the check.
 */

const SRC = path.resolve(process.cwd(), "src");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Comments quoting the rule must not trip it. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("BrandSetting is only ever reached through the production pool", () => {
  const offenders: string[] = [];
  let touched = 0;

  for (const file of sourceFiles(SRC)) {
    const code = codeOf(fs.readFileSync(file, "utf8"));
    if (!/BrandSetting/.test(code)) continue;
    touched++;
    if (/getAccPool|getFormPool\b/.test(code)) offenders.push(path.relative(SRC, file));
  }

  // A guard on the guard: a refactor that renamed the table would leave this
  // passing by inspecting nothing at all.
  assert.ok(touched > 0, "no source file mentions BrandSetting — has it been renamed?");

  assert.deepEqual(
    offenders,
    [],
    "these reach BrandSetting from a pool that resolves the UAT database, where it does not exist: " +
      offenders.join(", "),
  );
});
