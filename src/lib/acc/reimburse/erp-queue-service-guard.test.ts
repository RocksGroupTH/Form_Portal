import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * AP-4's Interface ERP queue defends against AP-1's and AP-3's claims — both
 * are parked at the identical `Status = 'Approved'` `AccRequest` rows AP-4
 * uses — in two layers, split across two files since a fix round moved the row
 * loop out of `erp-queue-service.ts` (see that file's own docblock for why:
 * it imports `getAccPool`, which reaches `@/env`, which throws at import
 * outside a configured machine, so nothing testable-with-a-plain-array can
 * live there).
 *
 * **This file covers what a SQL-text pin can honestly claim to cover, and no
 * more.** It reads `erp-queue-service.ts` for the WHERE clause and the `@form`
 * binding, and `erp-queue-policy.ts` for the row loop's shape — and it is
 * NOT sufficient on its own for either half:
 *
 * - The WHERE-clause tests can only prove `FormCode = @form` still appears
 *   and `@form` is still bound to `AP4_FORM_CODE`. A round of review found a
 *   WHERE clause widened to `(req.FormCode = @form AND req.Status =
 *   'Approved') OR req.CurrentStepCode = 'ACCOUNT'` that keeps both
 *   substrings intact while listing rows the original predicate would have
 *   refused — `queue-service.ts`'s own docblock records three earlier,
 *   differently-shaped versions of the same trick. A regex over SQL TEXT
 *   cannot verify SQL SEMANTICS; `belongsInErpQueue` re-deriving the
 *   predicate from the row (not from what the WHERE clause claims to select)
 *   is the actual defence against that class of edit.
 * - The row-loop tests can only prove a few specific shapes are still
 *   present — `x.FormCode` is read, `belongsInErpQueue` is called inside a
 *   guarding `if`. The SAME review round found that `belongsInErpQueue` can
 *   be handed a LIE and still pass every one of those shape checks: `const
 *   status = "Approved";` in place of `const status = (x.Status as string |
 *   null) ?? "";` satisfies "is Status read somewhere", satisfies "is
 *   belongsInErpQueue called and gated", and still makes the check
 *   tautological for every row the widened WHERE clause above now returns.
 *   **A regex cannot catch a correctly-shaped call fed a wrong value** — only
 *   a behavioural test that supplies a row and checks what comes back can,
 *   which is why `erp-queue-service.test.ts` exists and is the layer that
 *   actually closes this hole, not this file. The `status`-rebinding
 *   assertion below stays anyway, mirroring the `formCode` one, as a second,
 *   cheaper tripwire — belt, not suspenders.
 *
 * So: neither this file nor the behavioural test is sufficient alone. This
 * file catches an edit at commit time that a behavioural test would only
 * catch by someone remembering to add a new case for it; the behavioural test
 * catches an edit this file's regexes cannot even in principle recognise —
 * a call site that is shaped correctly but lies.
 */

const SERVICE_FILE = "lib/acc/reimburse/erp-queue-service.ts";
const POLICY_FILE = "lib/acc/reimburse/erp-queue-policy.ts";

