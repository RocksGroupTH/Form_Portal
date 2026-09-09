import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * `erp-queue-service.ts` defends AP-4's Interface ERP queue against AP-1's and
 * AP-3's claims — both are parked at the identical `Status = 'Approved'`
 * `AccRequest` rows AP-4 uses, AP-3's own `clear-advance-erp-queue-service.ts`
 * confirms it uses that predicate for its own form — in the same two layers
 * `queue-service-guard.test.ts` documents for the accounting-approval queue,
 * and this file is the same shape for the same reason: read that file's own
 * docblock for the three SQL rearrangements that defeated an earlier, weaker
 * version of this idea (an AND loosened to an OR, a re-parenthesisation, a
 * policy call stripped of its guarding `if`) before touching either.
 *
 * **This file is the outer, WEAKER layer.** It is a regex over SQL text and
 * over a few lines of plain TypeScript shape — it cannot verify what a SQL
 * predicate evaluates to, only that a few specific, easily-checked substrings
 * are still present. `belongsInErpQueue` (`./erp-queue-policy.ts`), exercised
 * in isolation by `erp-queue-policy.test.ts`, is the INNER, REAL layer: since
 * it takes `formCode` and `status` back out of the query's own result set, no
 * rearrangement of the WHERE clause below can satisfy it without the WHERE
 * clause also being correct.
 *
 * Four things are pinned, each drilled by hand while writing this file —
 * removed, the matching test confirmed red, then reverted:
 *
 * 1. the WHERE clause still names `FormCode = @form` somewhere;
 * 2. `@form` is bound to `AP4_FORM_CODE`, not a literal or another form's
 *    constant;
 * 3. `formCode` inside the row loop is read off the recordset row itself
 *    (`x.FormCode`), not reassigned from `AP4_FORM_CODE` or a string literal —
 *    the same circular-rebinding hazard `queue-service-guard.test.ts` names,
 *    which only this file can catch, since `erp-queue-policy.test.ts` tests
 *    `belongsInErpQueue` in isolation and has no way to know what value this
 *    file actually passes it;
 * 4. `belongsInErpQueue` still GATES the row (`if (!belongsInErpQueue(...))
 *    continue;`) rather than being called and its answer discarded.
 */

const FILE = "lib/acc/reimburse/erp-queue-service.ts";

/** Comments quoting the rule must not satisfy it — matches `queue-service-guard.test.ts`'s own `code()`. */
function code(): string {
  return fs
    .readFileSync(path.resolve(process.cwd(), "src", FILE), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("the query still names FormCode = @form somewhere in its WHERE clause", () => {
  const src = code();
  assert.ok(
    /FormCode\s*=\s*@form\b/.test(src),
    "erp-queue-service.ts no longer names FormCode = @form anywhere — this is only the outer, " +
      "weaker check (see this file's own docblock); belongsInErpQueue (erp-queue-policy.ts) is what " +
      "actually refuses an AP-1/AP-3 row regardless of how this predicate is shaped, but a totally " +
      "absent predicate here is still worth catching fast",
  );
});

test("@form is bound to AP4_FORM_CODE — not a literal string, not another form's constant", () => {
  const src = code();
  assert.ok(
    /\.input\(\s*["']form["']\s*,\s*sql\.NVarChar\s*,\s*AP4_FORM_CODE\s*\)/.test(src),
    "the @form parameter is no longer bound to AP4_FORM_CODE — the WHERE clause's " +
      "FormCode = @form predicate is only as trustworthy as what @form actually holds",
  );
});

test("the row loop still selects FormCode and passes it to belongsInErpQueue", () => {
  const src = code();
  assert.ok(
    /x\.FormCode\b/.test(src),
    "erp-queue-service.ts no longer reads FormCode off the row — belongsInErpQueue cannot re-derive " +
      "the predicate from data the row check never received, and silently falls back to whatever the " +
      "SQL WHERE clause alone decided",
  );
});

/**
 * The blind spot round 3 of `queue-service.ts`'s own review left, and the one
 * this file exists specifically to close for AP-4's ERP queue too. Selecting
 * `x.FormCode` (the test above) and calling `belongsInErpQueue` with a
 * guarding `if` (the test below) are both satisfied even if the value handed
 * to that call never came from the row at all — `const formCode =
 * AP4_FORM_CODE;` in place of `const formCode = (x.FormCode as string | null)
 * ?? "";` passes both of those and makes the runtime check circular, silently
 * collapsing back to a bare `Status === "Approved"` predicate with a layer of
 * ceremony wrapped around it. `erp-queue-policy.test.ts` tests
 * `belongsInErpQueue` in isolation and cannot catch a rebinding in its
 * caller — this is the only place that can.
 *
 * The loop variable's NAME is captured, not hardcoded, for the same reason
 * `queue-service-guard.test.ts` captures it: a guard that cries wolf on an
 * innocent rename (`x` → `row`) is a guard people delete.
 */
test("formCode is read off the recordset row, not reassigned from AP4_FORM_CODE or a literal", () => {
  const src = code();
  const loop = /for\s*\(\s*const\s+(\w+)\s+of\s+res\.recordset\b/.exec(src);
  assert.ok(
    loop,
    "erp-queue-service.ts no longer loops `for (const <name> of res.recordset ...)` — the shape this " +
      "assertion reads the row binding's name out of. If the loop was replaced (a `.map`, a " +
      "destructured binding), this test must be rewritten to capture the new binding rather than " +
      "deleted: it is the only guard on the circular-rebinding bug",
  );
  const rowBinding = loop![1];
  assert.ok(
    new RegExp(`const\\s+formCode\\s*=\\s*\\(?\\s*${rowBinding}\\.FormCode\\b`).test(src),
    `erp-queue-service.ts's \`const formCode = ...\` no longer reads ${rowBinding}.FormCode off the ` +
      `row (\`${rowBinding}\` being the recordset binding this test read out of the loop itself). If ` +
      "it now reads `AP4_FORM_CODE` or a string literal instead, belongsInErpQueue is being handed " +
      "the very constant it exists to check the row against — the runtime check becomes circular and " +
      "passes for every row the SQL happened to select, silently collapsing back to a bare status " +
      "check with a round of ceremony wrapped around it. erp-queue-policy.test.ts cannot catch this: " +
      "it tests belongsInErpQueue in isolation and has no way to know what value this file actually " +
      "passes it",
  );
});

test("belongsInErpQueue still GATES the row, rather than being called and ignored", () => {
  const src = code();
  assert.ok(
    /if\s*\(\s*!\s*belongsInErpQueue\s*\(/.test(src),
    "erp-queue-service.ts no longer guards on belongsInErpQueue's answer — a bare call such as " +
      "`belongsInErpQueue(formCode, status);` with no `if (!…) continue;` around it still names the " +
      "function, computes an answer, and then throws it away, pushing every row unconditionally. This " +
      "is the one assertion in this file that a mutation cannot survive by rearranging the SQL text " +
      "alone",
  );
});
