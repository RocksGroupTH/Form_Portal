import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * `queue-service.ts` pins two things that make AP-4's accounting queue AP-4's,
 * rather than a queue that also lists AP-1's travel claims: the
 * `FormCode = @form` predicate (bound to `AP4_FORM_CODE`) AND-conjoined with
 * the `(Status, CurrentStepCode)` tuple, and the `belongsInAccountQueue`
 * re-assertion applied to every row before it is returned. Deleting either
 * one changes nothing the typecheck or any of the other 1280 tests would
 * catch — AP-1 parks at the identical `(ManagerApproved, ACCOUNT)` tuple
 * (`STATUS_AT_STEP`, AP-1's `approval-engine.ts`), so the query keeps
 * compiling, keeps returning rows, and every returned row keeps matching
 * `ReimburseQueueRow`'s shape. It just starts returning the WRONG rows,
 * offered to a client that will loop `POST .../requests/[id]/approve` over
 * them — which, for an AP-1 id, calls `approveReimburseAccountCheck` and
 * writes AP-4-shaped columns onto an AP-1 request. CLAUDE.md names this exact
 * pin on AP-4's own claim functions: "Removing a pin re-opens a Critical; two
 * reviews have now spent effort rediscovering this."
 *
 * Source-reading rather than behavioural, for the reason
 * `perdiem-source-guard.test.ts` gives for the same shape of test: the
 * failure here is a MISSING or LOOSENED call, and no test of
 * `listReimburseAccountQueue`'s return shape would notice a later edit
 * dropping or weakening it — a query missing `FormCode = @form`, or one that
 * only OR's it in, still returns rows that satisfy every assertion a
 * behavioural test would think to write, because AP-1's rows at this tuple
 * are shaped enough like AP-4's own that nothing downstream refuses them
 * either.
 *
 * **Deletion is not the only way to lose the pin, and round 1's tests missed
 * that.** They matched on the bare identifiers `FormCode = @form` and
 * `belongsInAccountQueue(`, which a logic-loosening edit can keep verbatim
 * while gutting what they do:
 *
 *  - `WHERE r.FormCode = @form OR (r.Status = @status AND r.CurrentStepCode =
 *    @step)` still contains the substring `FormCode = @form` — the AND became
 *    an OR, so an AP-1 claim sitting at `(ManagerApproved, ACCOUNT)` is
 *    selected by the second arm regardless of its FormCode. And
 *    `belongsInAccountQueue` genuinely cannot catch this on its own: it takes
 *    only `(status, stepCode)`, no `FormCode` at all, so that AP-1 row passes
 *    the row check unchallenged. The two-independent-enforcements claim above
 *    is only true while the SQL predicate is conjunctive — this file is what
 *    keeps that true rather than merely asserted.
 *  - `belongsInAccountQueue(status, stepCode);` with the `if (!… ) continue;`
 *    stripped off still contains the substring `belongsInAccountQueue(` — the
 *    call fires and its answer is thrown away, so every row is pushed
 *    unconditionally.
 *
 * The two regexes below require the SHAPE — the conjunction, and the guarding
 * `if (!…)` — not just the identifier, so both of these survive as text but
 * not as a passing test. `\s+` (not `[ ]+`) is used everywhere a keyword
 * boundary is asserted, because `\s` already matches a newline with no `s`
 * flag needed — the predicate is one line today but must not need to stay
 * that way for this file to keep meaning what it says.
 *
 * Five mutations were drilled locally before these assertions were kept —
 * each applied alone, tested, and reverted — see the fix report for what was
 * observed at each step:
 *  1. deleting `AND r.FormCode = @form` from the WHERE clause,
 *  2. rebinding `@form` to a literal or another form's constant,
 *  3. deleting the `belongsInAccountQueue(...)` line entirely,
 *  4. turning the WHERE clause's leading AND into an OR,
 *  5. stripping the `if (!…) continue;` down to a bare, non-gating call.
 */

const FILE = "lib/acc/reimburse/queue-service.ts";

/** Comments quoting the rule must not satisfy it — matches `perdiem-source-guard.test.ts`'s own `code()`. */
function code(): string {
  return fs
    .readFileSync(path.resolve(process.cwd(), "src", FILE), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("the WHERE clause AND-conjoins FormCode = @form with the rest of the predicate", () => {
  const src = code();
  assert.ok(
    /FormCode\s*=\s*@form\s+AND\b/.test(src),
    "queue-service.ts's WHERE clause no longer AND-conjoins FormCode = @form with " +
      "(Status, CurrentStepCode) — either the predicate is gone outright, or it has been loosened " +
      "to an OR (`FormCode = @form OR (Status = @status AND CurrentStepCode = @step)`), which still " +
      "contains the substring 'FormCode = @form' but selects AP-1's claims at the identical " +
      "(ManagerApproved, ACCOUNT) tuple regardless of FormCode. belongsInAccountQueue cannot catch " +
      "this on its own — it is handed no FormCode at all, only (status, stepCode) — so an OR here " +
      "reaches AP-4's client with AP-1's rows and nothing downstream refuses them",
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

test("every row is dropped, not merely inspected, when belongsInAccountQueue disagrees", () => {
  const src = code();
  assert.ok(
    /if\s*\(\s*!\s*belongsInAccountQueue\s*\(/.test(src),
    "queue-service.ts no longer guards on belongsInAccountQueue's answer — a bare call such as " +
      "`belongsInAccountQueue(status, stepCode);` with no `if (!…) continue;` around it still " +
      "contains the substring 'belongsInAccountQueue(', computes an answer, and then throws it " +
      "away, pushing every row unconditionally. The SQL predicate and this call are meant to be " +
      "two INDEPENDENT enforcements of one tuple; a call that does not gate anything is not a " +
      "second enforcement, it is dead code that happens to read like one",
  );
});
