import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Which gate each AP-2 / AP-3 settings route carries, read out of its source.
 *
 * Source-reading because the thing that must hold is a **missing call**, and no
 * behavioural test notices one: deleting a gate leaves every other test green,
 * which this repository has measured on AP-4's own queue route.
 *
 * Two properties, and the second is the one a reasonable edit breaks:
 *
 * 1. **The two routes that hand out power stay `requireRole`.**
 *    `settings/access` writes the grant table itself, and
 *    `settings/erp-interface` writes where money posts and is not brand-scoped.
 *    Neither key is in `GRANTABLE_ADV_CLR_TABS`, so no tick can open them —
 *    swapping either to `requireAdvClrSettingsTab` would be a route with a gate
 *    nobody can satisfy, or worse, one somebody can.
 * 2. **The gate is the handler's FIRST await, and its refusal is returned.**
 *    A gate that runs after the read has already happened is not a gate; one
 *    whose `Response` is computed and dropped is not either.
 */

const ROUTES = [
  // [file, expected gate, expected argument or null]
  ["src/app/api/request/advance/settings/tiers/route.ts", "requireAdvClrSettingsTab", "matrix"],
  ["src/app/api/request/advance/settings/banks/route.ts", "requireAdvClrSettingsTab", "banks"],
  ["src/app/api/request/advance/settings/brand-active/route.ts", "requireAdvClrSettingsTab", "brands"],
  ["src/app/api/request/clear-advance/settings/locations/route.ts", "requireAdvClrSettingsTab", "locations"],
  ["src/app/api/request/advance/settings/access/route.ts", "requireRole", null],
  ["src/app/api/request/advance/settings/erp-interface/route.ts", "requireRole", null],
  ["src/app/api/request/clear-advance/settings/erp-interface/route.ts", "requireRole", null],
  ["src/app/api/request/clear-advance/settings/approvers/route.ts", "requireRole", null],
] as const;

const read = (rel: string) =>
  fs
    .readFileSync(path.resolve(process.cwd(), rel), "utf8")
    // Comments stripped: these files NAME the gate they used to carry and the
    // ones they deliberately do not, so a search over raw text would pass on
    // prose alone.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

for (const [file, gate, arg] of ROUTES) {
  test(`${file} is gated by ${gate}${arg ? `("${arg}")` : ""}`, () => {
    const src = read(file);
    const handlers = src.match(/export async function (GET|POST|PATCH|PUT|DELETE)\b/g) ?? [];
    assert.ok(handlers.length > 0, "no route handlers found — has the file moved?");

    // `await <gate>(` rather than a bare mention: a comment naming the old gate
    // must not satisfy this, and neither must an import left behind.
    const calls = src.match(new RegExp(`await ${gate}\\(`, "g")) ?? [];
    assert.equal(
      calls.length,
      handlers.length,
      `${handlers.length} handler(s) but ${calls.length} call(s) to ${gate}`,
    );

    if (arg) {
      assert.ok(
        new RegExp(`await ${gate}\\("${arg}"\\)`).test(src),
        `${gate} is not called with "${arg}" — the wrong tab key gates this route`,
      );
      assert.ok(
        !/requireRole/.test(src),
        "requireRole is still referenced — two gates on one route drift apart",
      );
    }

    // Every handler must return the refusal rather than compute and drop it.
    const refusals = src.match(/if \(session instanceof Response\) return session;/g) ?? [];
    assert.equal(
      refusals.length,
      handlers.length,
      `${handlers.length} handler(s) but ${refusals.length} refusal return(s)`,
    );
  });
}

test("the gate is the first await in every handler it guards", () => {
  for (const [file, gate] of ROUTES) {
    const src = read(file);
    // Split on the handler openings and check each body's first `await`.
    const parts = src.split(/export async function (?:GET|POST|PATCH|PUT|DELETE)\b/).slice(1);
    for (const body of parts) {
      const firstAwait = body.indexOf("await ");
      assert.ok(firstAwait !== -1, `${file}: a handler with no await at all`);
      assert.ok(
        body.slice(firstAwait).startsWith(`await ${gate}(`),
        `${file}: a handler does something before its ${gate} call`,
      );
    }
  }
});
