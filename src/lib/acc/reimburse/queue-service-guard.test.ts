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
 *   exists.
 *
 *   **But which layer catches which rebinding is a measurement, not a
 *   principle, and this comment had it backwards for one commit.** It said
 *   the behavioural test "is the layer that actually closes this hole, not
 *   this file", and called the assertions below a cheaper second tripwire.
 *   Round five measured it: rebinding `status` was caught by the REGEX ALONE
 *   — every behavioural case then in the file happened to pair a wrong status
 *   with a wrong step, and `belongsInAccountQueue` refuses on either, so none
 *   of them could tell the two apart. A reader trusting the old sentence
 *   could have deleted the assertion that was doing the work. Both layers now
 *   catch it, because `queue-service.test.ts` gained the case that was
 *   missing (right step, wrong status) — and the lesson is the general one:
 *   **do not write down which layer catches a mutation without drilling it.**
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
  // `, scope, claimTargets` is pinned by NAME, not left open with `.*` — see
  // `formCode`/`status`/`stepCode`'s own rebinding tests above for why an
  // unanchored gap would let `scope`/`claimTargets` be quietly rebound to
  // something that is not what `loadApproverScopeByStaffId` /
  // `loadClaimBrandTargets` actually returned.
  assert.ok(
    /`\)\s*;\s*return\s+accumulateAccountQueueRows\(\s*res\.recordset\s+as\s+Record<string,\s*unknown>\[\]\s*,\s*scope\s*,\s*claimTargets\s*,?\s*\)\s*;/.test(
      src,
    ),
    "queue-service.ts no longer hands accumulateAccountQueueRows the query's own recordset, scope and " +
      "claimTargets as the very next statement after the query call. Anything interposed there — a " +
      "mutation loop rewriting each row in place, a .map spreading a FormCode/Status/CurrentStepCode " +
      "over each row into a new array, a filter, a helper — feeds the row-level gate values the " +
      "database never returned, and every other test in this file and in queue-service.test.ts stays " +
      "green while the queue lists an AP-1 claim, an ACCOUNT_FINAL claim, or a claim outside this " +
      "caller's brand scope. If the query genuinely needs another statement between it and the return, " +
      "move the transformation INSIDE accumulateAccountQueueRows, where the behavioural tests can see it",
  );
});

test("queue-service.ts calls accumulateAccountQueueRows exactly once — no decoy satisfies the pin above", () => {
  const src = code(SERVICE_FILE);
  // Round five. The adjacency assertion above runs its regex against the WHOLE
  // file, so it only ever required the anchored shape to appear SOMEWHERE — not
  // inside the function that actually runs. A never-called helper carrying a
  // template literal that ends in ```);`` and a matching
  // `return accumulateAccountQueueRows(res.recordset as Record<string, unknown>[]);`
  // satisfies it on its own, freeing the real function to interpose whatever it
  // likes. Measured on both queues: every guard green, the full suite green,
  // `tsc --noEmit` clean, every row rewritten before the gate saw it.
  //
  // This closes it without parsing TypeScript. If the file calls
  // accumulateAccountQueueRows exactly once, and that one call is
  // adjacent to a query's closing ```);``, then the call the real function
  // makes IS the adjacent one — a decoy needs a second occurrence to exist at
  // all, and this assertion is what that second occurrence trips. The two
  // assertions are only sound TOGETHER: adjacency alone permits a decoy, and
  // exactly-once alone permits an interposed statement.
  const calls = src.split("accumulateAccountQueueRows(").length - 1;
  assert.equal(
    calls,
    1,
    `queue-service.ts names accumulateAccountQueueRows(${""} ${calls} time(s), not once. ` +
      "The assertion above anchors the call to the query's closing backtick-paren, but it searches " +
      "the whole file — so a second occurrence anywhere, including in a helper nothing calls, can " +
      "satisfy that anchor while the real function interposes a mutation loop between its query and " +
      "its return. Every other test here and in queue-service.test.ts stays green while the " +
      "queue lists an AP-1 claim, or an ACCOUNT_FINAL claim, under a header saying it awaits the accounting check. If this file genuinely needs to " +
      "call the accumulator twice, the anchored assertion above must be rewritten to match inside " +
      "the exported function's own body rather than anywhere in the source",
  );
});

/* ─────────────── What the two seam assertions above do NOT cover ───────────────
 *
 * Round five ended the arms race by losing it twice more, and the result is
 * worth writing down rather than answering with a seventh regex.
 *
 * The pair — "the return is the query's next statement" plus "the accumulator
 * is called exactly once" — was argued to be sound together: if there is one
 * call and it is adjacent, the real call IS the adjacent one. **That argument
 * is false**, and an adversarial review defeated it with two shapes, each
 * measured at a full green suite and a clean `tsc --noEmit`:
 *
 *   1. **An alias.** `const accumulate = accumulateAccountQueueRows;` contains
 *      no `accumulateAccountQueueRows(`, so the counter sees one call — the
 *      never-called decoy helper's — and that one is adjacent. The real
 *      function is then free to rewrite every row in place before calling
 *      through the alias.
 *   2. **Doctoring the request chain.** A wrapper that binds and replaces
 *      `req.query` rewrites each row as the query resolves, *upstream* of the
 *      return statement entirely. Exactly-once is satisfied trivially,
 *      adjacency is untouched, and nothing textual changed between the query
 *      and the return. **Body-scoping the regexes would not catch this one**,
 *      which is why doing that was not the fix.
 *
 * **So: these two assertions catch an ACCIDENT and make a hostile edit
 * conspicuous in a diff. They do not prove the recordset is undoctored, and
 * nothing in this repository does.** What would is a test that hands the
 * service an injected pool and inspects what `accumulateAccountQueueRows` receives
 * — and that cannot exist here, because importing `queue-service.ts` reaches
 * `@/env`, which validates the whole environment at import and throws off a
 * configured machine. An integration harness with a real database is the only
 * thing that closes it, and this repo has none.
 *
 * Keep them anyway: they cost one regex each, they fail at commit time, and
 * every shape that defeats them (an alias assignment, a monkey-patched
 * `query`, a "shape probe" helper nobody calls) is loud in review in a way an
 * edited literal is not. **What must not happen is a future reader concluding
 * from their titles that the seam is covered.** The layer that genuinely has
 * teeth is `queue-service.test.ts`: it hands
 * `accumulateAccountQueueRows` rows and checks what comes back, so it is
 * blind to how they were obtained but cannot be fooled about what the function
 * does with them.
 *
 * Eight mutations have now survived a guard in this feature across five review
 * rounds. **Every one was found by a person constructing an attack, and not
 * one by a regex getting stronger.** That is the transferable lesson, and it
 * is the same one `queue-service.ts`'s own docblock reached from the other
 * direction three rounds earlier: a regex over source text cannot verify what
 * the source means.
 */
