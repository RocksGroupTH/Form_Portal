import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * AP-4's accounting queue defends against AP-1's claims — both parked at the
 * identical `(ManagerApproved, ACCOUNT)` tuple `AccRequest` rows AP-4's own
 * engine uses — in two layers, split across two files since a fix round moved
 * the row loop out of `queue-service.ts` (see that file's own docblock for
 * why: it imports `getAccPool`, which reaches `@/env`, which throws at import
 * outside a configured machine, so nothing testable-with-a-plain-array can
 * live there).
 *
 * **This file covers what a SQL-text pin can honestly claim to cover, and no
 * more.** It reads `queue-service.ts` for the WHERE clause and the `@form`
 * binding, and `queue-policy.ts` for the row loop's shape — and it is NOT
 * sufficient on its own for either half:
 *
 * - The WHERE-clause tests can only prove `FormCode = @form` still appears
 *   and `@form` is still bound to `AP4_FORM_CODE`. Three review rounds each
 *   found a WHERE clause rewrite that kept every pinned substring intact
 *   while quietly widening what the query actually selected: an AND
 *   loosened to an OR, a `belongsInAccountQueue(...)` call stripped of its
 *   guarding `if`, and a re-parenthesisation —
 *   `WHERE (r.FormCode = @form AND r.Status = @status) OR r.CurrentStepCode = @step`
 *   — that leaves `FormCode = @form AND` sitting there as text while the
 *   query means "AP-4 at the right status, OR *anything* at
 *   `CurrentStepCode = 'ACCOUNT'`". A regex over SQL TEXT cannot verify SQL
 *   SEMANTICS; `belongsInAccountQueue` re-deriving the predicate from the row
 *   (not from what the WHERE clause claims to select) is the actual defence
 *   against that class of edit — see its own docblock in `queue-policy.ts`.
 * - The row-loop tests can only prove a few specific shapes are still
 *   present — `x.FormCode` is read, `belongsInAccountQueue` is called inside
 *   a guarding `if`. A later review round found that `belongsInAccountQueue`
 *   can be handed a LIE and still pass every one of those shape checks:
 *   `const status = "ManagerApproved";` and `const stepCode = "ACCOUNT";` in
 *   place of reading `x.Status` / `x.CurrentStepCode` off the row satisfies
 *   "is FormCode read somewhere", satisfies "is belongsInAccountQueue called
 *   and gated", and still makes the check tautological for every row a
 *   widened WHERE clause returns. **A regex cannot catch a correctly-shaped
 *   call fed a wrong value** — only a behavioural test that supplies a row
 *   and checks what comes back can, which is why `queue-service.test.ts`
 *   exists and is the layer that actually closes this hole, not this file.
 *   The `formCode`/`status`/`stepCode`-rebinding assertions below stay
 *   anyway, as a second, cheaper tripwire — belt, not suspenders.
 *
 * So: neither this file nor the behavioural test is sufficient alone. This
 * file catches an edit at commit time that a behavioural test would only
 * catch by someone remembering to add a new case for it; the behavioural test
 * catches an edit this file's regexes cannot even in principle recognise —
 * a call site that is shaped correctly but lies.
 */

const SERVICE_FILE = "lib/acc/reimburse/queue-service.ts";
const POLICY_FILE = "lib/acc/reimburse/queue-policy.ts";

/** Comments quoting the rule must not satisfy it — matches `erp-queue-service-guard.test.ts`'s own `code()`. */
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
    "queue-service.ts no longer names FormCode = @form anywhere — this is only the outer, weaker " +
      "check (see this file's own docblock); belongsInAccountQueue (queue-policy.ts) is what " +
      "actually refuses an AP-1 row regardless of how this predicate is shaped, but a totally " +
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

test("the row loop still selects FormCode and passes it to belongsInAccountQueue", () => {
  const src = code(POLICY_FILE);
  assert.ok(
    /x\.FormCode\b/.test(src),
    "queue-policy.ts's accumulateAccountQueueRows no longer reads FormCode off the row — " +
      "belongsInAccountQueue cannot re-derive the predicate from data the row check never received, " +
      "and silently falls back to whatever the SQL WHERE clause alone decided",
  );
});