/** Comments quoting the rule must not satisfy it — matches `queue-service-guard.test.ts`'s own `code()`. */
function code(relFile: string): string {
  return fs
    .readFileSync(path.resolve(process.cwd(), "src", relFile), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("the query still names FormCode = @form somewhere in its WHERE clause", () => {
  const src = code(SERVICE_FILE);
  assert.ok(
    /FormCode\s*=\s*@form\b/.test(src),
    "erp-queue-service.ts no longer names FormCode = @form anywhere — this is only the outer, " +
      "weaker check (see this file's own docblock); belongsInErpQueue (erp-queue-policy.ts) is what " +
      "actually refuses an AP-1/AP-3 row regardless of how this predicate is shaped, but a totally " +
      "absent predicate here is still worth catching fast",
  );
});

test("@form is bound to AP4_FORM_CODE — not a literal string, not another form's constant", () => {
  const src = code(SERVICE_FILE);
  assert.ok(
    /\.input\(\s*["']form["']\s*,\s*sql\.NVarChar\s*,\s*AP4_FORM_CODE\s*\)/.test(src),
    "the @form parameter is no longer bound to AP4_FORM_CODE — the WHERE clause's " +
      "FormCode = @form predicate is only as trustworthy as what @form actually holds",
  );
});

test("the row loop still selects FormCode and passes it to belongsInErpQueue", () => {
  const src = code(POLICY_FILE);
  assert.ok(
    /x\.FormCode\b/.test(src),
    "erp-queue-policy.ts's accumulateErpQueueRows no longer reads FormCode off the row — " +
      "belongsInErpQueue cannot re-derive the predicate from data the row check never received, and " +
      "silently falls back to whatever the SQL WHERE clause alone decided",
  );
});

/**
 * The blind spot a rebinding leaves. Selecting `x.FormCode` (the test above)
 * and calling `belongsInErpQueue` with a guarding `if` (the test below) are
 * both satisfied even if the value handed to that call never came from the
 * row at all — `const formCode = AP4_FORM_CODE;` in place of `const formCode
 * = (x.FormCode as string | null) ?? "";` passes both of those and makes the
 * runtime check circular, silently collapsing back to a bare status check
 * with a round of ceremony wrapped around it. `erp-queue-policy.test.ts`
 * tests `belongsInErpQueue` in isolation and cannot catch a rebinding in its
 * caller — this is the only SOURCE-SHAPE place that can (the behavioural
 * `erp-queue-service.test.ts` catches it too, by supplying an actual row).
 *
 * The loop variable's NAME is captured, not hardcoded, for the same reason
 * `queue-service-guard.test.ts` captures it: a guard that cries wolf on an
 * innocent rename (`x` → `row`) is a guard people delete.
 */
test("formCode is read off the recordset row, not reassigned from AP4_FORM_CODE or a literal", () => {
  const src = code(POLICY_FILE);
  const loop = /for\s*\(\s*const\s+(\w+)\s+of\s+recordset\b/.exec(src);
  assert.ok(
    loop,
    "erp-queue-policy.ts no longer loops `for (const <name> of recordset ...)` inside " +
      "accumulateErpQueueRows — the shape this assertion reads the row binding's name out of. If the " +
      "loop was replaced (a `.map`, a destructured binding), this test must be rewritten to capture " +
      "the new binding rather than deleted: it is the only source-shape guard on the circular-" +
      "rebinding bug",
  );
  const rowBinding = loop![1];
  assert.ok(
    new RegExp(`const\\s+formCode\\s*=\\s*\\(?\\s*${rowBinding}\\.FormCode\\b`).test(src),
    `accumulateErpQueueRows's \`const formCode = ...\` no longer reads ${rowBinding}.FormCode off the ` +
      `row (\`${rowBinding}\` being the recordset binding this test read out of the loop itself). If ` +
      "it now reads `AP4_FORM_CODE` or a string literal instead, belongsInErpQueue is being handed " +
      "the very constant it exists to check the row against — the runtime check becomes circular and " +
      "passes for every row the SQL happened to select, silently collapsing back to a bare status " +
      "check with a round of ceremony wrapped around it",
  );
});

/**
 * `status`'s mirror of the test above, added after a review round found
 * exactly this rebinding shipped past the original four assertions: `const
 * status = "Approved";` in place of `const status = (x.Status as string |
 * null) ?? "";`. On THIS query `status` carries the same load `formCode`
 * carries on the accounting queue (`queue-service.ts`), because every row is
 * already the same form by the time this predicate runs — there is no third
 * value standing behind it the way `FormCode` stands behind `Status` there.
 * A regex is a weaker defence here than the behavioural test in
 * `erp-queue-service.test.ts` (see this file's own header for why), but it is
 * a cheaper one to trip, so it stays.
 */
test("status is read off the recordset row, not reassigned from a literal", () => {
  const src = code(POLICY_FILE);
  const loop = /for\s*\(\s*const\s+(\w+)\s+of\s+recordset\b/.exec(src);
  assert.ok(loop, "see the formCode test above — same loop, same failure mode if this goes missing");
  const rowBinding = loop![1];
  assert.ok(
    new RegExp(`const\\s+status\\s*=\\s*\\(?\\s*${rowBinding}\\.Status\\b`).test(src),
    `accumulateErpQueueRows's \`const status = ...\` no longer reads ${rowBinding}.Status off the row ` +
      `(\`${rowBinding}\` being the recordset binding this test read out of the loop itself). If it ` +
      'now reads a literal like "Approved" instead, belongsInErpQueue is being handed a value that ' +
      "cannot ever disagree with the SQL's own Status = 'Approved' predicate, which makes the check " +
      "tautological for every row a widened WHERE clause returns — exactly the hole a review round " +
      "found here once already",
  );
});

test("belongsInErpQueue still GATES the row, rather than being called and ignored", () => {
  const src = code(POLICY_FILE);
  assert.ok(
    /if\s*\(\s*!\s*belongsInErpQueue\s*\(/.test(src),
    "accumulateErpQueueRows no longer guards on belongsInErpQueue's answer — a bare call such as " +
      "`belongsInErpQueue(formCode, status);` with no `if (!…) continue;` around it still names the " +
      "function, computes an answer, and then throws it away, pushing every row unconditionally. This " +
      "is the one assertion in this file that a mutation cannot survive by rearranging the SQL text " +
      "alone",
  );
});

test("the return statement is the query call's very next statement — nothing is interposed", () => {
  const src = code(SERVICE_FILE);
  // Found by the re-review of this file's own fix round, after the two
  // rebinding holes above had been closed. Once `accumulateErpQueueRows` reads
  // `FormCode` and `Status` off the row it is handed, the last place left to
  // tell it a lie is the hand-off itself — and the ORIGINAL version of this
  // assertion (an UNANCHORED `return accumulateErpQueueRows(res.recordset as
  // Record<string, unknown>[])` pin, searched for anywhere in the file) missed
  // a shape its own reasoning had not considered: mutation IN PLACE, which
  // needs no `.map`, no `.filter`, no helper, and builds no new array —
  //
  //   for (const r of res.recordset) { r.FormCode = AP4_FORM_CODE; r.Status = "Approved"; }
  //   return accumulateErpQueueRows(res.recordset as Record<string, unknown>[]);
  //
  // — leaves `res.recordset as Record<string, unknown>[]` sitting inside the
  // call, verbatim, exactly as the old regex demanded, because the OBJECTS
  // the array holds were rewritten rather than the array itself. Measured:
  // 1332 tests green and `tsc --noEmit` clean, while the queue lists AP-4
  // claims still parked at `(ManagerApproved, ACCOUNT)` — claims that never
  // cleared ACCOUNT_FINAL — under a header saying they are approved and
  // waiting to post.
  //
  // The fix is not a stronger verbatim pin — no string pin can rule out
  // mutating the objects a variable already points at. It is anchoring WHERE
  // the verbatim text is allowed to appear: immediately (whitespace only)
  // after the query call's own closing `` `); ``, with nothing else between
  // them. An interposed `for` loop, a `.map` assigned to a local first, or a
  // helper call needs a STATEMENT to sit in that gap, and a statement there
  // breaks the match regardless of what it does to the rows.
  //
  // **What this still does NOT prove — say so rather than overclaim it.** A
  // mutation written inside the query call's own argument list, or a Proxy
  // substituted for `res.recordset` upstream of this statement, would still
  // satisfy adjacency. This is a statement-adjacency pin, not a proof that
  // the recordset is unmodified — the behavioural tests in
  // `erp-queue-service.test.ts` are what actually exercise the values
  // `accumulateErpQueueRows` receives; this is what catches an edit at commit
  // time before that test even has to.
  assert.ok(
    /`\)\s*;\s*return\s+accumulateErpQueueRows\(\s*res\.recordset\s+as\s+Record<string,\s*unknown>\[\]\s*,?\s*\)\s*;/.test(
      src,
    ),
    "erp-queue-service.ts no longer hands accumulateErpQueueRows the query's own recordset as the " +
      "very next statement after the query call. Anything interposed there — a mutation loop " +
      "rewriting each row in place, a .map spreading a FormCode or Status over each row into a new " +
      "array, a filter, a helper that rebuilds the array — feeds the row-level gate values the " +
      "database never returned, and every other test in this file and in erp-queue-service.test.ts " +
      "stays green while the queue lists claims that never cleared ACCOUNT_FINAL. If the query " +
      "genuinely needs another statement between it and the return, move the transformation INSIDE " +
      "accumulateErpQueueRows, where the behavioural tests can see it",
  );
});

test("erp-queue-service.ts calls accumulateErpQueueRows exactly once — no decoy satisfies the pin above", () => {
  const src = code(SERVICE_FILE);
  // Round five. The adjacency assertion above runs its regex against the WHOLE
  // file, so it only ever required the anchored shape to appear SOMEWHERE — not
  // inside the function that actually runs. A never-called helper carrying a
  // template literal that ends in ```);`` and a matching
  // `return accumulateErpQueueRows(res.recordset as Record<string, unknown>[]);`
  // satisfies it on its own, freeing the real function to interpose whatever it
  // likes. Measured on both queues: every guard green, the full suite green,
  // `tsc --noEmit` clean, every row rewritten before the gate saw it.
  //
  // This closes it without parsing TypeScript. If the file calls
  // accumulateErpQueueRows exactly once, and that one call is
  // adjacent to a query's closing ```);``, then the call the real function
  // makes IS the adjacent one — a decoy needs a second occurrence to exist at
  // all, and this assertion is what that second occurrence trips. The two
  // assertions are only sound TOGETHER: adjacency alone permits a decoy, and
  // exactly-once alone permits an interposed statement.
  const calls = src.split("accumulateErpQueueRows(").length - 1;
  assert.equal(
    calls,
    1,
    `erp-queue-service.ts names accumulateErpQueueRows(${""} ${calls} time(s), not once. ` +
      "The assertion above anchors the call to the query's closing backtick-paren, but it searches " +
      "the whole file — so a second occurrence anywhere, including in a helper nothing calls, can " +
      "satisfy that anchor while the real function interposes a mutation loop between its query and " +
      "its return. Every other test here and in erp-queue-service.test.ts stays green while the " +
      "queue lists claims that never cleared ACCOUNT_FINAL. If this file genuinely needs to " +
      "call the accumulator twice, the anchored assertion above must be rewritten to match inside " +
      "the exported function's own body rather than anywhere in the source",
  );
});
