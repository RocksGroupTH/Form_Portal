import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * `BrandSetting` and `BrandCurrency` exist in `Rocks_Portal_Form` and **not** in
 * `Rocks_Portal_Form_UAT` — measured 2026-08-28, and migrations 124 and 127 both
 * refuse to run against the UAT database at all.
 *
 * So a read through `getAccPool()` / `getFormPool()` throws `Invalid object
 * name` **for a UAT tester and for nobody else**, on the amount-entry path of
 * both AP-1 and AP-17. No type catches it, no build catches it, and no ordinary
 * test run catches it: production works perfectly while the people testing the
 * feature cannot use it. It is the same hazard CLAUDE.md records for
 * `DepartmentErpMap`.
 *
 * This reads the source instead, because there is no route or database harness
 * in this repo.
 *
 * **The rule is per FILE, not per statement.** A module that touches either
 * table must not also import a request-scoped pool, because the next person to
 * add a query there will reach for whichever pool is already in scope. That is
 * why brand reads and writes belong in `brand-registry.ts` — which uses
 * `getProductionFormPool()` and imports neither — and never in
 * `settings-service.ts`, whose first line imports `getAccPool`.
 *
 * **`BrandCurrency` is covered as well as `BrandSetting`**, and it is now the
 * one that matters: `BrandSetting`'s currency columns are dead (migration 128
 * drops them) and `BrandCurrency` is the only source of truth for what a claim
 * may be filed in. A guard naming only the old table would go on passing while
 * the live query moved out from under it.
 *
 * If this test goes red, the fix is to move the access, never to weaken the
 * check.
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

/**
 * The production-only tables, each matched as a **whole word**.
 *
 * `\b` on both ends is what keeps `BrandCurrencyEntry`, `BrandCurrencyError` and
 * `brandCurrencyLogValue` out of it: those are types and helpers that travel
 * anywhere, including into files that legitimately open a request-scoped pool.
 * What must not travel is the table name itself. `BrandSettingLog` is excluded
 * by the same mechanism and needs no separate rule — it is written only from
 * `brand-registry.ts`, which the `BrandSetting` arm already covers.
 */
const PRODUCTION_ONLY_TABLES = ["BrandSetting", "BrandCurrency", "TravelProvince"];

/*
 * `TravelProvince` joined on 2026-08-31 and could not have before. It is absent
 * from `Rocks_Portal_Form_UAT` exactly like the other two — migration 104 refuses
 * that database outright and 132 refuses it again — but
 * `travel-booking/request-service.ts` held a `resolveProvinceName` naming it in
 * real SQL while importing `getAccPool` at the top of the same file. Moving that
 * function into `province-service.ts`, where every statement opens
 * `getProductionFormPool()`, is what let this arm be added — and adding it is
 * what stops it drifting back.
 */

for (const table of PRODUCTION_ONLY_TABLES) {
  test(`${table} is only ever reached through the production pool`, () => {
    const names = new RegExp(`\\b${table}\\b`);
    const offenders: string[] = [];
    let touched = 0;

    for (const file of sourceFiles(SRC)) {
      const code = codeOf(fs.readFileSync(file, "utf8"));
      if (!names.test(code)) continue;
      touched++;
      if (/getAccPool|getFormPool\b/.test(code)) offenders.push(path.relative(SRC, file));
    }

    // A guard on the guard: a refactor that renamed the table would leave this
    // passing by inspecting nothing at all.
    assert.ok(touched > 0, `no source file mentions ${table} — has it been renamed?`);

    assert.deepEqual(
      offenders,
      [],
      `these reach ${table} from a pool that resolves the UAT database, where it does not exist: ` +
        offenders.join(", "),
    );
  });
}