/**
 * The blind spot a rebinding leaves. Selecting `x.FormCode` (the test above)
 * and calling `belongsInAccountQueue` with a guarding `if` (the test below)
 * are both satisfied even if the value handed to that call never came from
 * the row at all — `const formCode = AP4_FORM_CODE;` in place of `const
 * formCode = (x.FormCode as string | null) ?? "";` passes both of those and
 * makes the runtime check circular, silently collapsing back to a bare
 * status/step check with a round of ceremony wrapped around it.
 * `queue-policy.test.ts` tests `belongsInAccountQueue` in isolation and
 * cannot catch a rebinding in its caller — this is the only SOURCE-SHAPE
 * place that can (the behavioural `queue-service.test.ts` catches it too, by
 * supplying an actual row).
 *
 * The loop variable's NAME is captured, not hardcoded, for the same reason
 * `erp-queue-service-guard.test.ts` captures it: a guard that cries wolf on
 * an innocent rename (`x` → `row`) is a guard people delete.
 */
test("formCode is read off the recordset row, not reassigned from AP4_FORM_CODE or a literal", () => {
  const src = code(POLICY_FILE);
  const loop = /for\s*\(\s*const\s+(\w+)\s+of\s+recordset\b/.exec(src);
  assert.ok(
    loop,
    "queue-policy.ts no longer loops `for (const <name> of recordset ...)` inside " +
      "accumulateAccountQueueRows — the shape this assertion reads the row binding's name out of. If " +
      "the loop was replaced (a `.map`, a destructured binding), this test must be rewritten to " +
      "capture the new binding rather than deleted: it is the only source-shape guard on the " +
      "circular-rebinding bug",
  );
  const rowBinding = loop![1];
  assert.ok(
    new RegExp(`const\\s+formCode\\s*=\\s*\\(?\\s*${rowBinding}\\.FormCode\\b`).test(src),
    `accumulateAccountQueueRows's \`const formCode = ...\` no longer reads ${rowBinding}.FormCode off ` +
      `the row (\`${rowBinding}\` being the recordset binding this test read out of the loop itself). ` +
      "If it now reads `AP4_FORM_CODE` or a string literal instead, belongsInAccountQueue is being " +
      "handed the very constant it exists to check the row against — the runtime check becomes " +
      "circular and passes for every row the SQL happened to select, silently collapsing back to a " +
      "bare status/step check with a round of ceremony wrapped around it",
  );
});

/**
 * `status`'s mirror of the test above. A review round found exactly this
 * rebinding was NOT guarded here even though `formCode`'s was: `const status
 * = "ManagerApproved";` in place of `const status = (x.Status as string |
 * null) ?? "";`. Both `status` and `stepCode` carry the same load `formCode`
 * carries — `belongsInAccountQueue` is a three-argument predicate on the
 * TUPLE, and a rebinding of any one argument to a literal makes the whole
 * check tautological for whatever the WHERE clause happened to select.
 */
test("status is read off the recordset row, not reassigned from a literal", () => {
  const src = code(POLICY_FILE);
  const loop = /for\s*\(\s*const\s+(\w+)\s+of\s+recordset\b/.exec(src);
  assert.ok(loop, "see the formCode test above — same loop, same failure mode if this goes missing");
  const rowBinding = loop![1];
  assert.ok(
    new RegExp(`const\\s+status\\s*=\\s*\\(?\\s*${rowBinding}\\.Status\\b`).test(src),
    `accumulateAccountQueueRows's \`const status = ...\` no longer reads ${rowBinding}.Status off the ` +
      `row (\`${rowBinding}\` being the recordset binding this test read out of the loop itself). If ` +
      'it now reads a literal like "ManagerApproved" instead, belongsInAccountQueue is being handed a ' +
      "value that cannot ever disagree with the SQL's own Status = @status predicate, which makes the " +
      "check tautological for every row a widened WHERE clause returns",
  );
});

/**
 * `stepCode`'s mirror of the same test. `ACCOUNT` and `ACCOUNT_FINAL` sit at
 * the identical `Status='ManagerApproved'`, so `stepCode` is the ONLY thing
 * that tells the two queues apart — a rebinding here is at least as costly as
 * `status`'s: `const stepCode = "ACCOUNT";` would let an ACCOUNT_FINAL claim
 * (or an AP-1 claim genuinely sitting at `CurrentStepCode = 'ACCOUNT'`) pass
 * unconditionally.
 */
test("stepCode is read off the recordset row, not reassigned from a literal", () => {
  const src = code(POLICY_FILE);
  const loop = /for\s*\(\s*const\s+(\w+)\s+of\s+recordset\b/.exec(src);
  assert.ok(loop, "see the formCode test above — same loop, same failure mode if this goes missing");
  const rowBinding = loop![1];
  assert.ok(
    new RegExp(`const\\s+stepCode\\s*=\\s*\\(?\\s*${rowBinding}\\.CurrentStepCode\\b`).test(src),
    `accumulateAccountQueueRows's \`const stepCode = ...\` no longer reads ${rowBinding}.CurrentStepCode ` +
      `off the row (\`${rowBinding}\` being the recordset binding this test read out of the loop ` +
      'itself). If it now reads a literal like "ACCOUNT" instead, belongsInAccountQueue is being ' +
      "handed a value that cannot ever disagree with the SQL's own CurrentStepCode = @step predicate — " +
      "the one thing that tells the ACCOUNT queue apart from ACCOUNT_FINAL at the identical status",
  );
});

test("belongsInAccountQueue still GATES the row, rather than being called and ignored", () => {
  const src = code(POLICY_FILE);
  assert.ok(
    /if\s*\(\s*!\s*belongsInAccountQueue\s*\(/.test(src),
    "accumulateAccountQueueRows no longer guards on belongsInAccountQueue's answer — a bare call such " +
      "as `belongsInAccountQueue(formCode, status, stepCode);` with no `if (!…) continue;` around it " +
      "still names the function, computes an answer, and then throws it away, pushing every row " +
      "unconditionally. This is the one assertion in this file that a mutation cannot survive by " +
      "rearranging the SQL text alone",
  );
});

test("the return statement is the query call's very next statement — nothing is interposed", () => {
  const src = code(SERVICE_FILE);
  // Mirrors the identical fix in `erp-queue-service-guard.test.ts` — read that
  // file's own comment on this test for the full account of the gap it
  // closes. In short: a naive "does `accumulateAccountQueueRows(res.recordset
  // as Record<string, unknown>[])` appear anywhere in the file" pin is beaten
  // by mutation IN PLACE —
  //
  //   for (const r of res.recordset) { r.FormCode = AP4_FORM_CODE; r.Status = "ManagerApproved"; }
  //   return accumulateAccountQueueRows(res.recordset as Record<string, unknown>[]);
  //
  // — which needs no `.map`, no `.filter`, no helper, and builds no new
  // array, so the call-site text an unanchored regex looks for is left
  // completely untouched while every row has already been rewritten before
  // `accumulateAccountQueueRows` ever sees it.
  //
  // The fix is anchoring WHERE the call is allowed to appear: immediately
  // (whitespace only) after the query call's own closing `` `); ``, with
  // nothing else between them. An interposed `for` loop, a `.map` assigned to
  // a local first, or a helper call needs a STATEMENT to sit in that gap, and
  // a statement there breaks the match regardless of what it does to the
  // rows.
  //
  // **This is a statement-adjacency pin, not a proof the recordset reaches
  // the accumulator unmodified — say so rather than overclaim it.** A
  // mutation written inside the query call's own argument list, or a Proxy
  // substituted for `res.recordset` upstream of this statement, would still
  // satisfy adjacency. `queue-service.test.ts` is what actually exercises the
  // values `accumulateAccountQueueRows` receives; this is what catches an
  // edit at commit time before that test even has to.
  assert.ok(
    /`\)\s*;\s*return\s+accumulateAccountQueueRows\(\s*res\.recordset\s+as\s+Record<string,\s*unknown>\[\]\s*,?\s*\)\s*;/.test(
      src,
    ),
    "queue-service.ts no longer hands accumulateAccountQueueRows the query's own recordset as the " +
      "very next statement after the query call. Anything interposed there — a mutation loop " +
      "rewriting each row in place, a .map spreading a FormCode/Status/CurrentStepCode over each row " +
      "into a new array, a filter, a helper — feeds the row-level gate values the database never " +
      "returned, and every other test in this file and in queue-service.test.ts stays green while the " +
      "queue lists an AP-1 claim or an ACCOUNT_FINAL claim under a header saying it is awaiting the " +
      "accounting check. If the query genuinely needs another statement between it and the return, " +
      "move the transformation INSIDE accumulateAccountQueueRows, where the behavioural tests can see it",
  );
});
