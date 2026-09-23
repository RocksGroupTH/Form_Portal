import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **The ERP interface brand list is a question, not a literal — and its
 * predicate must always be awaited.**
 *
 * On 2026-09-23 `ERP_INTERFACE_BRANDS` (`BRANDS.filter(b => b.enabled)`, the
 * four hardcoded in `@/lib/brand`) became `listErpInterfaceBrands()`, derived
 * from which brands carry a complete Business Central profile. Thirty-four
 * files consumed the constant, including AP-1's, AP-4's and AP-17's approver
 * brand scopes, the journal builder and three ERP syncs.
 *
 * ## The hazard this file exists for, which no type catches
 *
 * `isErpInterfaceBrandCode(code)` was synchronous, and three call sites used
 * its result as a bare boolean:
 *
 * ```
 * .filter((c) => isErpInterfaceBrandCode(c))       // approvers/route.ts
 * if (isErpInterfaceBrandCode(c)) set.add(c);       // approver-interface-access.ts
 * if (isErpInterfaceBrandCode(code)) return;        // brand-journal-batch-service.ts
 * ```
 *
 * **A promise is always truthy.** Had the function been made async in place,
 * all three would have compiled, passed every test, and silently admitted
 * every code — on the rows that scope an AP-1 approver, and on the guard
 * deciding whether a journal batch's brand is checked at all. `Array.filter`
 * takes a predicate returning `unknown`; an `if` takes anything.
 *
 * It was renamed to `isErpInterfaceBrand` for exactly that reason: renaming
 * turned all nine call sites into compile errors, which is the only thing that
 * made the conversion safe to do at once. **The rename is therefore load
 * bearing, and so is the awaiting**, and neither is visible to the
 * typechecker once the name is in place.
 *
 * ## What each arm would catch
 *
 * - a synchronous shim reintroduced beside the async function, under either
 *   name — which silently restores the old hazard for every future caller;
 * - a call to `isErpInterfaceBrand(` that is not awaited — the same bug with
 *   the new name on it;
 * - the literal `ERP_INTERFACE_BRANDS` coming back anywhere.
 *
 * If this goes red, fix the call. Do not add a synchronous variant: there is
 * no correct one, because the answer lives in `BrandConfig`.
 */

const SRC = path.resolve(process.cwd(), "src");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

const FILES = sourceFiles(SRC).map((p) => ({
  rel: path.relative(SRC, p).split(path.sep).join("/"),
  src: fs.readFileSync(p, "utf8"),
}));

/** Comments quote the old code on purpose, so every arm reads code only. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

test("the old synchronous predicate is gone and stays gone", () => {
  for (const { rel, src } of FILES) {
    if (rel === "lib/acc/erp-interface-brand-source-guard.test.ts") continue;
    const code = stripComments(src);
    assert.ok(
      code.indexOf("isErpInterfaceBrandCode") === -1,
      `${rel} names isErpInterfaceBrandCode. That was the SYNCHRONOUS predicate, and three of ` +
        "its call sites used the result as a bare boolean — a promise is always truthy, so a " +
        "shim under this name silently admits every code on paths that scope an approver",
    );
  }
});

test("the literal brand list does not come back", () => {
  for (const { rel, src } of FILES) {
    if (rel === "lib/acc/erp-interface-brand-source-guard.test.ts") continue;
    const code = stripComments(src);
    assert.ok(
      code.indexOf("ERP_INTERFACE_BRANDS") === -1,
      `${rel} names ERP_INTERFACE_BRANDS. Which brands can be interfaced into is answered by ` +
        "listErpInterfaceBrands() — a constant here is four codes that were only ever right by " +
        "coincidence, and stopped being right the day somebody configured a fifth",
    );
  }
});

test("every call of isErpInterfaceBrand is awaited", () => {
  /* The whole point of the rename. `if (isErpInterfaceBrand(x))` compiles,
     is always true, and is exactly the bug the old name carried. Matching on
     the character before the call rather than parsing: a call is preceded by
     `await `, or it is the import, or it is the declaration. */
  for (const { rel, src } of FILES) {
    if (rel === "lib/acc/erp-interface-brand-source-guard.test.ts") continue;
    if (rel === "lib/acc/erp-interface-brands.ts") continue; // its own declaration
    const code = stripComments(src);
    let at = code.indexOf("isErpInterfaceBrand(");
    while (at !== -1) {
      const before = code.slice(Math.max(0, at - 7), at);
      assert.ok(
        before.endsWith("await "),
        `${rel} calls isErpInterfaceBrand( without awaiting it. It returns a promise, which is ` +
          "always truthy, so the check passes for every code — and it is used to decide whether " +
          "a posted Company code may be written, on paths that move money",
      );
      at = code.indexOf("isErpInterfaceBrand(", at + 1);
    }
  }
});
