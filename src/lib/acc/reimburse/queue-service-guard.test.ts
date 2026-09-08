import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * `queue-service.ts` now defends AP-4's accounting queue against AP-1's
 * claims (parked at the identical `(ManagerApproved, ACCOUNT)` tuple,
 * `STATUS_AT_STEP`, AP-1's `approval-engine.ts`) in TWO layers, and they are
 * not equally strong. Read `belongsInAccountQueue`'s own docblock
 * (`./queue-policy.ts`) for the full history; this file is only the outer
 * one.
 *
 * **This file is the outer, WEAKER layer.** It is a regex over SQL text, and
 * three review rounds proved — each time by producing a working mutation, not
 * by argument — that a regex over SQL TEXT cannot verify SQL SEMANTICS:
 * round 1's bare-identifier match was defeated by an AND→OR loosening and a
 * `belongsInAccountQueue(...)` call stripped of its guarding `if`; round 2's
 * tightened "require the AND" regex was then defeated by a
 * re-parenthesisation —
 * `WHERE (r.FormCode = @form AND r.Status = @status) OR r.CurrentStepCode = @step`
 * — that leaves `FormCode = @form AND` sitting there as a contiguous,
 * regex-satisfying substring while the query now means "AP-4 at the right
 * status, OR *anything* at `CurrentStepCode = 'ACCOUNT'`". There is no reason
 * to expect a fourth regex would be the last one either.
 *
 * **`belongsInAccountQueue` is the INNER, REAL layer**, and it is a
 * `queue-policy.test.ts` unit test — not this file — that demonstrates it:
 * since round 3 that function takes `formCode` back out of the query's own
 * result set and re-derives the WHOLE predicate
 * (`formCode === AP4_FORM_CODE && status === "ManagerApproved" && stepCode
 * === "ACCOUNT"`) from data the database actually returned. None of the
 * three mutations above can defeat it: whatever the WHERE clause selects, a
 * row whose `FormCode` is not `'AP-4'` fails this check and is dropped before
 * it reaches the client — real code executing against real values, not a
 * pattern guessing at intent from source text.
 *
 * **So what is this file still for?** Catching the two things a regex CAN
 * reliably see: that the SQL predicate still names `FormCode = @form` at all
 * (its total absence, or `@form` silently unbound), and that the row-level
 * call still exists and still GATES on its answer rather than computing one
 * and discarding it. Losing either of those is still worth failing fast on,
 * even though `belongsInAccountQueue` would also catch the resulting AP-1
 * leak on the next request — this file catches it at commit time instead of
 * at review time. What it does NOT try to do any more is pin the shape of the
 * WHERE clause's conjunction: that shape-pinning (`\s+AND\b`) was what round
 * 2 added and what round 3's re-parenthesisation defeated, and keeping it
 * would only teach the next reader that this file is still the safety net —
 * it is not, `belongsInAccountQueue` is.
 */

const FILE = "lib/acc/reimburse/queue-service.ts";

/** Comments quoting the rule must not satisfy it — matches `perdiem-source-guard.test.ts`'s own `code()`. */
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
    "queue-service.ts no longer names FormCode = @form anywhere — this is only the outer, weaker " +
      "check (see this file's own docblock); belongsInAccountQueue (queue-policy.ts) is what " +
      "actually refuses an AP-1 row regardless of how this predicate is shaped, but a totally " +
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

test("the row loop still selects FormCode and passes it to belongsInAccountQueue", () => {
  const src = code();
  assert.ok(
    /r\.FormCode\b/.test(src),
    "queue-service.ts no longer selects r.FormCode — belongsInAccountQueue cannot re-derive the " +
      "predicate from data the row check never received, and silently falls back to whatever the " +
      "SQL WHERE clause alone decided",
  );
});

test("belongsInAccountQueue still GATES the row, rather than being called and ignored", () => {
  const src = code();
  assert.ok(
    /if\s*\(\s*!\s*belongsInAccountQueue\s*\(/.test(src),
    "queue-service.ts no longer guards on belongsInAccountQueue's answer — a bare call such as " +
      "`belongsInAccountQueue(formCode, status, stepCode);` with no `if (!…) continue;` around it " +
      "still names the function, computes an answer, and then throws it away, pushing every row " +
      "unconditionally. This is the one assertion in this file that a mutation cannot survive by " +
      "rearranging the SQL text alone",
  );
});
