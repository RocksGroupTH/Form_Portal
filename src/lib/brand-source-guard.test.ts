import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **Which list answers "is this a real brand?" — the master, never the four
 * hardcoded in `@/lib/brand`.**
 *
 * `BRANDS` was the registry once. Since `BrandSetting` shipped it is not, and
 * `brand.ts`'s own docblock says so in as many words: *"This is no longer the
 * list of brands … Adding a brand here does not put it in the picker, and a
 * brand in the picker need not be here."* The registry is
 * `listBrandRegistry()` — `Rocks_Codex.dbo.Brand` joined with `BrandSetting` —
 * and `/api/brands` is what every picker reads.
 *
 * **One route was left behind and it cost a whole afternoon's confusion**
 * (measured 2026-09-23). Settings → Brand Configuration lists the master's
 * brands, opens a dialog for any of them, and its Save is
 * `PATCH /api/settings/brand-config/[brandCode]` — which validated against
 * `BRANDS` and answered a bare **"Invalid brand"**. The master holds **seven**
 * active brands (ROCKS, PCTH, PCMY, KSI, UNO, PLM, SMR) and the literal names
 * four, so three of them could be filled in on screen and never saved, with a
 * message that reads as *your brand is not real* rather than *this app has two
 * lists and you have found the older one*. Its three sibling routes —
 * `enabled`, and the logo POST and DELETE — had already been moved across, so
 * a reader comparing them would have seen the inconsistency and a reader
 * looking at one would not.
 *
 * ## Why a source-reading guard rather than a behavioural test
 *
 * The four routes reach a database through `listBrandRegistry`, so nothing
 * here can call them: `@/env` validates the whole environment at import, which
 * is the same reason `currency-pool-guard.test.ts` reads sources beside this
 * one. And the failure is a *missing* call — no type notices a route
 * validating against a list, and the suite stayed green through the whole
 * period the bug existed.
 *
 * ## What this does NOT say
 *
 * It says nothing about `erp-interface-brands.ts`, which is the literal's one
 * remaining importer and is deliberately exempt. That module means "brands
 * with a complete BC profile", which is a different question that only looks
 * like this one because the answer has so far been the same four — see
 * `brand.ts`'s docblock for why wiring it to the brand switch would make a
 * brand an ERP posting target with no BC configuration behind it.
 *
 * ## Mutation-tested 2026-09-23, and one of the arms was born broken
 *
 * - the fixed route reverted to the hardcoded list → **red**, 2 arms.
 * - a sibling route's `await listBrandRegistry()` deleted while its import
 *   stays → **GREEN at first.** The arm read `/listBrandRegistry/`, which the
 *   surviving import satisfies, and an unused import is a lint warning at
 *   most — so nothing anywhere would have noticed. It now tests for
 *   `await listBrandRegistry(` and reds. This is the third time this
 *   repository has written down that a guard must pin the CALL; it is worth
 *   assuming the first spelling of any new arm has this shape until a
 *   mutation says otherwise.
 * - a third importer of `BRANDS` added → **red** (the exact-list arm).
 *
 * If this goes red, move the route onto the registry. Do not add the brand to
 * `BRANDS`: that list is read by `erp-interface-brands` and an entry there is
 * a claim about Business Central, not about whether a brand exists.
 */

const SRC = path.resolve(process.cwd(), "src");

function code(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), "utf8");
}

/**
 * Every route under `/api/settings/brand-config` that decides whether a brand
 * code is real, plus the public logo route that does the same.
 *
 * Listed by hand rather than globbed, so a new route is a deliberate addition
 * here — the arm below catches one that validates the wrong way, but only for
 * files somebody has named.
 */
const BRAND_CODE_ROUTES = [
  "app/api/settings/brand-config/[brandCode]/route.ts",
  "app/api/settings/brand-config/[brandCode]/enabled/route.ts",
  "app/api/settings/brand-config/[brandCode]/logo/route.ts",
  "app/api/brand-logo/[code]/route.ts",
];

test("no route validates a brand code against the hardcoded BRANDS list", () => {
  for (const rel of BRAND_CODE_ROUTES) {
    const src = code(rel);
    assert.ok(
      !/from\s+["']@\/lib\/brand["']/.test(src),
      `${rel} imports @/lib/brand. That module's BRANDS is four hardcoded codes, not the brand ` +
        "master — a brand the master has and the literal does not is offered by every picker " +
        "and then refused here with a bare \"Invalid brand\"",
    );
  }
});

test("the three settings routes resolve brands from the registry", () => {
  // The public logo route is deliberately not here: it serves an uploaded
  // image by code and refuses only an EMPTY one, because a code the master
  // does not have simply has no logo row and 404s of its own accord. Asserting
  // a registry read there would pin a database round trip onto a path that
  // renders a picture on every page showing a brand.
  for (const rel of BRAND_CODE_ROUTES.slice(0, 3)) {
    const src = code(rel);
    /* **The CALL, not the mention.** `/listBrandRegistry/` was the first
       spelling and it was measured GREEN against deleting the call and
       leaving the import — the exact hole `settings-route-gates.test.ts`
       already records ("it searches for `await <gate>(` rather than a bare
       mention, because a route's comments name the gate it used to carry").
       An unused import is a lint warning at most, so nothing else would have
       noticed. */
    assert.ok(
      src.indexOf("await listBrandRegistry(") !== -1,
      `${rel} no longer CALLS listBrandRegistry(), so it is deciding what a brand is from ` +
        "somewhere other than the company master — an import that survives a deleted call is " +
        "not evidence of anything",
    );
  }
});

test("BRANDS has exactly two importers left, and neither asks what a brand is", () => {
  /* The literal survives for exactly the two things `brand.ts`'s own
     docblock names: `erp-interface-brands.ts` — "brands with a complete BC
     profile" — and `brand-config.ts`'s `LEGACY_DASHBOARD_BRANDS`, which
     feeds `getBrandDashboardReadiness`, dead code kept for the Rocks Fast
     sibling.

     **That docblock says the second one manages "without importing the
     list", and it is wrong**: measured 2026-09-23, `brand-config.ts`
     imports `BRANDS` on line 2. Pinned here as TWO rather than corrected
     down to one, because the dead-code importer is real and removing it is
     a separate decision about what the sibling still needs.

     A THIRD importer means the old list is answering a question again, and
     the whole point of this file is that nothing else notices when it
     does. */
  const files: string[] = [];
  (function walk(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) files.push(p);
    }
  })(SRC);

  const importers = files.filter((p) => {
    if (p.endsWith(path.join("lib", "brand.ts"))) return false;
    const src = fs.readFileSync(p, "utf8");
    return /import\s*\{[^}]*\bBRANDS\b[^}]*\}\s*from\s*["']@\/lib\/brand["']/.test(src);
  });

  const rels = importers
    .map((p) => path.relative(SRC, p).split(path.sep).join("/"))
    .sort();
  assert.deepEqual(
    rels,
    ["lib/acc/erp-interface-brands.ts", "lib/brand-config.ts"],
    "BRANDS is imported somewhere new. If the new importer is asking whether a brand EXISTS, " +
      "it must read listBrandRegistry() instead; if it is asking whether a brand has a Business " +
      "Central profile, say so where it is written and add it here",
  );
});
