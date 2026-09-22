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
 *
 * A third property joined them on 2026-09-22, when สิทธิ์เข้าถึง split per
 * form: **each hub asks its own form's question.** It is not a gate — showing a
 * card grants nothing and every destination re-decides server-side — but it is
 * read out of source for the same reason the gates are, and it belongs beside
 * them because it is the other half of "what may this viewer reach on AP-2 or
 * AP-3". See the block at the foot of this file.
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

/* ── each hub asks about its OWN form (2026-09-22) ────────────────────────
 *
 * `/api/request/advance/access` used to answer one union `canSettings` and both
 * hubs drew their ตั้งค่า card on it, so a grant of AP-2's `banks` put the card
 * on AP-3's hub — where that page has no tab the viewer may open and answers
 * ไม่มีสิทธิ์เข้าถึง. Splitting สิทธิ์เข้าถึง per form made that worse rather
 * than causing it: `brands` had been on both strips, so a `brands` holder
 * genuinely had a tab on both pages until it moved to AP-2 alone.
 *
 * Source-read because the failure is a hub reading the WRONG field, which type
 * checking cannot see — both are booleans on the same payload, and a hub that
 * reads a field the route stopped sending gets `undefined`, which `!!` turns
 * into a silently missing card for admins too.
 */
const HUBS = [
  ["src/app/(dashboard)/request/advance/admin/page.tsx", "canAdvanceSettings", "canClearSettings"],
  ["src/app/(dashboard)/request/clear-advance/admin/page.tsx", "canClearSettings", "canAdvanceSettings"],
] as const;

for (const [file, mine, theirs] of HUBS) {
  test(`${file} draws its settings card on ${mine}`, () => {
    const src = read(file);
    assert.ok(src.includes(mine), `${file} does not read ${mine}`);
    assert.ok(
      !src.includes(theirs),
      `${file} reads ${theirs} — that is the other form's answer`,
    );
    // The union field is gone from the payload, so a hub still naming it would
    // read `undefined` and hide the card from everybody, admins included.
    assert.ok(
      !/\bcanSettings\b\s*:\s*!!\s*d\?\.canSettings\b/.test(src),
      `${file} still reads the union canSettings the route no longer sends`,
    );
  });
}

test("the access route answers a settings flag per form and no union", () => {
  const src = read("src/app/api/request/advance/access/route.ts");
  for (const key of ["canAdvanceSettings", "canClearSettings"]) {
    assert.ok(src.includes(key + ":"), `the route no longer answers ${key}`);
  }
  assert.ok(
    !/\bcanSettings\s*:/.test(src),
    "the union canSettings is back — both hubs would share one answer again",
  );
  // Derived from each form's own strip, so a tab moving between the two pages
  // moves this with it rather than needing to be remembered here.
  assert.ok(
    src.includes("advClrTabsForForm("),
    "the per-form flag is not derived from the forms' tab strips",
  );
});

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
